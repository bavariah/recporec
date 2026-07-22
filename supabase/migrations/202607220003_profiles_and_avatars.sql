-- Editable player profiles with curated avatars and optional owner-managed uploads.

alter table public.profiles
  add column if not exists avatar_key text not null default 'lagoon',
  add column if not exists avatar_path text;

do $$ begin
  alter table public.profiles add constraint profiles_avatar_key_check
    check (avatar_key in ('lagoon', 'sunset', 'violet', 'ocean', 'rose', 'forest'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.profiles add constraint profiles_avatar_path_check
    check (
      avatar_path is null or (
        split_part(avatar_path, '/', 1) = id::text
        and avatar_path ~ ('^' || id::text || '/avatar-[0-9]+\.(jpg|png|webp)$')
      )
    );
exception when duplicate_object then null;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-avatars',
  'profile-avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatar uploads are owner managed" on storage.objects;
create policy "Avatar uploads are owner managed"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Avatar updates are owner managed" on storage.objects;
create policy "Avatar updates are owner managed"
on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Avatar deletes are owner managed" on storage.objects;
create policy "Avatar deletes are owner managed"
on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create or replace function public.update_player_profile(
  p_display_name text,
  p_avatar_key text,
  p_avatar_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_name text := btrim(coalesce(p_display_name, ''));
  clean_avatar_key text := lower(btrim(coalesce(p_avatar_key, '')));
  clean_avatar_path text := nullif(btrim(coalesce(p_avatar_path, '')), '');
  updated_profile public.profiles%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if char_length(clean_name) not between 2 and 24 then
    raise exception 'Display name must contain 2 to 24 characters';
  end if;
  if clean_avatar_key not in ('lagoon', 'sunset', 'violet', 'ocean', 'rose', 'forest') then
    raise exception 'Unknown avatar';
  end if;
  if clean_avatar_path is not null and (
    split_part(clean_avatar_path, '/', 1) <> caller_id::text
    or clean_avatar_path !~ ('^' || caller_id::text || '/avatar-[0-9]+\.(jpg|png|webp)$')
  ) then
    raise exception 'Invalid avatar path';
  end if;

  update public.profiles
  set display_name = clean_name,
      avatar_key = clean_avatar_key,
      avatar_path = clean_avatar_path
  where id = caller_id
  returning * into updated_profile;

  if not found then raise exception 'Profile not found'; end if;

  return jsonb_build_object(
    'id', updated_profile.id,
    'display_name', updated_profile.display_name,
    'avatar_key', updated_profile.avatar_key,
    'avatar_path', updated_profile.avatar_path
  );
end;
$$;

drop function if exists public.get_leaderboard(integer);
create function public.get_leaderboard(p_limit integer default 50)
returns table (
  user_id uuid,
  display_name text,
  avatar_key text,
  avatar_path text,
  total_games bigint,
  wins bigint,
  losses bigint,
  total_points bigint,
  average_points numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    player.user_id,
    profile.display_name,
    profile.avatar_key,
    profile.avatar_path,
    count(*)::bigint as total_games,
    count(*) filter (where match.winner_id = player.user_id)::bigint as wins,
    count(*) filter (
      where match.winner_id is not null and match.winner_id <> player.user_id
    )::bigint as losses,
    sum(player.score)::bigint as total_points,
    round(avg(player.score)::numeric, 1) as average_points
  from public.match_players player
  join public.matches match on match.id = player.match_id
  join public.profiles profile on profile.id = player.user_id
  where match.status = 'completed'
  group by player.user_id, profile.display_name, profile.avatar_key, profile.avatar_path
  order by total_points desc, wins desc, average_points desc, profile.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

create or replace function public.get_match_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  match_data jsonb;
  rack_data jsonb;
  players_data jsonb;
  moves_data jsonb;
  bag_count integer;
begin
  if caller_id is null or not public.is_match_participant(p_match_id) then
    raise exception 'Match access denied' using errcode = '42501';
  end if;

  select to_jsonb(match_row) into match_data
  from public.matches match_row where match_row.id = p_match_id;
  if match_data is null then raise exception 'Match not found'; end if;

  select rack into rack_data from public.player_racks
  where match_id = p_match_id and user_id = caller_id;

  select jsonb_agg(jsonb_build_object(
    'user_id', player.user_id,
    'seat', player.seat,
    'score', player.score,
    'exchange_used', player.exchange_used,
    'time_freeze_used', player.time_freeze_used,
    'display_name', profile.display_name,
    'avatar_key', profile.avatar_key,
    'avatar_path', profile.avatar_path
  ) order by player.seat)
  into players_data
  from public.match_players player
  join public.profiles profile on profile.id = player.user_id
  where player.match_id = p_match_id;

  select jsonb_agg(jsonb_build_object(
    'id', move.id,
    'turn', move.turn_number,
    'player_id', move.player_id,
    'player_name', profile.display_name,
    'placements', move.placements,
    'words', move.formed_words,
    'score', move.score_delta,
    'created_at', move.created_at
  ) order by move.turn_number)
  into moves_data
  from public.moves move
  join public.profiles profile on profile.id = move.player_id
  where move.match_id = p_match_id;

  select jsonb_array_length(bag) into bag_count
  from public.match_private_state where match_id = p_match_id;

  return jsonb_build_object(
    'match', match_data,
    'rack', coalesce(rack_data, '[]'::jsonb),
    'players', coalesce(players_data, '[]'::jsonb),
    'moves', coalesce(moves_data, '[]'::jsonb),
    'bag_count', coalesce(bag_count, 0),
    'viewer_id', caller_id
  );
end;
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
        where rival.match_id = match.id and rival.user_id <> auth.uid() limit 1) as opponent_name,
      (select profile.avatar_key from public.match_players rival join public.profiles profile on profile.id = rival.user_id
        where rival.match_id = match.id and rival.user_id <> auth.uid() limit 1) as opponent_avatar_key,
      (select profile.avatar_path from public.match_players rival join public.profiles profile on profile.id = rival.user_id
        where rival.match_id = match.id and rival.user_id <> auth.uid() limit 1) as opponent_avatar_path
    from public.matches match join public.match_players player on player.match_id = match.id
    where player.user_id = auth.uid()
  ), finished as (
    select * from mine where status in ('completed','abandoned')
  )
  select jsonb_build_object(
    'profile', (select jsonb_build_object(
      'id', profile.id,
      'display_name', profile.display_name,
      'avatar_key', profile.avatar_key,
      'avatar_path', profile.avatar_path
    ) from public.profiles profile where profile.id = auth.uid()),
    'stats', jsonb_build_object(
      'games', (select count(*) from finished),
      'wins', (select count(*) from finished where winner_id = auth.uid()),
      'points', coalesce((select sum(my_score) from finished), 0),
      'average', coalesce((select round(avg(my_score)::numeric, 1) from finished), 0)
    ),
    'open_matches', coalesce((select jsonb_agg(jsonb_build_object(
      'match_id', id, 'invite_code', invite_code, 'status', status, 'updated_at', updated_at,
      'game_mode', game_mode, 'match_source', match_source, 'opponent_name', opponent_name,
      'avatar_key', opponent_avatar_key, 'avatar_path', opponent_avatar_path
    ) order by updated_at desc) from (select * from mine where status in ('waiting','active') limit 10) open_games), '[]'::jsonb),
    'recent_matches', coalesce((select jsonb_agg(jsonb_build_object(
      'match_id', id, 'updated_at', updated_at, 'game_mode', game_mode,
      'opponent_name', opponent_name, 'avatar_key', opponent_avatar_key, 'avatar_path', opponent_avatar_path,
      'my_score', my_score, 'opponent_score', rival_score,
      'result', case when winner_id is null then 'draw' when winner_id = auth.uid() then 'win' else 'loss' end
    ) order by updated_at desc) from (select * from finished order by updated_at desc limit 10) recent), '[]'::jsonb)
  );
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
    select result.user_id, profile.display_name, profile.avatar_key, profile.avatar_path,
      result.score, result.completed_at,
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
      'user_id', user_id, 'display_name', display_name,
      'avatar_key', avatar_key, 'avatar_path', avatar_path,
      'score', score, 'rank', rank
    ) order by rank) from (select * from ranked order by rank limit 50) leaders), '[]'::jsonb)
  ) from settings;
$$;

revoke all on function public.update_player_profile(text, text, text) from public;
revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.update_player_profile(text, text, text) to authenticated;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;
