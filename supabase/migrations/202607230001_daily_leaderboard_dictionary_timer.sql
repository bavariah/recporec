-- Daily Challenge all-time ranking, reviewed report promotion, and 80-second quick turns.

create or replace function public.set_match_turn_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'active' or new.game_mode <> 'quick' or new.current_player_id is null then
    new.turn_deadline := null;
  elsif tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.current_player_id is distinct from new.current_player_id
    or old.turn_number is distinct from new.turn_number then
    new.turn_deadline := now() + interval '80 seconds';
  end if;
  return new;
end;
$$;

-- Give any quick turn already in progress the newly added 20 seconds.
update public.matches
set turn_deadline = turn_deadline + interval '20 seconds'
where status = 'active'
  and game_mode = 'quick'
  and turn_deadline > now();

do $$
declare
  promoted_words integer := 0;
  accepted_reports integer := 0;
begin
  insert into public.dictionary_words as dictionary (word, tile_length, status, sources, notes)
  select
    candidate.word,
    char_length(candidate.word)::smallint,
    'accepted',
    array['player-report']::text[],
    'Promoted from player reports on 2026-07-23.'
  from (
    select distinct lower(btrim(report.word)) as word
    from public.word_reports report
    where report.status = 'pending'
  ) candidate
  where char_length(candidate.word) between 2 and 8
    and candidate.word ~ '^[абвгдђежзијклљмнњопрстћуфхцчџш]+$'
  on conflict (word) do update
    set status = 'accepted',
        sources = case
          when 'player-report' = any(dictionary.sources)
            then dictionary.sources
          else array_append(dictionary.sources, 'player-report')
        end,
        notes = coalesce(dictionary.notes, excluded.notes),
        updated_at = now();

  get diagnostics promoted_words = row_count;

  update public.word_reports report
  set status = 'accepted'
  where report.status = 'pending'
    and exists (
      select 1
      from public.dictionary_words dictionary
      where dictionary.word = lower(btrim(report.word))
        and dictionary.status = 'accepted'
    );

  get diagnostics accepted_reports = row_count;
  raise notice 'Promoted % dictionary words and accepted % reports.', promoted_words, accepted_reports;
end;
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
  ), today_ranked as (
    select result.user_id, profile.display_name, profile.avatar_key, profile.avatar_path,
      result.score, result.completed_at,
      row_number() over (order by result.score desc, result.completed_at asc) as rank
    from public.daily_challenge_results result
    join public.profiles profile on profile.id = result.user_id
    cross join settings
    where result.challenge_date = settings.challenge_day
  ), overall_totals as (
    select
      result.user_id,
      profile.display_name,
      profile.avatar_key,
      profile.avatar_path,
      count(*)::bigint as challenges_played,
      sum(result.score)::bigint as total_score,
      max(result.score)::integer as best_score,
      round(avg(result.score)::numeric, 1) as average_score
    from public.daily_challenge_results result
    join public.profiles profile on profile.id = result.user_id
    group by result.user_id, profile.display_name, profile.avatar_key, profile.avatar_path
  ), overall_ranked as (
    select overall_totals.*,
      row_number() over (
        order by total_score desc, best_score desc, average_score desc, display_name
      ) as rank
    from overall_totals
  ), gaps as (
    select offset_day
    from generate_series(0, 365) offset_day
    cross join settings
    where not exists (
      select 1 from public.daily_challenge_results result
      where result.user_id = auth.uid()
        and result.challenge_date = settings.challenge_day - offset_day
    )
    order by offset_day
    limit 1
  )
  select jsonb_build_object(
    'date', settings.challenge_day,
    'best', coalesce((select score from today_ranked where user_id = auth.uid()), 0),
    'rank', (select rank from today_ranked where user_id = auth.uid()),
    'streak', coalesce((select offset_day from gaps), 366),
    'entries', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', user_id,
      'display_name', display_name,
      'avatar_key', avatar_key,
      'avatar_path', avatar_path,
      'score', score,
      'rank', rank
    ) order by rank) from (
      select * from today_ranked order by rank limit 50
    ) leaders), '[]'::jsonb),
    'overall_rank', (select rank from overall_ranked where user_id = auth.uid()),
    'overall_count', (select count(*) from overall_ranked),
    'overall_entries', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', user_id,
      'display_name', display_name,
      'avatar_key', avatar_key,
      'avatar_path', avatar_path,
      'challenges_played', challenges_played,
      'total_score', total_score,
      'best_score', best_score,
      'average_score', average_score,
      'rank', rank
    ) order by rank) from (
      select * from overall_ranked order by rank limit 50
    ) overall_leaders), '[]'::jsonb)
  ) from settings;
$$;
