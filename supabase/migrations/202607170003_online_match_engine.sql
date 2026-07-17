-- Authoritative two-player match engine for the 8x8 board.

alter table public.matches
  add column consecutive_passes integer not null default 0,
  add constraint matches_consecutive_passes_check check (consecutive_passes >= 0);

create or replace function public.empty_match_board()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[[null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null]]'::jsonb;
$$;

create or replace function public.make_match_tile_bag()
returns jsonb
language sql
volatile
set search_path = ''
as $$
  with definitions(letter, amount, points) as (
    values
      (null::text, 2, 0), ('А', 11, 1), ('И', 9, 1), ('Е', 8, 1),
      ('О', 8, 1), ('Н', 6, 1), ('Р', 6, 1), ('С', 5, 1),
      ('Т', 5, 1), ('У', 4, 1), ('Д', 3, 1), ('В', 4, 2),
      ('К', 4, 2), ('М', 4, 2), ('Л', 3, 2), ('П', 3, 2),
      ('З', 2, 3), ('Ј', 2, 3), ('Б', 2, 4), ('Г', 2, 4),
      ('Њ', 1, 5), ('Ц', 1, 5), ('Ч', 1, 5), ('Ш', 1, 5),
      ('Ћ', 1, 7), ('Х', 1, 7), ('Ж', 1, 8), ('Љ', 1, 8),
      ('Ђ', 1, 10), ('Ф', 1, 10), ('Џ', 1, 10)
  ), tiles as (
    select jsonb_build_object(
      'id', gen_random_uuid()::text,
      'letter', definition.letter,
      'value', definition.points
    ) as tile
    from definitions definition
    cross join lateral generate_series(1, definition.amount)
  )
  select coalesce(jsonb_agg(tile order by random()), '[]'::jsonb) from tiles;
$$;

