-- Timed and relaxed online modes, quick matchmaking, persistent player hub,
-- and server-saved Daily Challenge results.

alter table public.matches
  add column if not exists game_mode text not null default 'relaxed',
  add column if not exists match_source text not null default 'invite',
  add column if not exists turn_deadline timestamptz;

alter table public.matches
  drop constraint if exists matches_game_mode_check,
  add constraint matches_game_mode_check check (game_mode in ('quick', 'relaxed')),
  drop constraint if exists matches_match_source_check,
  add constraint matches_match_source_check check (match_source in ('invite', 'quick'));

create index if not exists matches_quick_waiting_idx
  on public.matches (game_mode, created_at)
  where status = 'waiting' and match_source = 'quick';

create or replace function public.set_match_turn_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active' or new.game_mode <> 'quick' or new.current_player_id is null then
    new.turn_deadline := null;
  elsif tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.current_player_id is distinct from new.current_player_id
    or old.turn_number is distinct from new.turn_number then
    new.turn_deadline := now() + interval '60 seconds';
  end if;
  return new;
end;
$$;

drop trigger if exists matches_set_turn_deadline on public.matches;
create trigger matches_set_turn_deadline
before insert or update on public.matches
for each row execute function public.set_match_turn_deadline();

create or replace function public.upsert_player_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_name text := btrim(coalesce(p_display_name, ''));
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  insert into public.profiles (id, display_name)
  values (
    caller_id,
    case when char_length(clean_name) between 2 and 24
      then clean_name else 'Играч ' || left(caller_id::text, 6) end
  )
  on conflict (id) do update set display_name = case
    when char_length(clean_name) between 2 and 24 then clean_name
    else public.profiles.display_name end;
end;
$$;

create or replace function public.create_match(
  p_display_name text,
  p_game_mode text
)
returns table(match_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  created_match public.matches%rowtype;
  clean_mode text := lower(btrim(coalesce(p_game_mode, 'relaxed')));
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if clean_mode not in ('quick', 'relaxed') then raise exception 'Invalid game mode'; end if;
  perform public.upsert_player_name(p_display_name);

  for attempt in 1..5 loop
    begin
      insert into public.matches (created_by, current_player_id, game_mode, match_source)
      values (caller_id, caller_id, clean_mode, 'invite') returning * into created_match;
      exit;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, seat) values (created_match.id, caller_id, 1);
  insert into public.match_private_state (match_id) values (created_match.id);
  insert into public.player_racks (match_id, user_id) values (created_match.id, caller_id);
  return query select created_match.id, created_match.invite_code;
end;
$$;

