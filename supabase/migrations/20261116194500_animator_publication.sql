-- Apply to staging and production before enabling publication.
alter table public.providers
  add column if not exists address text,
  add column if not exists active boolean not null default true,
  add column if not exists source text,
  add column if not exists slug text,
  add column if not exists normalized_name text,
  add column if not exists animator_candidate_id uuid;

create unique index if not exists providers_animator_candidate_id_uidx
  on public.providers (animator_candidate_id);

do $$
begin
  if to_regclass('public.animator_candidates') is not null then
    alter table public.animator_candidates
      add column if not exists published_at timestamptz;

    create index if not exists animator_candidates_status_idx
      on public.animator_candidates(status);

    create index if not exists animator_candidates_published_at_idx
      on public.animator_candidates(published_at);

    alter table public.animator_candidates
      drop constraint if exists animator_candidates_status_check;
    alter table public.animator_candidates
      add constraint animator_candidates_status_check
      check (status in ('pending_review', 'approved', 'approved_auto',
                        'approved_probable', 'rejected', 'duplicate'));
  end if;
end;
$$;

create index if not exists providers_normalized_name_idx
  on public.providers(normalized_name);

create index if not exists providers_slug_idx
  on public.providers(slug);
