-- Each player receives one turn per round. The match ends after five rounds
-- (ten submitted or passed turns), while the existing early-end rules remain.

create or replace function public.finish_match_after_five_rounds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  winning_player uuid;
  distinct_scores integer;
begin
  if old.status = 'active'
    and new.status = 'active'
    and new.turn_number > 10 then
    select player.user_id
    into winning_player
    from public.match_players as player
    where player.match_id = new.id
    order by player.score desc, player.seat asc
    limit 1;

    select count(distinct player.score)
    into distinct_scores
    from public.match_players as player
    where player.match_id = new.id;

    if distinct_scores <= 1 then
      winning_player := null;
    end if;

    new.status := 'completed';
    new.winner_id := winning_player;
    new.current_player_id := null;
  end if;

  return new;
end;
$$;

drop trigger if exists finish_match_after_five_rounds on public.matches;
create trigger finish_match_after_five_rounds
before update on public.matches
for each row execute function public.finish_match_after_five_rounds();

revoke all on function public.finish_match_after_five_rounds() from public;
