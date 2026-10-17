-- ----------------------------------------------------------------------------
-- 20261017000004_reset_event_data.sql
--
-- Enables authenticated admins to wipe all event data (teams, players,
-- purchases, team secrets, team sessions, audit logs) for an event to start
-- fresh from scratch.
--
-- Safe to re-run. Execute once in Supabase SQL Editor (Dashboard -> SQL Editor).
-- ----------------------------------------------------------------------------

create or replace function public.api_admin_reset_event_data(
  p_token text,
  p_event_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s jsonb;
begin
  s := public.require_session(p_token, 'admin');

  delete from public.purchases where event_id = p_event_id;
  delete from public.players where event_id = p_event_id;
  delete from public.team_secrets where event_id = p_event_id;
  delete from public.pin_index where event_id = p_event_id;
  delete from public.sessions where event_id = p_event_id and (data ->> 'kind') = 'team';
  delete from public.teams where event_id = p_event_id;
  delete from public.audit_logs where event_id = p_event_id;

  update public.events
  set data = jsonb_set(
    jsonb_set(data, '{status}', '"draft"'::jsonb),
    '{purchasesEnabled}', 'true'::jsonb
  )
  where id = p_event_id;

  return jsonb_build_object('ok', true, 'eventId', p_event_id);
end;
$$;

revoke all on function public.api_admin_reset_event_data(text, text) from public;
grant execute on function public.api_admin_reset_event_data(text, text) to anon, authenticated, service_role;
