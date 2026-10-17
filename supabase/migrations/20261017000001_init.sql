-- ============================================================================
-- College Auction Manager - Supabase schema (replaces Firestore + Cloud Functions)
-- ============================================================================
-- Model: every domain table is a document store `(id, event_id, data jsonb)`.
-- Clients can never touch a table directly: RLS is enabled with NO policies and
-- all table privileges are revoked from anon/authenticated. Reads go through the
-- self-validating `api_*` functions; writes go through the single atomic
-- `apply_plan` function, which is callable only with the service role key
-- (i.e. only from the Edge Function).
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

create table if not exists public.app_config (
  id text primary key,
  event_id text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.events (
  id text primary key,
  event_id text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.teams (
  id text primary key,
  event_id text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.players (
  id text primary key,
  event_id text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.purchases (
  id text primary key,
  event_id text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.audit_logs (
  id text primary key,
  event_id text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.team_secrets (
  id text primary key,
  event_id text not null,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.pin_index (
  id text primary key,
  event_id text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.sessions (
  id text primary key,
  event_id text,
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.rate_limits (
  id text primary key,
  event_id text,
  data jsonb not null default '{}'::jsonb
);

-- ----------------------------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------------------------

create index if not exists teams_event_idx on public.teams (event_id);
create index if not exists players_event_idx on public.players (event_id);
create index if not exists purchases_event_idx on public.purchases (event_id);
create index if not exists purchases_event_team_idx on public.purchases (event_id, (data ->> 'teamId'));
create index if not exists audit_logs_event_idx on public.audit_logs (event_id);
create index if not exists team_secrets_event_idx on public.team_secrets (event_id);
create index if not exists pin_index_event_idx on public.pin_index (event_id);
create index if not exists sessions_event_idx on public.sessions (event_id);
create unique index if not exists sessions_token_hash_idx on public.sessions ((data ->> 'tokenHash'));

-- ----------------------------------------------------------------------------
-- Lock down: RLS everywhere, no policies, no table privileges for clients
-- ----------------------------------------------------------------------------

alter table public.app_config enable row level security;
alter table public.events enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.purchases enable row level security;
alter table public.audit_logs enable row level security;
alter table public.team_secrets enable row level security;
alter table public.pin_index enable row level security;
alter table public.sessions enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.app_config from anon, authenticated;
revoke all on public.events from anon, authenticated;
revoke all on public.teams from anon, authenticated;
revoke all on public.players from anon, authenticated;
revoke all on public.purchases from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.team_secrets from anon, authenticated;
revoke all on public.pin_index from anon, authenticated;
revoke all on public.sessions from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Token hashing (only the hash of a session token is ever stored)
-- ----------------------------------------------------------------------------

create or replace function public.token_hash(p_token text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(p_token, 'sha256'), 'hex')
$$;

-- ----------------------------------------------------------------------------
-- Server timestamp sentinels: {"__serverTs": true} -> {seconds, nanoseconds}
-- ----------------------------------------------------------------------------

create or replace function public.plan_fill_timestamps(j jsonb)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select case
    when j = '{"__serverTs": true}'::jsonb then
      jsonb_build_object(
        'seconds', floor(extract(epoch from now()))::bigint,
        'nanoseconds', ((extract(epoch from now()) * 1000000000)::bigint % 1000000000)
      )
    when jsonb_typeof(j) = 'object' then (
      select coalesce(jsonb_object_agg(key, public.plan_fill_timestamps(value)), '{}'::jsonb)
      from jsonb_each(j)
    )
    when jsonb_typeof(j) = 'array' then (
      select coalesce(jsonb_agg(public.plan_fill_timestamps(value)), '[]'::jsonb)
      from jsonb_array_elements(j)
    )
    else j
  end
$$;

-- ----------------------------------------------------------------------------
-- Atomic apply: all plan writes or nothing. Raises 'plan-conflict' when any
-- recorded precondition no longer holds (the caller reloads and retries).
-- ----------------------------------------------------------------------------

create or replace function public.apply_plan(p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  op jsonb;
  v_t text;
  v_id text;
  v_m text;
  v_d jsonb;
  v_x jsonb;
  v_e text;
  v_eid text;
  v_cur jsonb;
  v_exists boolean;
begin
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' then
    raise exception 'invalid-argument';
  end if;

  for op in select jsonb_array_elements(p_ops) loop
    v_t := op ->> 't';
    v_id := op ->> 'id';
    v_m := op ->> 'm';
    v_d := op -> 'd';
    v_x := op -> 'x';
    v_e := op ->> 'e';

    if v_t is null or v_id is null or v_id = '' or v_m is null then
      raise exception 'invalid-argument';
    end if;

    if v_t not in ('app_config', 'events', 'teams', 'players', 'purchases',
                   'audit_logs', 'team_secrets', 'pin_index', 'sessions', 'rate_limits') then
      raise exception 'invalid-argument';
    end if;

    v_eid := case
      when v_t = 'app_config' then null
      when v_t = 'events' then v_id
      else v_e
    end;

    -- Preconditions captured when the planner read the current state.
    if v_x is not null then
      if v_x = '{"__absent": true}'::jsonb then
        execute format('select exists(select 1 from public.%I where id = $1)', v_t)
          into v_exists using v_id;
        if v_exists then
          raise exception 'plan-conflict';
        end if;
      else
        execute format('select data from public.%I where id = $1', v_t)
          into v_cur using v_id;
        if v_cur is null or not (v_cur @> v_x) then
          raise exception 'plan-conflict';
        end if;
      end if;
    end if;

    if v_m = 'delete' then
      execute format('delete from public.%I where id = $1', v_t) using v_id;
    elsif v_m = 'set' then
      v_d := public.plan_fill_timestamps(coalesce(v_d, '{}'::jsonb));
      execute format(
        'insert into public.%I (id, event_id, data) values ($1, $2, $3) '
        || 'on conflict (id) do update set event_id = excluded.event_id, data = excluded.data',
        v_t
      ) using v_id, v_eid, v_d;
    elsif v_m = 'merge' then
      v_d := public.plan_fill_timestamps(coalesce(v_d, '{}'::jsonb));
      execute format(
        'insert into public.%I (id, event_id, data) values ($1, $2, $3) '
        || 'on conflict (id) do update set event_id = coalesce(excluded.event_id, public.%I.event_id), '
        || 'data = public.%I.data || excluded.data',
        v_t, v_t, v_t
      ) using v_id, v_eid, v_d;
    else
      raise exception 'invalid-argument';
    end if;
  end loop;

  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Sessions
-- ----------------------------------------------------------------------------

create or replace function public.session_resolve(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', s.id, 'data', s.data)
  from public.sessions s
  where p_token is not null
    and s.data ->> 'tokenHash' = public.token_hash(p_token)
  limit 1
$$;

create or replace function public.require_session(p_token text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  d jsonb;
  v_expires numeric;
begin
  s := public.session_resolve(p_token);
  if s is null then
    raise exception 'unauthenticated';
  end if;
  d := s -> 'data';
  if (d ->> 'kind') is distinct from p_kind then
    raise exception 'not-admin';
  end if;
  if (d ->> 'revoked')::boolean is true then
    raise exception 'session-revoked';
  end if;
  v_expires := (d #>> '{expiresAt,seconds}')::numeric;
  if v_expires is not null and v_expires * 1000 <= (extract(epoch from now()) * 1000) then
    raise exception 'session-expired';
  end if;
  return s;
end;
$$;

-- ----------------------------------------------------------------------------
-- PIN secret: env var PIN_HMAC_SECRET wins; otherwise generated once here.
-- ----------------------------------------------------------------------------

create or replace function public.ensure_pin_secret()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select data ->> 'value' into v_secret from public.app_config where id = 'server_secrets';
  if v_secret is null or length(v_secret) < 16 then
    v_secret := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.app_config (id, event_id, data)
      values ('server_secrets', null, jsonb_build_object('value', v_secret))
      on conflict (id) do nothing;
    select data ->> 'value' into v_secret from public.app_config where id = 'server_secrets';
  end if;
  return v_secret;
end;
$$;

-- ----------------------------------------------------------------------------
-- Rate limiting (fixed window + escalating cooldown, atomically applied)
-- ----------------------------------------------------------------------------

create or replace function public.rl_check(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'allowed', coalesce((data ->> 'lockedUntil')::bigint, 0) <= (extract(epoch from now()) * 1000)::bigint,
    'retryAfterMs', greatest(coalesce((data ->> 'lockedUntil')::bigint, 0) - (extract(epoch from now()) * 1000)::bigint, 0),
    'failures', coalesce((data ->> 'count')::int, 0)
  )
  from public.rate_limits
  where id = p_key
$$;

create or replace function public.rl_register(
  p_key text,
  p_window_ms bigint,
  p_max_failures int,
  p_base_lock_ms bigint,
  p_max_lock_ms bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_window_started bigint;
  v_strikes int;
  v_locked_until bigint;
  v_now bigint;
  v_allowed boolean := true;
  v_retry bigint := 0;
  v_lock bigint;
begin
  v_now := (extract(epoch from now()) * 1000)::bigint;

  insert into public.rate_limits (id, event_id, data)
    values (p_key, null, jsonb_build_object(
      'count', 0, 'windowStartedAt', 0, 'strikes', 0, 'lockedUntil', 0, 'updatedAt', v_now))
    on conflict (id) do nothing;

  select coalesce((data ->> 'count')::int, 0),
         coalesce((data ->> 'windowStartedAt')::bigint, 0),
         coalesce((data ->> 'strikes')::int, 0),
         coalesce((data ->> 'lockedUntil')::bigint, 0)
    into v_count, v_window_started, v_strikes, v_locked_until
    from public.rate_limits
   where id = p_key
   for update;

  if v_locked_until > v_now then
    return jsonb_build_object(
      'allowed', false, 'retryAfterMs', v_locked_until - v_now,
      'failures', v_count, 'strikes', v_strikes);
  end if;

  if v_window_started = 0 or (v_now - v_window_started) > p_window_ms then
    v_window_started := v_now;
    v_count := 0;
  end if;

  v_count := v_count + 1;

  if v_count >= p_max_failures then
    v_strikes := v_strikes + 1;
    v_lock := least((p_base_lock_ms * power(2, least(v_strikes - 1, 6)))::bigint, p_max_lock_ms);
    v_locked_until := v_now + v_lock;
    v_count := 0;
    v_window_started := v_now;
    v_allowed := false;
    v_retry := v_lock;
  end if;

  update public.rate_limits
     set data = jsonb_build_object(
       'count', v_count, 'windowStartedAt', v_window_started,
       'strikes', v_strikes, 'lockedUntil', v_locked_until, 'updatedAt', v_now)
   where id = p_key;

  return jsonb_build_object(
    'allowed', v_allowed, 'retryAfterMs', v_retry,
    'failures', v_count, 'strikes', v_strikes);
end;
$$;

create or replace function public.rl_reset(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.rate_limits (id, event_id, data)
    values (p_key, null, jsonb_build_object(
      'count', 0, 'windowStartedAt', 0, 'strikes', 0, 'lockedUntil', 0,
      'updatedAt', (extract(epoch from now()) * 1000)::bigint))
    on conflict (id) do update set data = excluded.data
$$;

-- ----------------------------------------------------------------------------
-- Client read APIs (self-validating; the only functions anon may execute)
-- ----------------------------------------------------------------------------

create or replace function public.api_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select data from public.app_config where id = 'app'), '{}'::jsonb)
$$;

create or replace function public.api_admin_read(
  p_token text,
  p_resource text,
  p_params jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  v_params jsonb := coalesce(p_params, '{}'::jsonb);
  v_event_id text := coalesce(p_params ->> 'eventId', '');
  v_limit int;
begin
  s := public.require_session(p_token, 'admin');

  if p_resource = 'event' then
    return (select data from public.events where id = v_event_id);
  elsif p_resource = 'events' then
    return (select coalesce(jsonb_agg(data), '[]'::jsonb) from public.events);
  elsif p_resource = 'teams' then
    return (select coalesce(jsonb_agg(data), '[]'::jsonb) from public.teams where event_id = v_event_id);
  elsif p_resource = 'players' then
    return (select coalesce(jsonb_agg(data), '[]'::jsonb) from public.players where event_id = v_event_id);
  elsif p_resource = 'purchases' then
    return (select coalesce(jsonb_agg(data), '[]'::jsonb) from public.purchases where event_id = v_event_id);
  elsif p_resource = 'audit' then
    v_limit := least(greatest(coalesce((v_params ->> 'limit')::int, 200), 1), 1000);
    return (
      select coalesce(jsonb_agg(data), '[]'::jsonb)
      from (
        select data
        from public.audit_logs
        where event_id = v_event_id
        order by (data #>> '{createdAt,seconds}')::numeric desc nulls last
        limit v_limit
      ) recent
    );
  elsif p_resource = 'pins' then
    return (
      select coalesce(jsonb_agg(jsonb_build_object(
        'teamId', t.id,
        'configured', (t.data ? 'pinVerifier'),
        'pinVersion', t.data -> 'pinVersion',
        'pinSetAt', t.data -> 'pinSetAt',
        'pinSetBy', t.data -> 'pinSetBy'
      )), '[]'::jsonb)
      from public.team_secrets t
      where t.event_id = v_event_id
    );
  end if;

  raise exception 'invalid-argument';
end;
$$;

create or replace function public.api_team_read(p_token text, p_resource text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
  v_event_id text;
  v_team_id text;
  v_team jsonb;
  v_event jsonb;
begin
  s := public.require_session(p_token, 'team');
  v_event_id := s -> 'data' ->> 'eventId';
  v_team_id := s -> 'data' ->> 'teamId';
  if v_event_id is null or v_team_id is null then
    raise exception 'unauthenticated';
  end if;

  v_event := (select data from public.events where id = v_event_id);
  v_team := (select data from public.teams where id = v_team_id and event_id = v_event_id);
  if v_team is null then
    raise exception 'team-not-found';
  end if;
  if (v_team ->> 'active')::boolean is false then
    raise exception 'team-inactive';
  end if;

  if p_resource = 'state' then
    return jsonb_build_object(
      'event', v_event,
      'team', v_team,
      'purchases', (
        select coalesce(jsonb_agg(data), '[]'::jsonb)
        from public.purchases
        where event_id = v_event_id and data ->> 'teamId' = v_team_id
      )
    );
  elsif p_resource = 'context' then
    return jsonb_build_object('event', v_event, 'team', v_team);
  end if;

  raise exception 'invalid-argument';
end;
$$;

-- ----------------------------------------------------------------------------
-- Privileges: anon may only execute the three read APIs; everything else is
-- service-role only (the Edge Function).
-- ----------------------------------------------------------------------------

revoke all on function public.token_hash(text) from public, anon, authenticated;
revoke all on function public.plan_fill_timestamps(jsonb) from public, anon, authenticated;
revoke all on function public.apply_plan(jsonb) from public, anon, authenticated;
revoke all on function public.session_resolve(text) from public, anon, authenticated;
revoke all on function public.require_session(text, text) from public, anon, authenticated;
revoke all on function public.ensure_pin_secret() from public, anon, authenticated;
revoke all on function public.rl_check(text) from public, anon, authenticated;
revoke all on function public.rl_register(text, bigint, int, bigint, bigint) from public, anon, authenticated;
revoke all on function public.rl_reset(text) from public, anon, authenticated;

revoke all on function public.api_public_config() from public, anon, authenticated;
revoke all on function public.api_admin_read(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.api_team_read(text, text) from public, anon, authenticated;

grant execute on function public.api_public_config() to anon, service_role;
grant execute on function public.api_admin_read(text, text, jsonb) to anon, service_role;
grant execute on function public.api_team_read(text, text) to anon, service_role;

grant execute on function public.token_hash(text) to service_role;
grant execute on function public.plan_fill_timestamps(jsonb) to service_role;
grant execute on function public.apply_plan(jsonb) to service_role;
grant execute on function public.session_resolve(text) to service_role;
grant execute on function public.require_session(text, text) to service_role;
grant execute on function public.ensure_pin_secret() to service_role;
grant execute on function public.rl_check(text) to service_role;
grant execute on function public.rl_register(text, bigint, int, bigint, bigint) to service_role;
grant execute on function public.rl_reset(text) to service_role;
