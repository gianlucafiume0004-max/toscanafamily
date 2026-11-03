create table if not exists public.animators_candidates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null,
  website text,
  website_domain text,
  phone text,
  phone_normalized text,
  facebook text,
  instagram text,
  email text,
  city text,
  province text,
  description text,
  tags text[] not null default '{}',
  source text not null,
  source_url text,
  dedupe_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'imported')),
  discovered_at timestamptz not null default now(),
  reviewed_at timestamptz,
  review_notes text,
  constraint animators_candidates_dedupe_key_key unique (dedupe_key)
);

create index if not exists animators_candidates_status_idx
  on public.animators_candidates (status);
create index if not exists animators_candidates_domain_idx
  on public.animators_candidates (website_domain);
create index if not exists animators_candidates_phone_idx
  on public.animators_candidates (phone_normalized);
create index if not exists animators_candidates_instagram_idx
  on public.animators_candidates (lower(instagram));

-- Tabella di staging: accessibile solo con service role (nessuna policy pubblica).
alter table public.animators_candidates enable row level security;
