-- Move new and active matches to a 9x9 board with a bonus-free centre star.

create or replace function public.empty_match_board()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '[[null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null],
           [null,null,null,null,null,null,null,null,null]]'::jsonb;
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
  select p_row between 0 and 8
    and p_col between 0 and 8
    and coalesce(jsonb_typeof(p_board #> array[p_row::text, p_col::text]), 'null') <> 'null';
$$;

create or replace function public.match_premium(p_row integer, p_col integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_row, p_col) in ((0,0),(0,8),(8,0),(8,8)) then 'word3'
    when (p_row, p_col) in ((1,1),(1,7),(3,3),(3,5),(5,3),(5,5),(7,1),(7,7)) then 'word2'
    when (p_row, p_col) in ((1,4),(2,2),(2,6),(4,1),(4,7),(6,2),(6,6),(7,4)) then 'letter3'
    when (p_row, p_col) in ((0,3),(0,5),(1,2),(1,6),(2,1),(2,7),(3,0),(3,4),(3,8),(4,3),(4,5),(5,0),(5,4),(5,8),(6,1),(6,7),(7,2),(7,6),(8,3),(8,5)) then 'letter2'
    else null
  end;
$$;

-- Preserve any in-progress 8x8 match by extending its rows and adding one new
-- row. Existing committed tiles stay at their coordinates and future moves use
-- the new 9x9 limits and premium map.
update public.matches match
set board = (
  select jsonb_agg(board_row.value || '[null]'::jsonb order by board_row.ordinality)
    || '[[null,null,null,null,null,null,null,null,null]]'::jsonb
  from jsonb_array_elements(match.board) with ordinality as board_row(value, ordinality)
)
where jsonb_array_length(match.board) = 8
  and not exists (
    select 1
    from jsonb_array_elements(match.board) as existing_row(value)
    where jsonb_array_length(existing_row.value) <> 8
  );

-- The authoritative move function only has two board-shape literals. Patch
-- those literals while retaining the current rack, dictionary, round, and
-- vowel-balancing behavior supplied by earlier migrations.
do $migration$
declare
  previous_definition text;
  updated_definition text;
begin
  select pg_get_functiondef(
    'public.submit_match_move(uuid,integer,jsonb)'::regprocedure
  ) into previous_definition;

  updated_definition := replace(
    previous_definition,
    'row_index not between 0 and 7 or col_index not between 0 and 7',
    'row_index not between 0 and 8 or col_index not between 0 and 8'
  );

  if updated_definition = previous_definition then
    raise exception 'Could not update submit_match_move board limits';
  end if;

  previous_definition := updated_definition;
  updated_definition := replace(
    previous_definition,
    '''3-3'' = any(used_coordinates)',
    '''4-4'' = any(used_coordinates)'
  );

  if updated_definition = previous_definition then
    raise exception 'Could not update submit_match_move centre star';
  end if;

  execute updated_definition;
end;
$migration$;
