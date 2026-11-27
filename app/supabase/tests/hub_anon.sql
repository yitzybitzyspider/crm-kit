-- team hub, issue 25 (B6): everything the anon role can reach, from the catalog.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner. Everything here is rolled back at the end.
--
-- anon is what a stranger is when they hold the public key, which ships in
-- the app's files for anyone to read. This file asks the database, as the
-- catalog answers, for every right anon holds on a table, view, sequence,
-- function or schema, by its own grants and through "everyone", and compares
-- the answer with the lists written out below. Anything granted to anon
-- later, by us, by an upstream migration or by a newer Supabase image, fails
-- here until a person adds it to a list on purpose.
--
-- Left out, as in the catalog test of issue 35: pg_catalog and
-- information_schema (every role holds them and nobody can take them away),
-- and a right on an object in a schema anon may not enter (it cannot be used).
-- Also left out: what belongs to the extension pgtap, which this test run
-- itself installs.
--
-- How exact each list is:
--   public                                   every object, by name and right
--   tables, views, sequences anywhere        every object, by name and right
--   functions outside public and extensions  every function, by name
--   functions in the schema extensions       by the extension they belong to.
--       There are over a thousand, all Supabase's or an extension's, and the
--       API does not serve that schema. A function added there by hand, or a
--       new extension, fails; a new function inside a listed extension fails
--       the count per extension (issue 40 item 16).
begin;
select no_plan();

create function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    execute format('set local role %I', role_name);
    begin
        execute stmt into r;
        r := coalesce(r, 'ok');
    exception when others then
        r := 'ERROR ' || sqlstate;
    end;
    execute 'reset role';
    return r;
end $$;

create temp view anon_schemas as
    select n.oid, n.nspname
    from pg_namespace n
    where n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(temp|toast)'
        and has_schema_privilege('anon', n.oid, 'USAGE');

-- What the extension pgtap owns: the test run put it there.
create temp view of_pgtap as
    select d.classid, d.objid
    from pg_depend d
        join pg_extension e on e.oid = d.refobjid
    where d.refclassid = 'pg_extension'::regclass and d.deptype = 'e' and e.extname = 'pgtap';

-- One row per object anon holds anything on, with the rights in one field.
create temp view anon_holds as
    select 'table or view'::text as kind, s.nspname::text as in_schema, c.relname::text as name,
           string_agg(p.priv, ', ' order by p.priv) as rights
    from pg_class c
        join anon_schemas s on s.oid = c.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv)
    where c.relkind in ('r', 'v', 'm', 'f', 'p')
        and has_table_privilege('anon', c.oid, p.priv)
        and not exists (select 1 from of_pgtap x where x.classid = 'pg_class'::regclass and x.objid = c.oid)
    group by s.nspname, c.relname
    union all
    select 'some columns', s.nspname::text, c.relname::text,
           string_agg(p.priv, ', ' order by p.priv)
    from pg_class c
        join anon_schemas s on s.oid = c.relnamespace
        cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p(priv)
    where c.relkind in ('r', 'v', 'm', 'f', 'p')
        and not has_table_privilege('anon', c.oid, p.priv)
        and has_any_column_privilege('anon', c.oid, p.priv)
    group by s.nspname, c.relname
    union all
    select 'sequence', s.nspname::text, c.relname::text,
           string_agg(p.priv, ', ' order by p.priv)
    from pg_class c
        join anon_schemas s on s.oid = c.relnamespace
        cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv)
    where c.relkind = 'S'
        and has_sequence_privilege('anon', c.oid, p.priv)
    group by s.nspname, c.relname
    union all
    select 'function', s.nspname::text,
           f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')', 'EXECUTE'
    from pg_proc f
        join anon_schemas s on s.oid = f.pronamespace
    where has_function_privilege('anon', f.oid, 'EXECUTE')
        and not exists (select 1 from of_pgtap x where x.classid = 'pg_proc'::regclass and x.objid = f.oid)
    union all
    select 'schema', n.nspname::text, '', 'CREATE'
    from pg_namespace n
    where n.nspname !~ '^pg_(temp|toast)'
        and has_schema_privilege('anon', n.oid, 'CREATE');

