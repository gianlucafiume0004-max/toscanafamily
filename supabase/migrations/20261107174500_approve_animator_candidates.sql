alter table public.providers
  add column if not exists provider_kind text,
  add column if not exists provider_type text,
  add column if not exists party_type text,
  add column if not exists social_url text,
  add column if not exists services text,
  add column if not exists coverage_area text,
  add column if not exists notes text,
  add column if not exists status text default 'partial';

do $$
begin
  if exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.providers'::regclass
      and c.conname = 'providers_provider_type_check'
      and pg_get_constraintdef(c.oid) not like '%''feste''%'
  ) then
    raise exception 'Prerequisito mancante: applicare la migration di unificazione delle categorie provider prima di questa migration';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'providers'
      and column_name = 'provider_type'
  ) then
    execute $migration$
      update public.providers
      set provider_kind = case
        when provider_type in ('playroom', 'baby_parking', 'creative_workshop', 'educational_farm', 'other') then 'play_center'
        when provider_type in ('inflatable_rental', 'photographer', 'catering') then 'feste'
        else provider_type
      end
      where provider_kind is null
    $migration$;
  end if;

  execute $migration$
    update public.providers
    set provider_type = case when provider_kind = 'play_center' then 'other' else provider_kind end
    where provider_type is null
      and provider_kind is not null
  $migration$;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'providers'
      and column_name = 'categories'
  ) then
    execute $migration$
      update public.providers
      set services = array_to_string(categories, '; ')
      where services is null
        and cardinality(categories) > 0
    $migration$;

    execute $migration$
      update public.providers
      set party_type = 'animatore'
      where provider_kind = 'feste'
        and party_type is null
        and categories && array['animatori', 'animator', 'animatore']::text[]
    $migration$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'providers'
      and column_name = 'service_areas'
  ) then
    execute $migration$
      update public.providers
      set coverage_area = array_to_string(service_areas, '; ')
      where coverage_area is null
        and cardinality(service_areas) > 0
    $migration$;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'providers'
      and column_name = 'facebook'
  ) and exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'providers'
      and column_name = 'instagram'
  ) then
    execute $migration$
      update public.providers
      set social_url = nullif(
        concat_ws('; ', nullif(facebook, ''), nullif(instagram, '')),
        ''
      )
      where social_url is null
    $migration$;
  end if;
end;
$$;

create or replace function public.sync_legacy_provider_type()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.provider_type is null and new.provider_kind is not null then
      new.provider_type := case when new.provider_kind = 'play_center' then 'other' else new.provider_kind end;
    elsif new.provider_kind is null and new.provider_type is not null then
      new.provider_kind := case
        when new.provider_type in ('playroom', 'baby_parking', 'creative_workshop', 'educational_farm', 'other') then 'play_center'
        when new.provider_type in ('animator', 'party_room', 'inflatable_rental', 'photographer', 'catering') then 'feste'
        else new.provider_type
      end;
    end if;
  elsif new.provider_kind is distinct from old.provider_kind
    and new.provider_type is not distinct from old.provider_type then
    new.provider_type := case when new.provider_kind = 'play_center' then 'other' else new.provider_kind end;
  elsif new.provider_type is distinct from old.provider_type
    and new.provider_kind is not distinct from old.provider_kind then
    new.provider_kind := case
      when new.provider_type in ('playroom', 'baby_parking', 'creative_workshop', 'educational_farm', 'other') then 'play_center'
      when new.provider_type in ('animator', 'party_room', 'inflatable_rental', 'photographer', 'catering') then 'feste'
      else new.provider_type
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_legacy_provider_type()
  from public, anon, authenticated;

drop trigger if exists sync_legacy_provider_type on public.providers;
create trigger sync_legacy_provider_type
before insert or update of provider_kind, provider_type on public.providers
for each row execute function public.sync_legacy_provider_type();

create table public.provider_animator_identity_keys (
  identity_kind text not null
    check (identity_kind in ('phone', 'website', 'social')),
  identity_value text not null,
  provider_id text not null,
  primary key (identity_kind, identity_value, provider_id)
);

alter table public.provider_animator_identity_keys enable row level security;
revoke all on table public.provider_animator_identity_keys
  from public, anon, authenticated;
