-- Undo of migrations/20261126000000_baseline.sql.
-- This removes everything the baseline built: every table, view, function and
-- policy of the public schema, the private and hub_private schemas, the
-- triggers on auth.users, the attachments bucket and its
-- policies. It restores the shape of an empty project, not
-- data: every row is lost. Never run it on a database with rows you want.
-- One transaction: it undoes everything or nothing. Storage refuses a direct
-- delete of a bucket unless storage.allow_delete_query is on, so it is turned
-- on for this transaction only.

begin;
set local storage.allow_delete_query = 'true';

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

drop policy if exists "Attachments 1mt4rzk_0" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_1" on storage.objects;
drop policy if exists "Attachments 1mt4rzk_3" on storage.objects;
delete from storage.objects where bucket_id = 'attachments';
delete from storage.buckets where id = 'attachments';

drop schema if exists private cascade;
drop schema if exists hub_private cascade;
drop schema public cascade;
create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;

-- The hub_export role stays: postgres may not drop what Supabase granted it,
-- and the baseline creates it only when it is missing.

commit;
