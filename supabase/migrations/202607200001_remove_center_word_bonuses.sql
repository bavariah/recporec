-- Keep the centre of the 9x9 board open: the star and its four inner
-- diagonals do not multiply a word.

create or replace function public.match_premium(p_row integer, p_col integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_row, p_col) in ((0,0),(0,8),(8,0),(8,8)) then 'word3'
    when (p_row, p_col) in ((1,1),(1,7),(7,1),(7,7)) then 'word2'
    when (p_row, p_col) in ((1,4),(2,2),(2,6),(4,1),(4,7),(6,2),(6,6),(7,4)) then 'letter3'
    when (p_row, p_col) in ((0,3),(0,5),(1,2),(1,6),(2,1),(2,7),(3,0),(3,4),(3,8),(4,3),(4,5),(5,0),(5,4),(5,8),(6,1),(6,7),(7,2),(7,6),(8,3),(8,5)) then 'letter2'
    else null
  end;
$$;