grant all on table public.provider_animator_identity_keys to service_role;

create index provider_animator_identity_provider_idx
  on public.provider_animator_identity_keys (provider_id);

create or replace function public.animator_identity_values(
  p_phone text,
  p_website text,
  p_social_urls text
)
returns table(identity_kind text, identity_value text)
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  with phone_digits as (
    select regexp_replace(value, '[^0-9]', '', 'g') as value
    from regexp_split_to_table(
      coalesce(p_phone, ''),
      '[;,]|[[:space:]]+oppure[[:space:]]+'
    ) as phones(value)
  ),
  normalized_phone as (
    select case
      when left(value, 4) = '0039' then substring(value from 5)
      when left(value, 2) = '39' and length(value) > 10
        then substring(value from 3)
      else value
    end as value
    from phone_digits
  ),
  normalized_website as (
    select regexp_replace(
      regexp_replace(
        regexp_replace(lower(btrim(coalesce(p_website, ''))),
          '^https?://', '', 'i'),
        '^www\.', '', 'i'),
      '[/#?].*$', '')
    as value
  ),
  normalized_social_urls as (
    select case
      when lower(btrim(value)) ~
        '^(https?://)?(www\.|m\.)?facebook\.com/profile\.php\?id='
        then regexp_replace(
          regexp_replace(lower(btrim(value)),
            '^https?://(www\.|m\.)?', '', 'i'),
          '&.*$', '')
      else regexp_replace(
        regexp_replace(
          regexp_replace(lower(btrim(value)),
            '^https?://(www\.|m\.)?', '', 'i'),
          '[?#].*$', ''),
        '/+$', '')
    end as value
    from regexp_split_to_table(coalesce(p_social_urls, ''), '[;[:space:]]+') as s(value)
  ),
  normalized_socials as (
    select case
      when value ~ '^facebook\.com/profile\.php\?id=[^&/]+$'
        then 'facebook:id:' || substring(value from '\?id=([^&/]+)')
      when value ~ '^facebook\.com/pages/[^/]+/[^/]+$'
        then 'facebook:id:' || substring(value from '^facebook\.com/pages/[^/]+/([^/]+)$')
      when value ~ '^facebook\.com/people/[^/]+/[^/]+$'
        then 'facebook:id:' || substring(value from '^facebook\.com/people/[^/]+/([^/]+)$')
      when value ~ '^facebook\.com/'
        then 'facebook:' || split_part(substring(value from '^facebook\.com/([^/]+)'), '/', 1)
      when value ~ '^fb\.com/'
        then 'facebook:' || split_part(substring(value from '^fb\.com/([^/]+)'), '/', 1)
      when value ~ '^instagram\.com/'
        then 'instagram:' || split_part(substring(value from '^instagram\.com/([^/]+)'), '/', 1)
      else null
    end as value
    from normalized_social_urls
    where value <> ''
  )
  select 'phone'::text, value
    from normalized_phone
    where length(value) between 8 and 11
  union
  select 'website'::text, value
    from normalized_website
    where value <> ''
  union
  select 'social'::text, value
    from normalized_socials
    where value is not null
      and value !~ ':(groups|events|watch|share|sharer|login|plugins|p|reel|reels|explore|accounts|stories)$'
$$;

insert into public.provider_animator_identity_keys (
  identity_kind, identity_value, provider_id
)
select
  identities.identity_kind,
  identities.identity_value,
  p.id::text
from public.providers p
cross join lateral public.animator_identity_values(
  p.phone,
  p.website,
  p.social_url
) identities
where p.provider_kind = 'feste'
  and p.party_type = 'animatore';

create or replace function public.sync_animator_provider_identity_keys()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  identity record;
  conflicting_provider_id text;
  previously_present boolean;
