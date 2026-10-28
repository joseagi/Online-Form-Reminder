-- Phase 6a: deny by default, also for sequences and for objects created later.
--
-- Supabase's default privileges give anon and authenticated full rights on every new table,
-- function and sequence in public. Earlier migrations revoked these object by object, but the
-- identity sequences behind audit_logs and notification_logs kept USAGE, SELECT and UPDATE for
-- both roles. Not reachable through the API (which exposes no sequences), but UPDATE means setval:
-- moving the audit log's sequence back would make every later activity save fail.
--
-- Identity columns don't need the inserting role to have rights on their sequence, so nothing
-- that writes these logs (all security definer functions and triggers) is affected.
revoke all on all sequences in schema public from anon, authenticated;

-- Objects created by later migrations (run as postgres) start with no rights for the API roles;
-- each migration grants what it needs, and tests/database/14_privileges.test.sql checks the result.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
-- PostgreSQL itself lets PUBLIC (so also anon) execute every new function, and a schema-level
-- rule cannot take that away: it has to be the global default for functions this role creates.
alter default privileges for role postgres revoke execute on functions from public;
