-- Website Watch: Phase 9 alerts (Slack)

-- When the incident's alert went out. Each incident alerts at most once, and a
-- "resolved" message is only sent for incidents that were alerted.
alter table public.incidents add column alerted_at timestamptz;

-- Alert deliveries show up in incident history.
alter table public.incident_events drop constraint incident_events_kind_check;
alter table public.incident_events add constraint incident_events_kind_check
  check (kind in (
    'opened', 'status_changed', 'severity_changed', 'assigned', 'notes_updated', 'resolved', 'snooze_ended',
    'alert_sent', 'alert_failed'
  ));