begin
  perform pg_advisory_xact_lock(
    hashtext('approve_animator_candidate')::bigint
  );

  if tg_op in ('UPDATE', 'DELETE') then
    if old.provider_kind = 'feste' and old.party_type = 'animatore' then
      delete from public.provider_animator_identity_keys
      where provider_id = old.id::text;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.provider_kind = 'feste' and new.party_type = 'animatore' then
    for identity in
      select *
      from public.animator_identity_values(
        new.phone,
        new.website,
        new.social_url
      )
      order by identity_kind, identity_value
    loop
      previously_present := false;
      if tg_op = 'UPDATE' then
        if old.provider_kind = 'feste' and old.party_type = 'animatore' then
          select exists (
            select 1
            from public.animator_identity_values(
              old.phone, old.website, old.social_url
            ) previous_identity
            where previous_identity.identity_kind = identity.identity_kind
              and previous_identity.identity_value = identity.identity_value
          ) into previously_present;
        end if;
      end if;

      select k.provider_id
      into conflicting_provider_id
      from public.provider_animator_identity_keys k
      where k.identity_kind = identity.identity_kind
        and k.identity_value = identity.identity_value
        and k.provider_id <> new.id::text
      limit 1;

      if conflicting_provider_id is not null and not previously_present then
        raise exception 'Duplicato animatore: % già associato al provider %',
          identity.identity_kind, conflicting_provider_id
          using errcode = '23505';
      end if;

      insert into public.provider_animator_identity_keys (
        identity_kind, identity_value, provider_id
      )
      values (identity.identity_kind, identity.identity_value, new.id::text);
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_animator_provider_identity_keys()
  from public, anon, authenticated;

drop trigger if exists sync_animator_provider_identity_keys_insert on public.providers;
create trigger sync_animator_provider_identity_keys_insert
after insert on public.providers
for each row
execute function public.sync_animator_provider_identity_keys();

drop trigger if exists sync_animator_provider_identity_keys_update on public.providers;
create trigger sync_animator_provider_identity_keys_update
after update on public.providers
for each row
when (
  old.id is distinct from new.id
  or old.provider_kind is distinct from new.provider_kind
  or old.party_type is distinct from new.party_type
  or old.phone is distinct from new.phone
  or old.website is distinct from new.website
  or old.social_url is distinct from new.social_url
)
execute function public.sync_animator_provider_identity_keys();

drop trigger if exists sync_animator_provider_identity_keys_delete on public.providers;
create trigger sync_animator_provider_identity_keys_delete
after delete on public.providers
for each row
execute function public.sync_animator_provider_identity_keys();

create or replace function public.approve_animator_candidate(
  p_candidate_id uuid,
  p_city text,
  p_province text
)
returns table(status text, provider_id text, provider_name text, matches jsonb)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  candidate public.animator_candidates%rowtype;
  matched_provider_id text;
  matched_provider_name text;
  matched_providers jsonb;
  matched_provider_count integer;
  new_provider_id text;
  provider_id_type text;
  generated_provider_id text;
  name_slug text;
  city_slug text;
  social_urls text;