create or replace function public.find_quick_match(
  p_display_name text,
  p_game_mode text default 'quick'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_mode text := lower(btrim(coalesce(p_game_mode, 'quick')));
  selected_match public.matches%rowtype;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if clean_mode not in ('quick', 'relaxed') then raise exception 'Invalid game mode'; end if;
  perform public.upsert_player_name(p_display_name);

  update public.matches
  set status = 'abandoned', current_player_id = null, version = version + 1
  where created_by = caller_id and status = 'waiting' and match_source = 'quick';

  select candidate.* into selected_match
  from public.matches candidate
  where candidate.status = 'waiting'
    and candidate.match_source = 'quick'
    and candidate.game_mode = clean_mode
    and candidate.created_by <> caller_id
    and candidate.created_at > now() - interval '10 minutes'
  order by candidate.created_at
  for update skip locked
  limit 1;

  if found then
    insert into public.match_players (match_id, user_id, seat) values (selected_match.id, caller_id, 2);
    insert into public.player_racks (match_id, user_id) values (selected_match.id, caller_id);
    perform public.initialize_match_tiles(selected_match.id);
    return public.get_match_state(selected_match.id);
  end if;

  insert into public.matches (created_by, current_player_id, game_mode, match_source)
  values (caller_id, caller_id, clean_mode, 'quick') returning * into selected_match;
  insert into public.match_players (match_id, user_id, seat) values (selected_match.id, caller_id, 1);
  insert into public.match_private_state (match_id) values (selected_match.id);
  insert into public.player_racks (match_id, user_id) values (selected_match.id, caller_id);
  return public.get_match_state(selected_match.id);
end;
$$;

create or replace function public.cancel_quick_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.matches
  set status = 'abandoned', current_player_id = null, version = version + 1
  where id = p_match_id
    and created_by = auth.uid()
    and status = 'waiting'
    and match_source = 'quick';
  if not found then raise exception 'Search can no longer be cancelled'; end if;
end;
$$;

create or replace function public.expire_match_turn(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  match_row public.matches%rowtype;
  next_player uuid;
  winner uuid;
begin
  if auth.uid() is null or not public.is_match_participant(p_match_id) then
    raise exception 'Match access denied';
  end if;
  select * into match_row from public.matches where id = p_match_id for update;
  if match_row.status <> 'active' or match_row.game_mode <> 'quick'
    or match_row.turn_deadline is null or now() < match_row.turn_deadline then
    return public.get_match_state(p_match_id);
  end if;

  if match_row.consecutive_passes + 1 >= 4 then
    select user_id into winner from public.match_players
    where match_id = p_match_id order by score desc, seat asc limit 1;
    if (select count(distinct score) from public.match_players where match_id = p_match_id) = 1 then winner := null; end if;
    update public.matches set status = 'completed', winner_id = winner,
      current_player_id = null, consecutive_passes = consecutive_passes + 1,
      version = version + 1 where id = p_match_id;
  else
    select user_id into next_player from public.match_players
    where match_id = p_match_id and user_id <> match_row.current_player_id limit 1;
    update public.matches set current_player_id = next_player,
      turn_number = turn_number + 1, consecutive_passes = consecutive_passes + 1,
      version = version + 1 where id = p_match_id;
  end if;
  return public.get_match_state(p_match_id);
end;
$$;

drop function if exists public.list_my_open_matches();
create function public.list_my_open_matches()
returns table(
  match_id uuid,
  invite_code text,
  status text,
  updated_at timestamptz,
  game_mode text,
  match_source text,
  opponent_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select match.id, match.invite_code, match.status, match.updated_at,
    match.game_mode, match.match_source,
    (select profile.display_name
      from public.match_players rival
      join public.profiles profile on profile.id = rival.user_id
      where rival.match_id = match.id and rival.user_id <> auth.uid()
      limit 1)
  from public.matches match
  join public.match_players player on player.match_id = match.id
  where player.user_id = auth.uid() and match.status in ('waiting','active')
  order by match.updated_at desc limit 10;
$$;

create or replace function public.get_player_hub()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select match.*, player.score as my_score,
      (select rival.score from public.match_players rival where rival.match_id = match.id and rival.user_id <> auth.uid() limit 1) as rival_score,
      (select profile.display_name from public.match_players rival join public.profiles profile on profile.id = rival.user_id
        where rival.match_id = match.id and rival.user_id <> auth.uid() limit 1) as opponent_name
    from public.matches match join public.match_players player on player.match_id = match.id
    where player.user_id = auth.uid()
  ), finished as (
    select * from mine where status in ('completed','abandoned')
  )
  select jsonb_build_object(
    'profile', (select jsonb_build_object('id', profile.id, 'display_name', profile.display_name)
      from public.profiles profile where profile.id = auth.uid()),
    'stats', jsonb_build_object(
      'games', (select count(*) from finished),
      'wins', (select count(*) from finished where winner_id = auth.uid()),
      'points', coalesce((select sum(my_score) from finished), 0),
      'average', coalesce((select round(avg(my_score)::numeric, 1) from finished), 0)
    ),
    'open_matches', coalesce((select jsonb_agg(jsonb_build_object(
      'match_id', id, 'invite_code', invite_code, 'status', status, 'updated_at', updated_at,
      'game_mode', game_mode, 'match_source', match_source, 'opponent_name', opponent_name
    ) order by updated_at desc) from (select * from mine where status in ('waiting','active') limit 10) open_games), '[]'::jsonb),
    'recent_matches', coalesce((select jsonb_agg(jsonb_build_object(
      'match_id', id, 'updated_at', updated_at, 'game_mode', game_mode,
      'opponent_name', opponent_name, 'my_score', my_score, 'opponent_score', rival_score,
      'result', case when winner_id is null then 'draw' when winner_id = auth.uid() then 'win' else 'loss' end
    ) order by updated_at desc) from (select * from finished order by updated_at desc limit 10) recent), '[]'::jsonb)
  );
$$;

create table if not exists public.daily_challenge_results (
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_date date not null,
  score integer not null check (score between 0 and 2500),
  move_count integer not null check (move_count between 1 and 5),
  completed_at timestamptz not null default now(),
  primary key (user_id, challenge_date)
);
alter table public.daily_challenge_results enable row level security;

create or replace function public.submit_daily_challenge(p_score integer, p_move_count integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  challenge_day date := (now() at time zone 'Europe/Belgrade')::date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_score not between 0 and 2500 or p_move_count <> 5 then raise exception 'Invalid daily result'; end if;
  insert into public.daily_challenge_results(user_id, challenge_date, score, move_count)
  values (auth.uid(), challenge_day, p_score, p_move_count)
  on conflict (user_id, challenge_date) do update
    set score = greatest(public.daily_challenge_results.score, excluded.score),
        completed_at = case when excluded.score > public.daily_challenge_results.score then now()
          else public.daily_challenge_results.completed_at end;
  return public.get_daily_challenge();
end;
$$;

create or replace function public.get_daily_challenge()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select (now() at time zone 'Europe/Belgrade')::date as challenge_day
  ), ranked as (
    select result.user_id, profile.display_name, result.score, result.completed_at,
      row_number() over (order by result.score desc, result.completed_at asc) as rank
    from public.daily_challenge_results result
    join public.profiles profile on profile.id = result.user_id
    cross join settings
    where result.challenge_date = settings.challenge_day
  ), gaps as (
    select offset_day
    from generate_series(0, 365) offset_day
    cross join settings
    where not exists (
      select 1 from public.daily_challenge_results result
      where result.user_id = auth.uid() and result.challenge_date = settings.challenge_day - offset_day
    )
    order by offset_day limit 1
  )
  select jsonb_build_object(
    'date', settings.challenge_day,
    'best', coalesce((select score from ranked where user_id = auth.uid()), 0),
    'rank', (select rank from ranked where user_id = auth.uid()),
    'streak', coalesce((select offset_day from gaps), 366),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', user_id, 'display_name', display_name, 'score', score, 'rank', rank
    ) order by rank) from (select * from ranked order by rank limit 50) leaders), '[]'::jsonb)
  ) from settings;