create or replace function public.match_board_has_tile(
  p_board jsonb,
  p_row integer,
  p_col integer
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_row between 0 and 7
    and p_col between 0 and 7
    and coalesce(jsonb_typeof(p_board #> array[p_row::text, p_col::text]), 'null') <> 'null';
$$;

create or replace function public.collect_match_word(
  p_board jsonb,
  p_row integer,
  p_col integer,
  p_direction text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  row_step integer := case when p_direction = 'vertical' then 1 else 0 end;
  col_step integer := case when p_direction = 'horizontal' then 1 else 0 end;
  cursor_row integer := p_row;
  cursor_col integer := p_col;
  positions jsonb := '[]'::jsonb;
  word_text text := '';
  cell jsonb;
begin
  if p_direction not in ('horizontal', 'vertical') then
    raise exception 'Invalid word direction';
  end if;

  while public.match_board_has_tile(
    p_board,
    cursor_row - row_step,
    cursor_col - col_step
  ) loop
    cursor_row := cursor_row - row_step;
    cursor_col := cursor_col - col_step;
  end loop;

  while public.match_board_has_tile(p_board, cursor_row, cursor_col) loop
    cell := p_board #> array[cursor_row::text, cursor_col::text];
    positions := positions || jsonb_build_array(
      jsonb_build_object('row', cursor_row, 'col', cursor_col)
    );
    word_text := word_text || (cell ->> 'letter');
    cursor_row := cursor_row + row_step;
    cursor_col := cursor_col + col_step;
  end loop;

  return jsonb_build_object('word', word_text, 'positions', positions);
end;
$$;

create or replace function public.match_premium(
  p_row integer,
  p_col integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_row, p_col) in ((0,0),(0,7),(7,0),(7,7)) then 'word3'
    when (p_row, p_col) in ((1,1),(1,6),(3,3),(3,4),(4,3),(4,4),(6,1),(6,6)) then 'word2'
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
  where ordinal between 1 and 7;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into second_rack
  from jsonb_array_elements(bag) with ordinality as tile(value, ordinal)
  where ordinal between 8 and 14;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into remaining_bag
  from jsonb_array_elements(bag) with ordinality as tile(value, ordinal)
  where ordinal > 14;

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

create or replace function public.join_match(
  p_invite_code text,
  p_display_name text default null
)
returns table(match_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_name text := btrim(coalesce(p_display_name, ''));
  selected_match public.matches%rowtype;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select * into selected_match
  from public.matches candidate
  where candidate.invite_code = upper(btrim(p_invite_code))
  for update;

  if not found then raise exception 'Match not found'; end if;

  if exists (
    select 1 from public.match_players participant
    where participant.match_id = selected_match.id and participant.user_id = caller_id
  ) then
    return query select selected_match.id, selected_match.invite_code;
    return;
  end if;

  if selected_match.status <> 'waiting' then
    raise exception 'Match is no longer open';
  end if;

  insert into public.profiles (id, display_name)
  values (
    caller_id,
    case when char_length(clean_name) between 2 and 24
      then clean_name else 'Играч ' || left(caller_id::text, 6) end
  )
  on conflict (id) do update set display_name = case
    when char_length(clean_name) between 2 and 24 then clean_name
    else public.profiles.display_name end;

  insert into public.match_players (match_id, user_id, seat)
  values (selected_match.id, caller_id, 2);
  insert into public.player_racks (match_id, user_id)
  values (selected_match.id, caller_id);

  perform public.initialize_match_tiles(selected_match.id);
  return query select selected_match.id, selected_match.invite_code;
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

create or replace function public.submit_match_move(
  p_match_id uuid,
  p_expected_version integer,
  p_placements jsonb
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
  placement jsonb;
  rack_tile jsonb;
  board_tile jsonb;
  next_board jsonb;
  cell jsonb;
  tile_id text;
  final_letter text;
  row_index integer;
  col_index integer;
  placement_count integer;
  distinct_rows integer;
  distinct_cols integer;
  start_coordinate integer;
  end_coordinate integer;
  coordinate integer;
  board_was_empty boolean;
  connected boolean := false;
  main_direction text;
  word_data jsonb;
  word_position jsonb;
  word_text text;
  word_score integer;
  letter_score integer;
  word_multiplier integer;
  letter_multiplier integer;
  premium text;
  formed_words text[] := array[]::text[];
  word_payload jsonb := '[]'::jsonb;
  total_score integer := 0;
  used_ids text[] := array[]::text[];
  used_coordinates text[] := array[]::text[];
  remaining_rack jsonb;
  drawn_tiles jsonb;
  next_rack jsonb;
  next_bag jsonb;
  draw_count integer;
  next_player uuid;
  winner uuid;
begin
  if caller_id is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if jsonb_typeof(p_placements) <> 'array' then raise exception 'Placements must be an array'; end if;
  placement_count := jsonb_array_length(p_placements);
  if placement_count < 1 or placement_count > 7 then raise exception 'Place between one and seven tiles'; end if;

  select * into match_row from public.matches where id = p_match_id for update;
  if not found or not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  if match_row.status <> 'active' then raise exception 'Match is not active'; end if;
  if match_row.current_player_id <> caller_id then raise exception 'It is not your turn'; end if;
  if match_row.version <> p_expected_version then raise exception 'Match changed; reload and try again'; end if;

  select * into rack_row from public.player_racks
  where match_id = p_match_id and user_id = caller_id for update;
  select * into private_row from public.match_private_state
  where match_id = p_match_id for update;

  next_board := match_row.board;
  board_was_empty := not exists (
    select 1 from jsonb_array_elements(match_row.board) board_row
    cross join lateral jsonb_array_elements(board_row.value) board_cell
    where jsonb_typeof(board_cell.value) <> 'null'
  );

  for placement in select value from jsonb_array_elements(p_placements) loop
    row_index := (placement ->> 'row')::integer;
    col_index := (placement ->> 'col')::integer;
    tile_id := placement ->> 'tileId';
    if row_index not between 0 and 7 or col_index not between 0 and 7 then raise exception 'Placement is outside the board'; end if;
    if tile_id is null or tile_id = any(used_ids) then raise exception 'Invalid or repeated tile'; end if;
    if (row_index::text || '-' || col_index::text) = any(used_coordinates) then raise exception 'Repeated board position'; end if;
    if public.match_board_has_tile(next_board, row_index, col_index) then raise exception 'Board position is occupied'; end if;

    select value into rack_tile from jsonb_array_elements(rack_row.rack)
    where value ->> 'id' = tile_id;
    if rack_tile is null then raise exception 'Tile is not in your rack'; end if;

    if jsonb_typeof(rack_tile -> 'letter') = 'null' then
      final_letter := upper(btrim(coalesce(placement ->> 'letter', '')));
      if char_length(final_letter) <> 1 or final_letter !~ '^[АБВГДЂЕЖЗИЈКЛЉМНЊОПРСТЋУФХЦЧЏШ]$' then
        raise exception 'Choose a Serbian letter for the blank tile';
      end if;
    else
      final_letter := rack_tile ->> 'letter';
    end if;

    board_tile := jsonb_build_object(
      'id', tile_id,
      'letter', final_letter,
      'value', (rack_tile ->> 'value')::integer,
      'isBlank', jsonb_typeof(rack_tile -> 'letter') = 'null',
      'committed', true
    );
    next_board := jsonb_set(next_board, array[row_index::text, col_index::text], board_tile, false);
    used_ids := array_append(used_ids, tile_id);
    used_coordinates := array_append(used_coordinates, row_index::text || '-' || col_index::text);
  end loop;

  select count(distinct (value ->> 'row')::integer), count(distinct (value ->> 'col')::integer)
  into distinct_rows, distinct_cols from jsonb_array_elements(p_placements);
  if distinct_rows > 1 and distinct_cols > 1 then raise exception 'New tiles must share one row or column'; end if;

  select (value ->> 'row')::integer, (value ->> 'col')::integer
  into row_index, col_index from jsonb_array_elements(p_placements) limit 1;
  if distinct_rows = 1 then
    select min((value ->> 'col')::integer), max((value ->> 'col')::integer)
    into start_coordinate, end_coordinate from jsonb_array_elements(p_placements);
    for coordinate in start_coordinate..end_coordinate loop
      if not public.match_board_has_tile(next_board, row_index, coordinate) then raise exception 'Tiles cannot contain a gap'; end if;
    end loop;
  else
    select min((value ->> 'row')::integer), max((value ->> 'row')::integer)
    into start_coordinate, end_coordinate from jsonb_array_elements(p_placements);
    for coordinate in start_coordinate..end_coordinate loop
      if not public.match_board_has_tile(next_board, coordinate, col_index) then raise exception 'Tiles cannot contain a gap'; end if;
    end loop;
  end if;

  if board_was_empty then
    if not ('3-3' = any(used_coordinates)) then raise exception 'First word must cover the star'; end if;
  else
    for placement in select value from jsonb_array_elements(p_placements) loop
      row_index := (placement ->> 'row')::integer;
      col_index := (placement ->> 'col')::integer;
      connected := connected
        or public.match_board_has_tile(match_row.board, row_index - 1, col_index)
        or public.match_board_has_tile(match_row.board, row_index + 1, col_index)
        or public.match_board_has_tile(match_row.board, row_index, col_index - 1)
        or public.match_board_has_tile(match_row.board, row_index, col_index + 1);
    end loop;
    if not connected then raise exception 'Move must connect to the board'; end if;
  end if;

  if placement_count > 1 then
    main_direction := case when distinct_rows = 1 then 'horizontal' else 'vertical' end;
  else
    main_direction := case
      when public.match_board_has_tile(next_board, row_index, col_index - 1)
        or public.match_board_has_tile(next_board, row_index, col_index + 1)
      then 'horizontal' else 'vertical' end;
  end if;

  word_data := public.collect_match_word(next_board, row_index, col_index, main_direction);
  if jsonb_array_length(word_data -> 'positions') < 2 then raise exception 'Move must form a word of at least two letters'; end if;
  word_payload := word_payload || jsonb_build_array(word_data);

  for placement in select value from jsonb_array_elements(p_placements) loop
    row_index := (placement ->> 'row')::integer;
    col_index := (placement ->> 'col')::integer;
    word_data := public.collect_match_word(
      next_board, row_index, col_index,
      case when main_direction = 'horizontal' then 'vertical' else 'horizontal' end
    );
    if jsonb_array_length(word_data -> 'positions') >= 2 then
      word_payload := word_payload || jsonb_build_array(word_data);
    end if;
  end loop;

  for word_data in select value from jsonb_array_elements(word_payload) loop
    word_text := lower(word_data ->> 'word');
    if not exists (
      select 1 from public.dictionary_words dictionary
      where dictionary.word = word_text and dictionary.status = 'accepted'
    ) then raise exception 'Dictionary does not accept: %', word_text; end if;

    letter_score := 0;
    word_multiplier := 1;
    for word_position in select value from jsonb_array_elements(word_data -> 'positions') loop
      row_index := (word_position ->> 'row')::integer;
      col_index := (word_position ->> 'col')::integer;
      cell := next_board #> array[row_index::text, col_index::text];
      letter_multiplier := 1;
      if (cell ->> 'id') = any(used_ids) then
        premium := public.match_premium(row_index, col_index);
        if premium = 'letter2' then letter_multiplier := 2; end if;
        if premium = 'letter3' then letter_multiplier := 3; end if;
        if premium = 'word2' then word_multiplier := word_multiplier * 2; end if;
        if premium = 'word3' then word_multiplier := word_multiplier * 3; end if;
      end if;
      letter_score := letter_score + ((cell ->> 'value')::integer * letter_multiplier);
    end loop;
    word_score := letter_score * word_multiplier;
    total_score := total_score + word_score;
    formed_words := array_append(formed_words, upper(word_text));
  end loop;

  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into remaining_rack
  from jsonb_array_elements(rack_row.rack) with ordinality tile(value, ordinal)
  where not ((value ->> 'id') = any(used_ids));
  draw_count := least(7 - jsonb_array_length(remaining_rack), jsonb_array_length(private_row.bag));
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into drawn_tiles from jsonb_array_elements(private_row.bag) with ordinality tile(value, ordinal)
  where ordinal <= draw_count;
  select coalesce(jsonb_agg(value order by ordinal), '[]'::jsonb)
  into next_bag from jsonb_array_elements(private_row.bag) with ordinality tile(value, ordinal)
  where ordinal > draw_count;
  next_rack := remaining_rack || drawn_tiles;

  update public.player_racks set rack = next_rack, updated_at = now()
  where match_id = p_match_id and user_id = caller_id;
  update public.match_private_state set bag = next_bag, updated_at = now()
  where match_id = p_match_id;
  update public.match_players set score = score + total_score
  where match_id = p_match_id and user_id = caller_id;
  insert into public.moves (match_id, turn_number, player_id, placements, formed_words, score_delta, board_after)
  values (p_match_id, match_row.turn_number, caller_id, p_placements, formed_words, total_score, next_board);

  if jsonb_array_length(next_bag) = 0 and jsonb_array_length(next_rack) = 0 then
    select user_id into winner from public.match_players
    where match_id = p_match_id
    order by score desc, seat asc limit 1;
    if (select count(distinct score) from public.match_players where match_id = p_match_id) = 1 then winner := null; end if;
    update public.matches set board = next_board, status = 'completed', winner_id = winner,
      current_player_id = null, turn_number = turn_number + 1,
      consecutive_passes = 0, version = version + 1 where id = p_match_id;
  else
    select user_id into next_player from public.match_players
    where match_id = p_match_id and user_id <> caller_id limit 1;
    update public.matches set board = next_board, current_player_id = next_player,
      turn_number = turn_number + 1, consecutive_passes = 0, version = version + 1
    where id = p_match_id;
  end if;

  return public.get_match_state(p_match_id);
end;
$$;

create or replace function public.pass_match_turn(
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
  next_player uuid;
  winner uuid;
begin
  select * into match_row from public.matches where id = p_match_id for update;
  if caller_id is null or not found or not public.is_match_participant(p_match_id) then raise exception 'Match access denied'; end if;
  if match_row.status <> 'active' or match_row.current_player_id <> caller_id then raise exception 'It is not your turn'; end if;
  if match_row.version <> p_expected_version then raise exception 'Match changed; reload and try again'; end if;

  if match_row.consecutive_passes + 1 >= 4 then
    select user_id into winner from public.match_players where match_id = p_match_id order by score desc, seat asc limit 1;
    if (select count(distinct score) from public.match_players where match_id = p_match_id) = 1 then winner := null; end if;
    update public.matches set status = 'completed', winner_id = winner, current_player_id = null,
      consecutive_passes = consecutive_passes + 1, version = version + 1 where id = p_match_id;
  else
    select user_id into next_player from public.match_players
    where match_id = p_match_id and user_id <> caller_id limit 1;
    update public.matches set current_player_id = next_player, turn_number = turn_number + 1,
      consecutive_passes = consecutive_passes + 1, version = version + 1 where id = p_match_id;
  end if;
  return public.get_match_state(p_match_id);
end;
$$;

revoke all on function public.empty_match_board() from public;
revoke all on function public.make_match_tile_bag() from public;
revoke all on function public.match_board_has_tile(jsonb, integer, integer) from public;
revoke all on function public.collect_match_word(jsonb, integer, integer, text) from public;
revoke all on function public.match_premium(integer, integer) from public;
revoke all on function public.initialize_match_tiles(uuid) from public;
revoke all on function public.get_match_state(uuid) from public;
revoke all on function public.submit_match_move(uuid, integer, jsonb) from public;
revoke all on function public.pass_match_turn(uuid, integer) from public;

grant execute on function public.get_match_state(uuid) to authenticated;
grant execute on function public.submit_match_move(uuid, integer, jsonb) to authenticated;
grant execute on function public.pass_match_turn(uuid, integer) to authenticated;
