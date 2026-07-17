-- Local-first Auth and two-player lobby foundation.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_check
    check (char_length(btrim(display_name)) between 2 and 24)
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    case
      when char_length(requested_name) between 2 and 24 then requested_name
      else 'Играч ' || left(new.id::text, 6)
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.generate_invite_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select upper(left(replace(gen_random_uuid()::text, '-', ''), 6));
$$;

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  invite_code text not null unique default public.generate_invite_code(),
  status text not null default 'waiting',
  created_by uuid not null references public.profiles (id) on delete restrict,
  current_player_id uuid references public.profiles (id) on delete restrict,
  winner_id uuid references public.profiles (id) on delete restrict,
  board jsonb not null default '[]'::jsonb,
  turn_number integer not null default 0,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint matches_invite_code_check check (invite_code ~ '^[A-F0-9]{6}$'),
  constraint matches_status_check
    check (status in ('waiting', 'ready', 'active', 'completed', 'abandoned')),
  constraint matches_turn_number_check check (turn_number >= 0),
  constraint matches_version_check check (version >= 0)
);

create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

create table public.match_players (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  seat smallint not null,
  score integer not null default 0,
  joined_at timestamptz not null default now(),
  primary key (match_id, user_id),
  unique (match_id, seat),
  constraint match_players_seat_check check (seat in (1, 2)),
  constraint match_players_score_check check (score >= 0)
);

-- Hidden state never receives a browser table grant. Future authoritative RPCs
-- will own the tile bag and draws here.
create table public.match_private_state (
  match_id uuid primary key references public.matches (id) on delete cascade,
  bag jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.player_racks (
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  rack jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id),
  foreign key (match_id, user_id)
    references public.match_players (match_id, user_id) on delete cascade
);

create table public.moves (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.matches (id) on delete cascade,
  turn_number integer not null,
  player_id uuid not null references public.profiles (id) on delete restrict,
  placements jsonb not null,
  formed_words text[] not null default '{}',
  score_delta integer not null default 0,
  board_after jsonb not null,
  created_at timestamptz not null default now(),
  unique (match_id, turn_number),
  constraint moves_turn_number_check check (turn_number > 0),
  constraint moves_score_delta_check check (score_delta >= 0)
);

create index matches_invite_lookup_idx on public.matches (invite_code, status);
create index match_players_user_idx on public.match_players (user_id, joined_at desc);
create index moves_match_idx on public.moves (match_id, turn_number);

alter table public.profiles enable row level security;
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.match_private_state enable row level security;
alter table public.player_racks enable row level security;
alter table public.moves enable row level security;

create or replace function public.is_match_participant(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.match_players participant
    where participant.match_id = p_match_id
      and participant.user_id = auth.uid()
  );
$$;

create policy profiles_read_authenticated
on public.profiles for select
to authenticated
using (true);

create policy profiles_update_self
on public.profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy matches_read_participant
on public.matches for select
to authenticated
using (public.is_match_participant(id));

create policy match_players_read_participant
on public.match_players for select
to authenticated
using (public.is_match_participant(match_id));

create policy player_racks_read_own
on public.player_racks for select
to authenticated
using (user_id = auth.uid() and public.is_match_participant(match_id));

create policy moves_read_participant
on public.moves for select
to authenticated
using (public.is_match_participant(match_id));

create or replace function public.create_match(p_display_name text default null)
returns table(match_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_name text := btrim(coalesce(p_display_name, ''));
  created_match public.matches%rowtype;
  attempt integer;
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  insert into public.profiles (id, display_name)
  values (
    caller_id,
    case
      when char_length(clean_name) between 2 and 24 then clean_name
      else 'Играч ' || left(caller_id::text, 6)
    end
  )
  on conflict (id) do update
    set display_name = case
      when char_length(clean_name) between 2 and 24 then clean_name
      else public.profiles.display_name
    end;

  for attempt in 1..5 loop
    begin
      insert into public.matches (created_by, current_player_id)
      values (caller_id, caller_id)
      returning * into created_match;
      exit;
    exception when unique_violation then
      if attempt = 5 then raise; end if;
    end;
  end loop;

  insert into public.match_players (match_id, user_id, seat)
  values (created_match.id, caller_id, 1);
  insert into public.match_private_state (match_id) values (created_match.id);
  insert into public.player_racks (match_id, user_id)
  values (created_match.id, caller_id);

  return query select created_match.id, created_match.invite_code;
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

  if not found then
    raise exception 'Match not found';
  end if;

  if exists (
    select 1 from public.match_players participant
    where participant.match_id = selected_match.id
      and participant.user_id = caller_id
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
    case
      when char_length(clean_name) between 2 and 24 then clean_name
      else 'Играч ' || left(caller_id::text, 6)
    end
  )
  on conflict (id) do update
    set display_name = case
      when char_length(clean_name) between 2 and 24 then clean_name
      else public.profiles.display_name
    end;

  insert into public.match_players (match_id, user_id, seat)
  values (selected_match.id, caller_id, 2);
  insert into public.player_racks (match_id, user_id)
  values (selected_match.id, caller_id);

  update public.matches
  set status = 'ready', version = version + 1
  where id = selected_match.id;

  return query select selected_match.id, selected_match.invite_code;
end;
$$;

revoke all on public.profiles from anon, authenticated;
revoke all on public.matches from anon, authenticated;
revoke all on public.match_players from anon, authenticated;
revoke all on public.match_private_state from anon, authenticated;
revoke all on public.player_racks from anon, authenticated;
revoke all on public.moves from anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select on public.matches to authenticated;
grant select on public.match_players to authenticated;
grant select on public.player_racks to authenticated;
grant select on public.moves to authenticated;

revoke all on function public.is_match_participant(uuid) from public;
revoke all on function public.create_match(text) from public;
revoke all on function public.join_match(text, text) from public;
grant execute on function public.is_match_participant(uuid) to authenticated;
grant execute on function public.create_match(text) to authenticated;
grant execute on function public.join_match(text, text) to authenticated;

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_players;
alter publication supabase_realtime add table public.moves;