$$;

create or replace function public.create_rematch(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); old_match public.matches%rowtype; new_id uuid; player record; previous_starter uuid; next_starter uuid;
begin
  if not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  select * into old_match from public.matches where id = p_match_id;
  if old_match.status not in ('completed','abandoned') then raise exception 'Match is not finished'; end if;
  select id into new_id from public.matches where rematch_of = p_match_id;
  if new_id is null then
    insert into public.matches(created_by, rematch_of, game_mode, match_source)
    values (caller_id, p_match_id, old_match.game_mode, 'invite') returning id into new_id;
    for player in select user_id, seat from public.match_players where match_id = p_match_id loop
      insert into public.match_players(match_id, user_id, seat) values (new_id, player.user_id, 3 - player.seat);
      insert into public.player_racks(match_id, user_id) values (new_id, player.user_id);
    end loop;
    insert into public.match_private_state(match_id) values (new_id);
    perform public.initialize_match_tiles(new_id);
    select player_id into previous_starter from public.moves where match_id = p_match_id order by turn_number limit 1;
    if previous_starter is not null then
      select user_id into next_starter from public.match_players where match_id = new_id and user_id <> previous_starter limit 1;
      update public.matches set current_player_id = next_starter where id = new_id;
    end if;
  end if;
  return public.get_match_state(new_id);
end;
$$;

revoke all on function public.upsert_player_name(text) from public;
revoke all on function public.create_match(text, text) from public;
revoke all on function public.find_quick_match(text, text) from public;
revoke all on function public.cancel_quick_match(uuid) from public;
revoke all on function public.expire_match_turn(uuid) from public;
revoke all on function public.list_my_open_matches() from public;
revoke all on function public.get_player_hub() from public;
revoke all on function public.submit_daily_challenge(integer, integer) from public;
revoke all on function public.get_daily_challenge() from public;
grant execute on function public.create_match(text, text) to authenticated;
grant execute on function public.find_quick_match(text, text) to authenticated;
grant execute on function public.cancel_quick_match(uuid) to authenticated;
grant execute on function public.expire_match_turn(uuid) to authenticated;
grant execute on function public.list_my_open_matches() to authenticated;
grant execute on function public.get_player_hub() to authenticated;
grant execute on function public.submit_daily_challenge(integer, integer) to authenticated;
grant execute on function public.get_daily_challenge() to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.daily_challenge_results;
exception when duplicate_object then null;
end $$;
