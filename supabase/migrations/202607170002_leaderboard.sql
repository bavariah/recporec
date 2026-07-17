-- Public aggregate leaderboard. Individual match access remains participant-only.

create or replace function public.get_leaderboard(p_limit integer default 50)
returns table (
  user_id uuid,
  display_name text,
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
  group by player.user_id, profile.display_name
  order by total_points desc, wins desc, average_points desc, profile.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke all on function public.get_leaderboard(integer) from public;
grant execute on function public.get_leaderboard(integer) to anon, authenticated;
