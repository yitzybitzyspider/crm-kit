-- team hub, issue 47 (B13): the attachments bucket's policies and large
-- objects. pgTAP, run by scripts/dbtest.sh in the db workflow against a
-- throwaway stack, as the database owner. Everything here is rolled back at
-- the end. The same two rules through the API and as the export's own login
-- are in app/e2e-signin/last-gaps.e2e.ts and scripts/live_test_export.py.
begin;
select no_plan();

-- Runs one statement as another role and says what happened: the single
-- value it returned, 'ok' when it returned none, or 'ERROR ' and the SQLSTATE.
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

-- the owner may act as the export role for these tests only (rolled back)
do $$
begin
    if not pg_has_role(current_user, 'hub_export', 'member') then
        execute format('grant hub_export to %I', current_user);
    end if;
end $$;

-- ------------------------------------------- 1. the attachments bucket
-- Upstream's init migration gave every signed in user select, insert and
-- delete on the bucket's files. Nothing in the hub reads or writes them.
select is(
    (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and (coalesce(qual, '') ~ 'attachments' or coalesce(with_check, '') ~ 'attachments')),
    0, 'issue 47 item 1: no policy on storage.objects names the attachments bucket');
select is(
    (select count(*)::int from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects' and policyname like 'Attachments 1mt4rzk_%'),
    0, 'issue 47 item 1: upstream''s three attachment policies are gone');

-- one old file, as the owner (the cloud has none; an old one is what this guards)
insert into storage.objects (bucket_id, name) values ('attachments', 'issue47-old-file.txt');

select pg_temp.try_as('authenticated', 'select set_config(''request.jwt.claims'', ''{"role": "authenticated", "sub": "00000000-0000-4000-8000-0000000047a1"}'', true)');
select is(
    pg_temp.try_as('authenticated',
        $$ insert into storage.objects (bucket_id, name) values ('attachments', 'issue47-new-file.txt') returning name $$),
    'ERROR 42501', 'issue 47 item 1: a signed in teammate cannot add a file to the attachments bucket');
select is(
    pg_temp.try_as('authenticated',
        $$ select count(*)::text from storage.objects where bucket_id = 'attachments' $$),
    '0', 'issue 47 item 1: a signed in teammate sees no file in the attachments bucket');
select pg_temp.try_as('authenticated',
    $$ with d as (delete from storage.objects where bucket_id = 'attachments' returning 1) select count(*)::text from d $$);
select is(
    (select count(*)::int from storage.objects where bucket_id = 'attachments' and name = 'issue47-old-file.txt'),
    1, 'issue 47 item 1: a signed in teammate''s delete leaves the old file where it is');
select is(
    pg_temp.try_as('anon',
        $$ insert into storage.objects (bucket_id, name) values ('attachments', 'issue47-anon-file.txt') returning name $$),
    'ERROR 42501', 'issue 47 item 1: a stranger cannot add a file either');

-- ------------------------------------------------- 4. large objects
-- What the probe saw is printed first, so a red run says why.
select diag('issue 47 item 4 probe: the test runs as ' || current_user
    || ' (superuser: ' || (select rolsuper::text from pg_roles where rolname = current_user) || ')'
    || ', our migrations were applied by ' || (select proowner::regrole::text from pg_proc where proname = 'hub_refuse_new_attachments')
    || ', lo_from_bytea belongs to ' || (select proowner::regrole::text from pg_proc where oid = 'pg_catalog.lo_from_bytea(oid, bytea)'::regprocedure)
    || ' with rights ' || coalesce((select proacl::text from pg_proc where oid = 'pg_catalog.lo_from_bytea(oid, bytea)'::regprocedure), 'the default (everyone may call it)'));
select diag('issue 47 item 4 probe: ' || r.rolname || ' may call ' || string_agg(f, ', ' order by f))
from (values ('anon'), ('authenticated'), ('hub_export')) as r(rolname)
    cross join unnest(array['lo_creat(integer)', 'lo_create(oid)', 'lo_unlink(oid)', 'lo_put(oid, bigint, bytea)',
                            'lowrite(integer, bytea)', 'lo_from_bytea(oid, bytea)', 'lo_import(text)', 'lo_import(text, oid)',
                            'lo_truncate(integer, integer)', 'lo_truncate64(integer, bigint)']) as f
where has_function_privilege(r.rolname, 'pg_catalog.' || f, 'execute')
group by r.rolname;

-- Whether a revoke by the role running this file takes. Undone either way:
-- the block raises at its end, which rolls the revoke back.
create function pg_temp.probe_revoke() returns text language plpgsql as $$
begin
    begin
        revoke execute on function pg_catalog.lo_from_bytea(oid, bytea) from public;
        raise exception 'after a revoke from public as %, hub_export may call lo_from_bytea: %', current_user,
            has_function_privilege('hub_export', 'pg_catalog.lo_from_bytea(oid, bytea)', 'execute');
    exception when others then
        return sqlerrm;
    end;
end $$;
select diag('issue 47 item 4 probe: ' || pg_temp.probe_revoke());

-- Every function that makes, changes or removes a large object, for the
-- three roles that are not the owner, pinned (docs/DECISIONS.md, issue 47:
-- an accepted limit). The eight everyone may call by default are callable by
-- all three; lo_import by none. Any change, either way, fails here and asks
-- for a look. lo_open(oid, integer) is not listed: it only opens one, and
-- writing through it needs lowrite or lo_truncate.
create temp table lo_writers (f text primary key, everyone boolean not null);
insert into lo_writers values
    ('lo_creat(integer)', true), ('lo_create(oid)', true), ('lo_unlink(oid)', true),
    ('lo_put(oid, bigint, bytea)', true), ('lowrite(integer, bytea)', true),
    ('lo_from_bytea(oid, bytea)', true), ('lo_truncate(integer, integer)', true),
    ('lo_truncate64(integer, bigint)', true),
    ('lo_import(text)', false), ('lo_import(text, oid)', false);
select is(has_function_privilege(r.rolname, 'pg_catalog.' || w.f, 'execute'), w.everyone,
          'issue 47 item 4: ' || r.rolname || case when w.everyone then ' may call ' else ' cannot call ' end || w.f)
from (values ('anon'), ('authenticated'), ('hub_export')) as r(rolname)
    cross join lo_writers w
order by r.rolname, w.f;

select is(pg_temp.try_as('hub_export', $$ select pg_catalog.lo_import('/etc/hostname')::text $$),
          'ERROR 42501', 'issue 47 item 4: acting as hub_export, lo_import is refused');

-- The seatbelt: hub_export's own sessions start read only. A role setting
-- applies at sign-in, not to "set role", so it is read from the catalog here
-- and tried over a real sign-in in scripts/live_test_export.py.
select ok(exists (select 1 from pg_catalog.pg_db_role_setting s join pg_catalog.pg_roles r on r.oid = s.setrole
                  where r.rolname = 'hub_export' and s.setdatabase = 0
                    and 'default_transaction_read_only=on' = any (s.setconfig)),
          'issue 47 item 4: hub_export''s sessions start read only');

select * from finish();
rollback;
