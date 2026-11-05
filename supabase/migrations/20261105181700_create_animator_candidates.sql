create table if not exists public.animator_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  phone text,
  normalized_phone text,
  website text,
  website_domain text,
  facebook_url text,
  instagram_url text,
  city text,
  province text,
  services text[] not null default '{}',
  coverage_area text,
  source_urls text[] not null default '{}',
  field_sources jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}',
  quality_score smallint not null default 0
    check (quality_score between 0 and 100),
  discovery_locations text[] not null default '{}',
  discovery_run_id text not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected', 'duplicate')),
  approved_provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists animator_candidates_status_idx
  on public.animator_candidates (status);

create index if not exists animator_candidates_run_idx
  on public.animator_candidates (discovery_run_id);

create index if not exists animator_candidates_name_idx
  on public.animator_candidates (normalized_name);

create index if not exists animator_candidates_phone_idx
  on public.animator_candidates (normalized_phone)
  where normalized_phone is not null;

create index if not exists animator_candidates_website_idx
  on public.animator_candidates (website_domain)
  where website_domain is not null;

alter table public.animator_candidates enable row level security;

revoke all on table public.animator_candidates from public, anon, authenticated;
grant all on table public.animator_candidates to service_role;

create policy "Service role manages animator candidates"
  on public.animator_candidates
  for all
  to service_role
  using (true)
  with check (true);
