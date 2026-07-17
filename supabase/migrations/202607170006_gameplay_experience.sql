-- Gameplay continuity, fair starting order, move history, rematches, resigning,
-- and player-submitted dictionary reports.

create or replace function public.match_premium(p_row integer, p_col integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_row, p_col) in ((0,0),(0,7),(7,0),(7,7)) then 'word3'
    when (p_row, p_col) in ((1,1),(1,6),(3,3),(6,1),(6,6)) then 'word2'
    when (p_row, p_col) in ((1,4),(2,2),(2,5),(3,0),(4,7),(5,2),(5,5),(6,3)) then 'letter3'
    when (p_row, p_col) in ((0,3),(0,4),(1,2),(1,5),(2,1),(2,6),(3,1),(3,6),(4,1),(4,6),(5,1),(5,6),(6,2),(6,5),(7,3),(7,4)) then 'letter2'
    else null
  end;
$$;

create or replace function public.initialize_match_tiles(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bag jsonb := public.make_match_tile_bag();
  first_player uuid;
  second_player uuid;
  starting_player uuid;
  first_rack jsonb;
  second_rack jsonb;
  remaining_bag jsonb;
begin
  select user_id into first_player from public.match_players where match_id = p_match_id and seat = 1;
  select user_id into second_player from public.match_players where match_id = p_match_id and seat = 2;
  if first_player is null or second_player is null then raise exception 'Two players are required'; end if;

  starting_player := case when random() < 0.5 then first_player else second_player end;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into first_rack
    from jsonb_array_elements(bag) with ordinality as tile(value, ordinal) where ordinal between 1 and 8;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into second_rack
    from jsonb_array_elements(bag) with ordinality as tile(value, ordinal) where ordinal between 9 and 16;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into remaining_bag
    from jsonb_array_elements(bag) with ordinality as tile(value, ordinal) where ordinal > 16;

  update public.player_racks set rack = first_rack, updated_at = now()
    where match_id = p_match_id and user_id = first_player;
  update public.player_racks set rack = second_rack, updated_at = now()
    where match_id = p_match_id and user_id = second_player;
  update public.match_private_state set bag = remaining_bag, updated_at = now() where match_id = p_match_id;
  update public.matches set status = 'active', board = public.empty_match_board(),
    current_player_id = starting_player, turn_number = 1, consecutive_passes = 0,
    version = version + 1 where id = p_match_id;
end;
$$;

alter table public.matches add column if not exists rematch_of uuid references public.matches(id) on delete set null;
create unique index if not exists matches_one_rematch_idx on public.matches(rematch_of) where rematch_of is not null;

create table if not exists public.word_reports (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  match_id uuid references public.matches(id) on delete set null,
  word text not null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  unique (user_id, word)
);
alter table public.word_reports enable row level security;

create or replace function public.report_dictionary_word(p_word text, p_match_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare clean_word text := lower(btrim(coalesce(p_word, '')));
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if char_length(clean_word) not between 2 and 8 then raise exception 'Invalid word'; end if;
  if p_match_id is not null and not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  insert into public.word_reports(user_id, match_id, word) values (auth.uid(), p_match_id, clean_word)
  on conflict (user_id, word) do nothing;
end;
$$;

create or replace function public.list_my_open_matches()
returns table(match_id uuid, invite_code text, status text, updated_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select match.id, match.invite_code, match.status, match.updated_at
  from public.matches match
  join public.match_players player on player.match_id = match.id
  where player.user_id = auth.uid() and match.status in ('waiting','active')
  order by match.updated_at desc limit 10;
$$;

create or replace function public.resign_match(p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); winner uuid;
begin
  if not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  select user_id into winner from public.match_players where match_id = p_match_id and user_id <> caller_id limit 1;
  update public.matches set status = 'abandoned', winner_id = winner, current_player_id = null, version = version + 1
    where id = p_match_id and status in ('waiting','active');
  return public.get_match_state(p_match_id);
end;
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
    insert into public.matches(created_by, rematch_of) values (caller_id, p_match_id) returning id into new_id;
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

create or replace function public.get_match_state(p_match_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller_id uuid := auth.uid(); match_data jsonb; rack_data jsonb; players_data jsonb; moves_data jsonb; bag_count integer;
begin
  if caller_id is null or not public.is_match_participant(p_match_id) then raise exception 'Match access denied' using errcode = '42501'; end if;
  select to_jsonb(match_row) into match_data from public.matches match_row where match_row.id = p_match_id;
  if match_data is null then raise exception 'Match not found'; end if;
  select rack into rack_data from public.player_racks where match_id = p_match_id and user_id = caller_id;
  select jsonb_agg(jsonb_build_object('user_id', player.user_id, 'seat', player.seat, 'score', player.score,
    'exchange_used', player.exchange_used, 'display_name', profile.display_name) order by player.seat)
    into players_data from public.match_players player join public.profiles profile on profile.id = player.user_id where player.match_id = p_match_id;
  select jsonb_agg(jsonb_build_object('id', move.id, 'turn', move.turn_number, 'player_id', move.player_id,
    'player_name', profile.display_name, 'placements', move.placements, 'words', move.formed_words,
    'score', move.score_delta, 'created_at', move.created_at) order by move.turn_number)
    into moves_data from public.moves move join public.profiles profile on profile.id = move.player_id where move.match_id = p_match_id;
  select jsonb_array_length(bag) into bag_count from public.match_private_state where match_id = p_match_id;
  return jsonb_build_object('match', match_data, 'rack', coalesce(rack_data, '[]'::jsonb),
    'players', coalesce(players_data, '[]'::jsonb), 'moves', coalesce(moves_data, '[]'::jsonb),
    'bag_count', coalesce(bag_count, 0), 'viewer_id', caller_id);
end;
$$;

-- Aggregate-only balance signals. No rack contents, invite codes, names, or
-- per-player histories are returned.
create or replace function public.get_gameplay_balance_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  with completed as (
    select match.id, match.winner_id,
      (select player_id from public.moves where match_id = match.id order by turn_number limit 1) as opening_player,
      (select count(*) from public.moves where match_id = match.id) as turns
    from public.matches match where match.status = 'completed'
  )
  select jsonb_build_object(
    'completed_matches', count(*),
    'opening_player_wins', count(*) filter (where winner_id = opening_player),
    'average_turns', coalesce(round(avg(turns)::numeric, 1), 0),
    'average_move_score', coalesce((select round(avg(score_delta)::numeric, 1) from public.moves), 0),
    'exchange_rate', coalesce((select round(avg(case when exchange_used then 1 else 0 end)::numeric, 3) from public.match_players), 0),
    'pending_word_reports', (select count(*) from public.word_reports where status = 'pending')
  ) from completed;
$$;

revoke all on function public.report_dictionary_word(text, uuid) from public;
revoke all on function public.list_my_open_matches() from public;
revoke all on function public.resign_match(uuid) from public;
revoke all on function public.create_rematch(uuid) from public;
revoke all on function public.get_gameplay_balance_stats() from public;
grant execute on function public.report_dictionary_word(text, uuid) to authenticated;
grant execute on function public.list_my_open_matches() to authenticated;
grant execute on function public.resign_match(uuid) to authenticated;
grant execute on function public.create_rematch(uuid) to authenticated;
grant execute on function public.get_gameplay_balance_stats() to authenticated;