-- --------------------------------------------------- the schema public
-- The whole list. The sign-in page asks one thing before anyone is signed
-- in: whether a first user exists (the view init_state, which answers 0 or 1).
select set_eq(
    $$ select kind, name, rights from anon_holds where in_schema = 'public' $$,
    $$ values ('table or view', 'init_state', 'SELECT') $$,
    'in public, anon holds select on init_state and nothing else');

-- ------------------------------------------------ everything outside public
-- None of this is ours and none of it can be taken away by a migration: the
-- objects belong to Supabase's own roles (docs/FINDINGS.md, issue 35). It is
-- written out so that anything new is seen. public, storage and
-- graphql_public are the schemas the API serves (config.toml); the others
-- cannot be asked for through the API at all.
select set_eq(
    $$ select kind, in_schema, name, rights from anon_holds
       where in_schema <> 'public' and kind <> 'function' $$,
    $$ values
        ('table or view', 'storage', 'buckets', 'DELETE, INSERT, SELECT, UPDATE'),
        ('table or view', 'storage', 'buckets_analytics', 'DELETE, INSERT, SELECT, UPDATE'),
        ('table or view', 'storage', 'buckets_vectors', 'SELECT'),
        ('table or view', 'storage', 'iceberg_namespaces', 'SELECT'),
        ('table or view', 'storage', 'iceberg_tables', 'SELECT'),
        ('table or view', 'storage', 'objects', 'DELETE, INSERT, SELECT, UPDATE'),
        ('table or view', 'storage', 's3_multipart_uploads', 'SELECT'),
        ('table or view', 'storage', 's3_multipart_uploads_parts', 'SELECT'),
        ('table or view', 'storage', 'vector_indexes', 'SELECT'),
        ('table or view', 'realtime', 'messages', 'INSERT, SELECT, UPDATE'),
        ('table or view', 'realtime', 'subscription', 'SELECT'),
        ('sequence', 'realtime', 'subscription_id_seq', 'USAGE'),
        ('table or view', 'supabase_functions', 'hooks', 'DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
        ('table or view', 'supabase_functions', 'migrations', 'DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE'),
        ('sequence', 'supabase_functions', 'hooks_id_seq', 'SELECT, UPDATE, USAGE'),
        ('table or view', 'extensions', 'pg_stat_statements', 'SELECT'),
        ('table or view', 'extensions', 'pg_stat_statements_info', 'SELECT') $$,
    'outside public, anon holds rights on the tables, views and sequences Supabase gives it and on nothing new');

select set_eq(
    $$ select distinct in_schema, split_part(name, '(', 1) from anon_holds
       where kind = 'function' and in_schema not in ('public', 'extensions') $$,
    $$ values
        ('auth', 'email'), ('auth', 'jwt'), ('auth', 'role'), ('auth', 'uid'),
        ('graphql_public', 'graphql'),
        ('supabase_functions', 'http_request'),
        ('storage', 'allow_any_operation'), ('storage', 'allow_only_operation'),
        ('storage', 'can_insert_object'), ('storage', 'enforce_bucket_lifecycle_service_role'),
        ('storage', 'enforce_bucket_name_length'), ('storage', 'enforce_versioning_status_transition'),
        ('storage', 'extension'), ('storage', 'filename'), ('storage', 'foldername'),
        ('storage', 'get_common_prefix'), ('storage', 'get_size_by_bucket'),
        ('storage', 'list_multipart_uploads_with_delimiter'), ('storage', 'list_objects_with_delimiter'),
        ('storage', 'operation'), ('storage', 'protect_bucket_control_columns'), ('storage', 'protect_delete'),
        ('storage', 'search'), ('storage', 'search_by_timestamp'), ('storage', 'search_v2'),
        ('storage', 'update_updated_at_column'),
        ('realtime', 'apply_rls'), ('realtime', 'authorize'), ('realtime', 'broadcast_changes'),
        ('realtime', 'build_prepared_statement_sql'), ('realtime', 'cast'), ('realtime', 'check_equality_op'),
        ('realtime', 'is_visible_through_filters'), ('realtime', 'list_changes'), ('realtime', 'list_changes_sync'),
        ('realtime', 'quote_wal2json'), ('realtime', 'send'), ('realtime', 'send_binary'),
        ('realtime', 'settled_changes'), ('realtime', 'subscription_check_filters'), ('realtime', 'to_regrole'),
        ('realtime', 'topic'), ('realtime', 'wal2json_escape_identifier') $$,
    'outside public and extensions, anon may call the functions Supabase gives it and no new one');

-- The schema extensions: which extension each function anon may call belongs to.
select set_eq(
    $$ select distinct coalesce(e.extname::text, '(no extension: ' || f.proname || ')')
       from pg_proc f
           join pg_namespace n on n.oid = f.pronamespace
           left join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = f.oid
               and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
           left join pg_extension e on e.oid = d.refobjid
       where n.nspname = 'extensions'
           and has_schema_privilege('anon', n.oid, 'USAGE')
           and has_function_privilege('anon', f.oid, 'EXECUTE')
           and e.extname is distinct from 'pgtap' $$,
    $$ values ('pgcrypto'), ('uuid-ossp'), ('pg_stat_statements'), ('citext'),
              -- upstream's migrations create these three
              ('http'), ('pgjwt'), ('unaccent'),
              -- Supabase's own helpers, in no extension
              ('(no extension: grant_pg_cron_access)'), ('(no extension: grant_pg_graphql_access)'),
              ('(no extension: grant_pg_net_access)'), ('(no extension: pgrst_ddl_watch)'),
              ('(no extension: pgrst_drop_watch)'), ('(no extension: set_graphql_placeholder)') $$,
    'in the schema extensions, every function anon may call belongs to a known extension');

-- ------------------------------------- issue 40 item 16: two blind spots
-- 1. A schema anon may enter is compared by name, so a new one is seen even
--    when it is empty (the lists above only see what is inside a schema).
select set_eq(
    $$ select nspname::text from anon_schemas $$,
    $$ values ('public'), ('extensions'), ('graphql'), ('graphql_public'), ('storage'), ('realtime'), ('auth'), ('supabase_functions') $$,
    'issue 40 item 16: anon may enter these schemas and no other, an empty one included');
create schema hub_anon_probe_schema;
grant usage on schema hub_anon_probe_schema to anon;
select ok(exists (select 1 from anon_schemas where nspname = 'hub_anon_probe_schema'),
          'issue 40 item 16: a new empty schema granted usage is seen by the comparison above');
drop schema hub_anon_probe_schema;

-- 2. In the schema extensions, how many functions anon may call, per
--    extension. A new function inside a listed extension changes its count.
--    The counts are what the pinned Supabase CLI (2.122.0) gives; a newer
--    image that adds functions fails here until a person looks.
select set_eq(
    $$ select coalesce(e.extname::text, '(no extension)'), count(*)::integer
       from pg_proc f
           join pg_namespace n on n.oid = f.pronamespace
           left join pg_depend d on d.classid = 'pg_proc'::regclass and d.objid = f.oid
               and d.refclassid = 'pg_extension'::regclass and d.deptype = 'e'
           left join pg_extension e on e.oid = d.refobjid
       where n.nspname = 'extensions'
           and has_function_privilege('anon', f.oid, 'EXECUTE')
           and e.extname is distinct from 'pgtap'
       group by 1 $$,
    $$ values ('pgcrypto', 36), ('uuid-ossp', 10), ('pg_stat_statements', 2), ('citext', 47),
              ('http', 19), ('pgjwt', 6), ('unaccent', 4), ('(no extension)', 6) $$,
    'issue 40 item 16: in the schema extensions, the number of functions anon may call, per extension');

-- -------------------------------------------------------------- the role
select is((select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication or rolcanlogin
           from pg_roles where rolname = 'anon'), false,
          'anon has no special right and no login of its own');
select set_eq(
    $$ select r.rolname::text from pg_auth_members m join pg_roles r on r.oid = m.roleid
       where m.member = (select oid from pg_roles where rolname = 'anon') $$,
    $$ select ''::text as a where false $$,
    'anon is a member of no other role');

-- ------------------------------------------------- row level security
-- A policy written for anon, or for everyone, lets anon read rows.
select set_eq(
    $$ select schemaname::text, tablename::text, policyname::text, cmd::text
       from pg_policies
       where roles && array['anon', 'public']::name[] $$,
    $$ select ''::text as a, ''::text as b, ''::text as c, ''::text as d where false $$,
    'no policy in any schema is written for anon or for everyone');

-- ------------------------------------------------- what new objects get
-- A default grant hands anon a right on every object made later. Migrations
-- run as postgres, and postgres gives anon nothing by default any more.
-- supabase_admin's defaults are Supabase's own and cannot be changed by a
-- migration; nothing of ours is made by that role.
select set_eq(
    $$ select d.defaclrole::regrole::text, coalesce(n.nspname::text, '(every schema)'),
              d.defaclobjtype::text, a.privilege_type::text
       from pg_default_acl d
           left join pg_namespace n on n.oid = d.defaclnamespace
           cross join lateral aclexplode(d.defaclacl) a
       where a.grantee = (select oid from pg_roles where rolname = 'anon')
           and (n.nspname is null or n.nspname = 'public') $$,
    $$ values
        ('supabase_admin', 'public', 'r', 'SELECT'), ('supabase_admin', 'public', 'r', 'INSERT'),
        ('supabase_admin', 'public', 'r', 'UPDATE'), ('supabase_admin', 'public', 'r', 'DELETE'),
        ('supabase_admin', 'public', 'r', 'TRUNCATE'), ('supabase_admin', 'public', 'r', 'REFERENCES'),
        ('supabase_admin', 'public', 'r', 'TRIGGER'),
        ('supabase_admin', 'public', 'S', 'SELECT'), ('supabase_admin', 'public', 'S', 'UPDATE'),
        ('supabase_admin', 'public', 'S', 'USAGE'),
        ('supabase_admin', 'public', 'f', 'EXECUTE') $$,
    'a table, sequence or function a migration makes in public later is not granted to anon by default');

-- The same, by doing it: a table and a function made now, as migrations make them.
create table public.hub_anon_probe (id integer);
create function public.hub_anon_probe_fn() returns integer language sql as 'select 1';
select ok(not has_table_privilege('anon', 'public.hub_anon_probe', 'select, insert, update, delete, truncate, references, trigger'),
          'a table made now in public gives anon nothing');
select is(has_function_privilege('anon', 'public.hub_anon_probe_fn()', 'execute'),
          has_function_privilege('hub_export', 'public.hub_anon_probe_fn()', 'execute'),
          'a function made now in public gives anon only what every role gets (the migration that makes it must close that, as ours do)');
drop function public.hub_anon_probe_fn();
drop table public.hub_anon_probe;

-- ---------------------------------------------------- files in storage
-- A file in a public bucket is served to anyone who has its address, with
-- no key and no sign-in. Since issue 40 item 14 there is none: upstream's
-- attachments bucket is private.
select is_empty(
    $$ select id::text from storage.buckets where public $$,
    'issue 40 item 14: no bucket is served without a sign-in');

-- ------------------------------------------------------- acting as anon
select is(pg_temp.try_as('anon', 'select is_initialized::text from public.init_state'), '0',
          'acting as anon, init_state answers (no teammate yet: 0)');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'first@hub.test');
select is(pg_temp.try_as('anon', 'select is_initialized::text from public.init_state'), '1',
          'acting as anon, init_state answers 1 once a first user exists, and never more');
select is(pg_temp.try_as('anon', format('select count(*)::text from public.%I', t)), 'ERROR 42501',
          'acting as anon, a read of ' || t || ' is refused')
from unnest(array['sales', 'contacts', 'contact_notes', 'companies', 'interviews', 'interview_transcripts',
                  'interview_hypotheses', 'call_inbox', 'audit_log', 'follow_ups', 'contacts_summary',
                  'companies_summary', 'activity_log', 'deals', 'deal_notes', 'tasks', 'tags',
                  'configuration', 'favicons_excluded_domains', 'user_invitations']) t;
select is(pg_temp.try_as('anon', 'select count(*)::text from auth.users'), 'ERROR 42501',
          'acting as anon, a read of auth.users is refused');

select * from finish();
rollback;