begin
  perform pg_advisory_xact_lock(
    hashtext('approve_animator_candidate')::bigint
  );

  select *
  into candidate
  from public.animator_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'Candidato non trovato: %', p_candidate_id;
  end if;

  if candidate.status = 'approved'
    and candidate.approved_provider_id is not null
  then
    select p.id::text, p.name
    into matched_provider_id, matched_provider_name
    from public.providers p
    where p.id::text = candidate.approved_provider_id;

    if not found then
      raise exception 'Il provider approvato % non esiste',
        candidate.approved_provider_id;
    end if;

    return query
      select 'approved'::text, matched_provider_id, matched_provider_name, '[]'::jsonb;
    return;
  end if;

  if candidate.status <> 'pending_review' then
    raise exception 'Candidato % non approvabile: stato %',
      candidate.name, candidate.status;
  end if;

  if nullif(btrim(p_city), '') is null
    or upper(btrim(coalesce(p_province, ''))) !~
      '^(AR|FI|GR|LI|LU|MS|PI|PO|PT|SI)$'
  then
    raise exception 'Comune e sigla di provincia toscana validi sono obbligatori';
  end if;

  social_urls := concat_ws('; ', candidate.facebook_url, candidate.instagram_url);

  if not exists (
    select 1
    from public.animator_identity_values(
      candidate.phone, candidate.website, social_urls
    )
  ) then
    raise exception 'Il candidato non ha telefono, sito o social confrontabili';
  end if;

  select count(*)::integer,
    coalesce(jsonb_agg(
      jsonb_build_object(
        'provider_id', matched.id,
        'provider_name', matched.name,
        'identities', matched.identities
      ) order by matched.id
    ), '[]'::jsonb)
  into matched_provider_count, matched_providers
  from (
    select p.id::text as id, p.name,
      jsonb_agg(
        jsonb_build_object('kind', identity_key.identity_kind, 'value', identity_key.identity_value)
        order by identity_key.identity_kind, identity_key.identity_value
      ) as identities
    from public.provider_animator_identity_keys identity_key
    join public.providers p on p.id::text = identity_key.provider_id
    join public.animator_identity_values(
      candidate.phone, candidate.website, social_urls
    ) candidate_identity
      on candidate_identity.identity_kind = identity_key.identity_kind
      and candidate_identity.identity_value = identity_key.identity_value
    where p.provider_kind = 'feste'
      and p.party_type = 'animatore'
    group by p.id, p.name
  ) matched;

  if matched_provider_count > 1 then
    return query
      select 'manual_review'::text, null::text, null::text, matched_providers;
    return;
  end if;

  if matched_provider_count = 1 then
    matched_provider_id := matched_providers->0->>'provider_id';
    matched_provider_name := matched_providers->0->>'provider_name';
    update public.animator_candidates
    set status = 'duplicate',
        updated_at = now()
    where id = candidate.id;

    return query
      select 'duplicate'::text, matched_provider_id, matched_provider_name, matched_providers;
    return;
  end if;

  select data_type
  into provider_id_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'providers'
    and column_name = 'id';

  if provider_id_type = 'uuid' then
    insert into public.providers (
      provider_kind,
      provider_type,
      party_type,
      name,
      city,
      province,
      phone,
      website,
      social_url,
      services,
      coverage_area,
      source_url
    )
    values (
      'feste',
      'feste',
      'animatore',
      candidate.name,
      btrim(p_city),
      upper(btrim(p_province)),
      candidate.phone,
      candidate.website,
      nullif(social_urls, ''),
      nullif(array_to_string(candidate.services, '; '), ''),
      candidate.coverage_area,
      candidate.source_urls[1]
    )
    returning id::text into new_provider_id;
  else
    name_slug := trim(both '-' from regexp_replace(
      lower(candidate.name), '[^a-z0-9]+', '-', 'g'
    ));
    city_slug := trim(both '-' from regexp_replace(
      lower(btrim(p_city)), '[^a-z0-9]+', '-', 'g'
    ));
    generated_provider_id := concat_ws(
      '-',
      'provider',
      coalesce(nullif(name_slug, ''), 'animatore'),
      coalesce(nullif(city_slug, ''), 'toscana')
    );

    if exists (
      select 1 from public.providers p
      where p.id::text = generated_provider_id
    ) then
      generated_provider_id := generated_provider_id || '-' ||
        left(replace(candidate.id::text, '-', ''), 8);
    end if;

    execute $insert$
      insert into public.providers (
        id,
        provider_kind,
        provider_type,
        party_type,
        name,
        city,
        province,
        phone,
        website,
        social_url,
        services,
        coverage_area,
        source_url
      )
      values (
        $1, 'feste', 'feste', 'animatore', $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      returning id::text
    $insert$
    into new_provider_id
    using
      generated_provider_id,
      candidate.name,
      btrim(p_city),
      upper(btrim(p_province)),
      candidate.phone,
      candidate.website,
      nullif(social_urls, ''),
      nullif(array_to_string(candidate.services, '; '), ''),
      candidate.coverage_area,
      candidate.source_urls[1];
  end if;

  update public.animator_candidates
  set status = 'approved',
      approved_provider_id = new_provider_id,
      city = btrim(p_city),
      province = upper(btrim(p_province)),
      missing_fields = array_remove(
        array_remove(missing_fields, 'city'),
        'province'
      ),
      updated_at = now()
  where id = candidate.id;

  return query
    select 'approved'::text, new_provider_id, candidate.name, '[]'::jsonb;
end;
$$;

revoke all on function public.approve_animator_candidate(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.approve_animator_candidate(uuid, text, text)
  to service_role;
