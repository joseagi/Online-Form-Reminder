-- Stage 6d: a new kind of message, the failure alert to administrators (next migration).
-- On its own because a new enum value can only be used once the transaction that adds it has
-- committed.
alter type public.notification_kind add value if not exists 'failure_alert';
