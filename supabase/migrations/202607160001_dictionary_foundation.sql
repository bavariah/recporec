-- Foundation only. Deploy this to the future standalone Recograd Supabase project.
create table if not exists public.dictionary_words (
  word text primary key,
  tile_length smallint not null,
  status text not null default 'review',
  sources text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dictionary_words_normalized_check check (word = lower(btrim(word))),
  constraint dictionary_words_serbian_cyrillic_check
    check (word ~ '^[абвгдђежзијклљмнњопрстћуфхцчџш]+$'),
  constraint dictionary_words_length_check
    check (tile_length between 2 and 8 and char_length(word) = tile_length),
  constraint dictionary_words_status_check
    check (status in ('accepted', 'review', 'rejected'))
);

create index if not exists dictionary_words_lookup_idx
  on public.dictionary_words (word, status);

create index if not exists dictionary_words_review_idx
  on public.dictionary_words (tile_length, status, word);

alter table public.dictionary_words enable row level security;

-- Do not expose the entire dictionary table through the browser API. The RPC
-- returns only whether each submitted word is accepted.
create or replace function public.check_dictionary_words(p_words text[])
returns table(word text, accepted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    normalized.word,
    exists (
      select 1
      from public.dictionary_words dictionary
      where dictionary.word = normalized.word
        and dictionary.status = 'accepted'
    ) as accepted
  from (
    select distinct lower(btrim(candidate)) as word
    from unnest(coalesce(p_words, array[]::text[])) as candidate
    where candidate is not null and btrim(candidate) <> ''
  ) normalized;
$$;

revoke all on table public.dictionary_words from anon, authenticated;
revoke all on function public.check_dictionary_words(text[]) from public;
grant execute on function public.check_dictionary_words(text[]) to anon, authenticated;
