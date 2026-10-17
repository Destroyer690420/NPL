-- ----------------------------------------------------------------------------
-- 20261017000002_read_payload_ids.sql
--
-- The client read APIs now merge each row's document id into the returned JSON
-- object. The shared document mappers (toEventDoc, toTeamDoc, ...) need the id
-- to build typed documents, exactly like the Firestore snapshots did.
--
-- Run this once in the Supabase SQL Editor if the initial migration was
-- already applied. Fresh setups simply run both files in order.
--
-- Safe to re-run: both functions are created or replaced.
-- ----------------------------------------------------------------------------

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
    return (
      select data || jsonb_build_object('id', id)
      from public.events
      where id = v_event_id
    );
  elsif p_resource = 'events' then
    return (
      select coalesce(jsonb_agg(data || jsonb_build_object('id', id)), '[]'::jsonb)
      from public.events
    );
  elsif p_resource = 'teams' then
    return (
      select coalesce(jsonb_agg(data || jsonb_build_object('id', id)), '[]'::jsonb)
      from public.teams
      where event_id = v_event_id
    );
  elsif p_resource = 'players' then
    return (
      select coalesce(jsonb_agg(data || jsonb_build_object('id', id)), '[]'::jsonb)
      from public.players
      where event_id = v_event_id
    );
  elsif p_resource = 'purchases' then
    return (
      select coalesce(jsonb_agg(data || jsonb_build_object('id', id)), '[]'::jsonb)
      from public.purchases
      where event_id = v_event_id
    );
  elsif p_resource = 'audit' then
    v_limit := least(greatest(coalesce((v_params ->> 'limit')::int, 200), 1), 1000);
    return (
      select coalesce(jsonb_agg(recent.data || jsonb_build_object('id', recent.id)), '[]'::jsonb)
      from (
        select id, data
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

  v_event := (select data || jsonb_build_object('id', id) from public.events where id = v_event_id);
  v_team := (select data || jsonb_build_object('id', id) from public.teams where id = v_team_id and event_id = v_event_id);
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
        select coalesce(jsonb_agg(data || jsonb_build_object('id', id)), '[]'::jsonb)
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

-- create or replace keeps existing ACLs; re-grant explicitly to be safe.
grant execute on function public.api_admin_read(text, text, jsonb) to anon, service_role;
grant execute on function public.api_team_read(text, text) to anon, service_role;
