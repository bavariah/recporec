-- Eight-tile racks and one letter exchange per player per match.

alter table public.match_players
  add column if not exists exchange_used boolean not null default false;

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
  first_rack jsonb;
  second_rack jsonb;
  remaining_bag jsonb;
begin
  select user_id into first_player
  from public.match_players where match_id = p_match_id and seat = 1;
  select user_id into second_player
  from public.match_players where match_id = p_match_id and seat = 2;

  if first_player is null or second_player is null then
    raise exception 'Two players are required';
  end if;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into first_rack
  from jsonb_array_elements(bag) with ordinality as tile(value, ordinal)
  where ordinal between 1 and 8;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into second_rack
  from jsonb_array_elements(bag) with ordinality as tile(value, ordinal)
  where ordinal between 9 and 16;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into remaining_bag
  from jsonb_array_elements(bag) with ordinality as tile(value, ordinal)
  where ordinal > 16;

  update public.player_racks set rack = first_rack, updated_at = now()
  where match_id = p_match_id and user_id = first_player;
  update public.player_racks set rack = second_rack, updated_at = now()
  where match_id = p_match_id and user_id = second_player;
  update public.match_private_state set bag = remaining_bag, updated_at = now()
  where match_id = p_match_id;
  update public.matches
  set status = 'active', board = public.empty_match_board(),
      current_player_id = first_player, turn_number = 1,
      consecutive_passes = 0, version = version + 1
  where id = p_match_id;
end;
$$;

-- Keep the authoritative move implementation from the previous migration and
-- update only its rack-size constants. Guard every replacement so schema drift
-- fails loudly during a fresh reset or hosted push.
do $$
declare
  function_sql text;
begin
  select pg_get_functiondef('public.submit_match_move(uuid,integer,jsonb)'::regprocedure)
  into function_sql;

  if position('placement_count > 7' in function_sql) = 0
    or position('Place between one and seven tiles' in function_sql) = 0
    or position('least(7 - jsonb_array_length(remaining_rack)' in function_sql) = 0 then
    raise exception 'submit_match_move rack-size markers were not found';
  end if;

  function_sql := replace(function_sql, 'placement_count > 7', 'placement_count > 8');
  function_sql := replace(function_sql, 'Place between one and seven tiles', 'Place between one and eight tiles');
  function_sql := replace(
    function_sql,
    'least(7 - jsonb_array_length(remaining_rack)',
    'least(8 - jsonb_array_length(remaining_rack)'
  );
  execute function_sql;
end;
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
  select jsonb_agg(
    jsonb_build_object(
      'user_id', player.user_id,
      'seat', player.seat,
      'score', player.score,
      'exchange_used', player.exchange_used,
      'display_name', profile.display_name
    ) order by player.seat
  ) into players_data
  from public.match_players player
  join public.profiles profile on profile.id = player.user_id
  where player.match_id = p_match_id;
  select jsonb_array_length(bag) into bag_count
  from public.match_private_state where match_id = p_match_id;

  return jsonb_build_object(
    'match', match_data,
    'rack', coalesce(rack_data, '[]'::jsonb),
    'players', coalesce(players_data, '[]'::jsonb),
    'bag_count', coalesce(bag_count, 0),
    'viewer_id', caller_id
  );
end;
$$;

create or replace function public.exchange_match_tiles(
  p_match_id uuid,
  p_expected_version integer,
  p_tile_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  match_row public.matches%rowtype;
  rack_row public.player_racks%rowtype;
  private_row public.match_private_state%rowtype;
  player_row public.match_players%rowtype;
  selected_count integer := coalesce(array_length(p_tile_ids, 1), 0);
  matching_count integer;
  distinct_count integer;
  remaining_rack jsonb;
  drawn_tiles jsonb;
  exchanged_tiles jsonb;
  remaining_bag jsonb;
  next_rack jsonb;
  next_bag jsonb;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if selected_count < 1 or selected_count > 8 then
    raise exception 'Choose between one and eight tiles';
  end if;

  select count(distinct tile_id) into distinct_count from unnest(p_tile_ids) as tile_id;
  if distinct_count <> selected_count then raise exception 'A tile can only be selected once'; end if;

  select * into match_row from public.matches where id = p_match_id for update;
  if not found or not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  if match_row.status <> 'active' then raise exception 'Match is not active'; end if;
  if match_row.current_player_id <> caller_id then raise exception 'It is not your turn'; end if;
  if match_row.version <> p_expected_version then raise exception 'Match changed; reload and try again'; end if;

  select * into player_row from public.match_players
  where match_id = p_match_id and user_id = caller_id for update;
  if player_row.exchange_used then raise exception 'Letter exchange has already been used'; end if;

  select * into rack_row from public.player_racks
  where match_id = p_match_id and user_id = caller_id for update;
  select * into private_row from public.match_private_state
  where match_id = p_match_id for update;

  if jsonb_array_length(private_row.bag) < selected_count then
    raise exception 'Not enough tiles remain in the bag';
  end if;

  select count(*) into matching_count
  from jsonb_array_elements(rack_row.rack) as tile(value)
  where value ->> 'id' = any(p_tile_ids);
  if matching_count <> selected_count then raise exception 'Tile is not in your rack'; end if;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into remaining_rack
  from jsonb_array_elements(rack_row.rack) with ordinality as tile(value, ordinal)
  where not ((value ->> 'id') = any(p_tile_ids));

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into exchanged_tiles
  from jsonb_array_elements(rack_row.rack) with ordinality as tile(value, ordinal)
  where value ->> 'id' = any(p_tile_ids);

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into drawn_tiles
  from jsonb_array_elements(private_row.bag) with ordinality as tile(value, ordinal)
  where ordinal <= selected_count;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into remaining_bag
  from jsonb_array_elements(private_row.bag) with ordinality as tile(value, ordinal)
  where ordinal > selected_count;

  next_rack := remaining_rack || drawn_tiles;
  next_bag := remaining_bag || exchanged_tiles;

  update public.player_racks set rack = next_rack, updated_at = now()
  where match_id = p_match_id and user_id = caller_id;
  update public.match_private_state set bag = next_bag, updated_at = now()
  where match_id = p_match_id;
  update public.match_players set exchange_used = true
  where match_id = p_match_id and user_id = caller_id;

  -- Exchanging is a preparation action. It changes the private rack and match
  -- version for realtime/concurrency safety, but the same player keeps the turn.
  update public.matches set version = version + 1 where id = p_match_id;

  return public.get_match_state(p_match_id);
end;
$$;

revoke all on function public.exchange_match_tiles(uuid, integer, text[]) from public;
grant execute on function public.exchange_match_tiles(uuid, integer, text[]) to authenticated;
