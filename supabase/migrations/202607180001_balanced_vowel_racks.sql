-- Keep every full rack between two and four Serbian vowels whenever the bag
-- still contains a compatible tile. Preserve the shuffled order unless the
-- candidate draw would fall outside that range.

create or replace function public.draw_match_tiles_for_rack(
  p_bag jsonb,
  p_rack jsonb,
  p_amount integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  draw_count integer := least(greatest(coalesce(p_amount, 0), 0), jsonb_array_length(coalesce(p_bag, '[]'::jsonb)));
  existing_vowels integer;
  minimum_draw_vowels integer;
  maximum_draw_vowels integer;
  drawn_vowels integer;
  chosen jsonb;
  remaining jsonb;
  replacement jsonb;
  victim_index integer;
begin
  select count(*) into existing_vowels
  from jsonb_array_elements(coalesce(p_rack, '[]'::jsonb)) as rack_tile(value)
  where (value ->> 'letter') = any (array['А','Е','И','О','У']);

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into chosen
  from jsonb_array_elements(coalesce(p_bag, '[]'::jsonb)) with ordinality as bag_tile(value, ordinal)
  where ordinal <= draw_count;

  minimum_draw_vowels := least(draw_count, greatest(0, 2 - existing_vowels));
  maximum_draw_vowels := greatest(0, 4 - existing_vowels);

  select count(*) into drawn_vowels
  from jsonb_array_elements(chosen) as drawn_tile(value)
  where (value ->> 'letter') = any (array['А','Е','И','О','У']);

  while drawn_vowels < minimum_draw_vowels loop
    replacement := null;
    select value into replacement
    from jsonb_array_elements(coalesce(p_bag, '[]'::jsonb)) with ordinality as candidate(value, ordinal)
    where ordinal > draw_count
      and (value ->> 'letter') = any (array['А','Е','И','О','У'])
      and not exists (
        select 1 from jsonb_array_elements(chosen) as selected(value)
        where selected.value ->> 'id' = candidate.value ->> 'id'
      )
    order by ordinal
    limit 1;

    select ordinal::integer into victim_index
    from jsonb_array_elements(chosen) with ordinality as victim(value, ordinal)
    where not coalesce((value ->> 'letter') = any (array['А','Е','И','О','У']), false)
    order by ordinal desc
    limit 1;

    exit when replacement is null or victim_index is null;
    chosen := jsonb_set(chosen, array[(victim_index - 1)::text], replacement, false);
    drawn_vowels := drawn_vowels + 1;
  end loop;

  while drawn_vowels > maximum_draw_vowels loop
    replacement := null;
    select value into replacement
    from jsonb_array_elements(coalesce(p_bag, '[]'::jsonb)) with ordinality as candidate(value, ordinal)
    where ordinal > draw_count
      and not coalesce((value ->> 'letter') = any (array['А','Е','И','О','У']), false)
      and not exists (
        select 1 from jsonb_array_elements(chosen) as selected(value)
        where selected.value ->> 'id' = candidate.value ->> 'id'
      )
    order by ordinal
    limit 1;

    select ordinal::integer into victim_index
    from jsonb_array_elements(chosen) with ordinality as victim(value, ordinal)
    where (value ->> 'letter') = any (array['А','Е','И','О','У'])
    order by ordinal desc
    limit 1;

    exit when replacement is null or victim_index is null;
    chosen := jsonb_set(chosen, array[(victim_index - 1)::text], replacement, false);
    drawn_vowels := drawn_vowels - 1;
  end loop;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into remaining
  from jsonb_array_elements(coalesce(p_bag, '[]'::jsonb)) with ordinality as bag_tile(value, ordinal)
  where not exists (
    select 1 from jsonb_array_elements(chosen) as selected(value)
    where selected.value ->> 'id' = bag_tile.value ->> 'id'
  );

  return jsonb_build_object('drawn', chosen, 'bag', remaining);
end;
$$;

create or replace function public.initialize_match_tiles(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining_bag jsonb := public.make_match_tile_bag();
  first_player uuid;
  second_player uuid;
  starting_player uuid;
  first_draw jsonb;
  second_draw jsonb;
  first_rack jsonb;
  second_rack jsonb;
begin
  select user_id into first_player from public.match_players where match_id = p_match_id and seat = 1;
  select user_id into second_player from public.match_players where match_id = p_match_id and seat = 2;
  if first_player is null or second_player is null then raise exception 'Two players are required'; end if;

  starting_player := case when random() < 0.5 then first_player else second_player end;
  first_draw := public.draw_match_tiles_for_rack(remaining_bag, '[]'::jsonb, 8);
  first_rack := first_draw -> 'drawn';
  remaining_bag := first_draw -> 'bag';
  second_draw := public.draw_match_tiles_for_rack(remaining_bag, '[]'::jsonb, 8);
  second_rack := second_draw -> 'drawn';
  remaining_bag := second_draw -> 'bag';

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
  exchanged_tiles jsonb;
  draw_result jsonb;
  drawn_tiles jsonb;
  next_rack jsonb;
  next_bag jsonb;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if selected_count < 1 or selected_count > 8 then raise exception 'Choose between one and eight tiles'; end if;

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
  if jsonb_array_length(private_row.bag) < selected_count then raise exception 'Not enough tiles remain in the bag'; end if;

  select count(*) into matching_count
  from jsonb_array_elements(rack_row.rack) as rack_tile(value)
  where value ->> 'id' = any(p_tile_ids);
  if matching_count <> selected_count then raise exception 'Tile is not in your rack'; end if;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into remaining_rack
  from jsonb_array_elements(rack_row.rack) with ordinality as rack_tile(value, ordinal)
  where not ((value ->> 'id') = any(p_tile_ids));

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb) into exchanged_tiles
  from jsonb_array_elements(rack_row.rack) with ordinality as rack_tile(value, ordinal)
  where value ->> 'id' = any(p_tile_ids);

  draw_result := public.draw_match_tiles_for_rack(private_row.bag, remaining_rack, selected_count);
  drawn_tiles := draw_result -> 'drawn';
  if jsonb_array_length(drawn_tiles) <> selected_count then raise exception 'Not enough compatible tiles remain in the bag'; end if;
  next_rack := remaining_rack || drawn_tiles;
  next_bag := (draw_result -> 'bag') || exchanged_tiles;

  update public.player_racks set rack = next_rack, updated_at = now()
    where match_id = p_match_id and user_id = caller_id;
  update public.match_private_state set bag = next_bag, updated_at = now()
    where match_id = p_match_id;
  update public.match_players set exchange_used = true
    where match_id = p_match_id and user_id = caller_id;
  update public.matches set version = version + 1 where id = p_match_id;
  return public.get_match_state(p_match_id);
end;
$$;

-- Patch only the refill section of the authoritative move function. Keeping
-- validation and scoring untouched reduces the migration's gameplay risk.
do $$
declare
  function_sql text;
  start_marker text := 'draw_count := least(8 - jsonb_array_length(remaining_rack), jsonb_array_length(private_row.bag));';
  end_marker text := 'next_rack := remaining_rack || drawn_tiles;';
  start_position integer;
  end_position integer;
  replacement_sql text;
begin
  select pg_get_functiondef('public.submit_match_move(uuid,integer,jsonb)'::regprocedure) into function_sql;

  if position('draw_result jsonb;' in function_sql) = 0 then
    function_sql := replace(function_sql, 'drawn_tiles jsonb;', E'drawn_tiles jsonb;\n  draw_result jsonb;');
  end if;
  if position('draw_result jsonb;' in function_sql) = 0 then
    raise exception 'submit_match_move draw declaration marker was not found';
  end if;

  start_position := position(start_marker in function_sql);
  end_position := position(end_marker in function_sql);
  if start_position = 0 or end_position = 0 or end_position < start_position then
    raise exception 'submit_match_move refill markers were not found';
  end if;

  replacement_sql := start_marker || E'\n  draw_result := public.draw_match_tiles_for_rack(private_row.bag, remaining_rack, draw_count);\n  drawn_tiles := draw_result -> ''drawn'';\n  next_bag := draw_result -> ''bag'';\n  next_rack := remaining_rack || drawn_tiles;';
  function_sql := substring(function_sql from 1 for start_position - 1)
    || replacement_sql
    || substring(function_sql from end_position + length(end_marker));
  execute function_sql;
end;
$$;

revoke all on function public.draw_match_tiles_for_rack(jsonb, jsonb, integer) from public;
revoke all on function public.exchange_match_tiles(uuid, integer, text[]) from public;
grant execute on function public.exchange_match_tiles(uuid, integer, text[]) to authenticated;
