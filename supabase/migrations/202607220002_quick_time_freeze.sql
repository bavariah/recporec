-- One server-authoritative 30-second time freeze per player in quick matches.

alter table public.match_players
  add column if not exists time_freeze_used boolean not null default false;

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
    'display_name', profile.display_name
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

create or replace function public.freeze_match_time(
  p_match_id uuid,
  p_expected_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  match_row public.matches%rowtype;
  player_row public.match_players%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into match_row
  from public.matches
  where id = p_match_id
  for update;

  if not found or not public.is_match_participant(p_match_id) then
    raise exception 'Match access denied';
  end if;
  if match_row.status <> 'active' or match_row.game_mode <> 'quick' then
    raise exception 'Time freeze is only available in an active quick match';
  end if;
  if match_row.current_player_id <> caller_id then
    raise exception 'It is not your turn';
  end if;
  if match_row.version <> p_expected_version then
    raise exception 'Match changed; reload and try again';
  end if;
  if match_row.turn_deadline is null or now() >= match_row.turn_deadline then
    raise exception 'The turn has already expired';
  end if;

  select * into player_row
  from public.match_players
  where match_id = p_match_id and user_id = caller_id
  for update;

  if player_row.time_freeze_used then
    raise exception 'Time freeze has already been used';
  end if;

  update public.match_players
  set time_freeze_used = true
  where match_id = p_match_id and user_id = caller_id;

  update public.matches
  set turn_deadline = turn_deadline + interval '30 seconds',
      version = version + 1
  where id = p_match_id;

  return public.get_match_state(p_match_id);
end;
$$;

revoke all on function public.freeze_match_time(uuid, integer) from public;
grant execute on function public.freeze_match_time(uuid, integer) to authenticated;
