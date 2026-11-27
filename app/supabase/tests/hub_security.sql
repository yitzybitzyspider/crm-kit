-- team hub, issue 21 (B2): the security rules of docs/SCHEMA.md, acting as each role.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner. Everything here is rolled back at the end.
-- The numbers in the descriptions are the test cases of issue 21.
begin;
select no_plan();

-- ---------------------------------------------------------------- helpers
create function pg_temp.sid(h text) returns bigint language sql as
    $$ select id from public.sales where handle = h $$;
create function pg_temp.pid(code text) returns bigint language sql as
    $$ select id from public.contacts where person_code = code $$;
create function pg_temp.login(mail text) returns void language sql as
    $$ select set_config('request.jwt.claims',
           json_build_object('sub', (select user_id from public.sales where email = mail),
                             'role', 'authenticated')::text, true) $$;
create function pg_temp.logout() returns void language sql as
    $$ select set_config('request.jwt.claims', '', true) $$;

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

-- Runs one statement as another role inside a block that is always undone,
-- and says what happened: 'ok' when it went through, or 'ERROR ' and the
-- SQLSTATE. Unlike try_as it takes a statement that returns nothing.
create function pg_temp.run_as(role_name text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    execute format('set local role %I', role_name);
    begin
        execute stmt;
        raise exception using errcode = 'HB001';
    exception
        when sqlstate 'HB001' then r := 'ok';
        when others then r := 'ERROR ' || sqlstate;
    end;
    execute 'reset role';
    return r;
end $$;

-- The request queue of pg_net, when that extension is there. Null when not.
create function pg_temp.net_queue() returns bigint language plpgsql as $$
declare
    n bigint;
begin
    if to_regclass('net.http_request_queue') is null then
        return null;
    end if;
    execute 'select count(*) from net.http_request_queue' into n;
    return n;
end $$;

-- the owner may act as the export role for these tests only (rolled back)
do $$
begin
    if not pg_has_role(current_user, 'hub_export', 'member') then
        execute format('grant hub_export to %I', current_user);
    end if;
end $$;

-- --------------------------------------------------------------- fixtures
insert into public.user_invitations (user_id) values
    ('00000000-0000-4000-8000-0000000000b1'), ('00000000-0000-4000-8000-0000000000b2');
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000b1', 'alpha@example.org'),
    ('00000000-0000-4000-8000-0000000000b2', 'bravo@example.org');
update public.sales set administrator = (email = 'alpha@example.org') where email like '%@hub.test';
select public.set_teammate_handle('alpha@example.org', 'alpha');
select public.set_teammate_handle('bravo@example.org', 'bravo');

create temp table net_before as select pg_temp.net_queue() as n;
grant select on net_before to public;

insert into public.companies (name, website, sales_id)
    values ('Example Clinic', 'example.com', pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id, company_id, email_jsonb)
    values ('Ada', 'Lovelace', pg_temp.sid('alpha'),
            (select id from public.companies where name = 'Example Clinic'),
            '[{"email": "ada@example-com.example.org", "type": "Work"}]');
insert into public.contacts (first_name, last_name, sales_id)
    values ('Alan', 'Turing', pg_temp.sid('bravo'));
insert into public.contact_notes (contact_id, sales_id, text)
    values (pg_temp.pid('AA-01'), pg_temp.sid('alpha'), 'By alpha.');
insert into public.contact_notes (contact_id, sales_id, text)
    values (pg_temp.pid('AA-01'), pg_temp.sid('bravo'), 'By bravo.');
do $$
declare v bigint;
begin
    insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                   title, overview, created_by)
    values (pg_temp.pid('AA-01'), '2026-11-20', pg_temp.sid('alpha'), 'paste', true,
            'Interview: Ada', 'overview', pg_temp.sid('alpha'))
    returning id into v;
    insert into public.interview_transcripts (interview_id, body) values (v, repeat('word ', 300));
    insert into public.interview_hypotheses (interview_id, hypothesis, stance) values (v, 'H1', 'unclear');
end $$;
insert into public.call_inbox (source, recorded_on, attendee_emails, transcript, submitted_by)
    values ('paste', '2026-11-20', array['x@example-com.example.org'], 'words', pg_temp.sid('bravo'));
-- Run the deferred check of the interview now, as a commit would. With it
-- still waiting, Postgres refuses a truncate before our trigger is asked.
set constraints all immediate;
set constraints all deferred;

-- ----------------------------------------- 23 no fetch from the internet
select is(
    (select count(*)::integer
     from pg_trigger t
         join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal
         and t.tgrelid in ('public.contacts'::regclass, 'public.companies'::regclass)
         and p.proname in ('get_avatar_for_email', 'handle_contact_saved',
                           'get_domain_favicon', 'handle_company_saved')),
    0, 'case 23: no trigger on contacts or companies calls the avatar or icon functions');
select is((select avatar from public.contacts where person_code = 'AA-01'), null,
          'case 23: saving a contact with an email fetched no avatar');
select is((select logo from public.companies where name = 'Example Clinic'), null,
          'case 23: saving a company with a website fetched no icon');
update public.contacts set email_jsonb = '[{"email": "ada@example.org", "type": "Work"}]'
    where person_code = 'AA-01';
update public.companies set website = 'example.org' where name = 'Example Clinic';
select is((select avatar from public.contacts where person_code = 'AA-01'), null,
          'case 23: updating the email fetched no avatar');
select is((select logo from public.companies where name = 'Example Clinic'), null,
          'case 23: updating the website fetched no icon');
-- Issue 35 dropped pg_net: there is no queue left for a save to add to.
select is(to_regclass('net.http_request_queue'), null,
          'case 23, after issue 35: pg_net is gone, so no save can queue a request for the network');

-- the functions that fetched from the internet are gone, not only their triggers
select is(to_regprocedure(f), null, 'case 23: the function ' || f || ' does not exist')
from unnest(array['public.get_avatar_for_email(text)', 'public.get_domain_favicon(text)',
                  'public.handle_contact_saved()', 'public.handle_company_saved()']) f;
select is(
    (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
         and p.proname in ('get_avatar_for_email', 'get_domain_favicon',
                           'handle_contact_saved', 'handle_company_saved')),
    0, 'case 23: under no other argument list either');
select is(
    (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
         and p.prosrc ~* '(http_get|http_post|http_put|http_delete|http_head|http_patch|http\()'),
    '',
    'case 23, after issue 35: no function of ours or upstream''s makes a request');
select is(pg_temp.try_as(r, $$ select public.get_domain_favicon('example.com') $$), 'ERROR 42883',
          'case 23: ' || r || ' cannot make the database fetch an address through get_domain_favicon')
from unnest(array['anon', 'authenticated']) r;
select is(pg_temp.try_as(r, $$ select public.get_avatar_for_email('a@example-com.example.org') $$), 'ERROR 42883',
          'case 23: ' || r || ' cannot make the database fetch an address through get_avatar_for_email')
from unnest(array['anon', 'authenticated']) r;

-- ------------------------------------------------------------- 18 anon
select is(pg_temp.try_as('anon', format('select count(*)::text from public.%I', t)), 'ERROR 42501',
          'case 18: anon cannot read ' || t)
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox', 'follow_ups']) t;
select is(pg_temp.try_as('anon', format('delete from public.%I', t)), 'ERROR 42501',
          'case 18: anon cannot delete from ' || t)
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox']) t;
select is(pg_temp.try_as('anon', $$ insert into public.companies (name) values ('Anon Co') $$),
          'ERROR 42501', 'case 18: anon cannot insert a company');
select is(pg_temp.try_as('anon', format(
              $$ insert into public.contacts (first_name, last_name, sales_id) values ('Anon', 'Person', %s) $$,
              pg_temp.sid('alpha'))),
          'ERROR 42501', 'case 18: anon cannot insert a person');
select is(pg_temp.try_as('anon', $$ update public.contacts set title = 'x' $$),
          'ERROR 42501', 'case 18: anon cannot update people');
select is(pg_temp.try_as('anon', $$ update public.sales set administrator = true $$),
          'ERROR 42501', 'case 18: anon cannot update teammates');
select is(pg_temp.try_as('anon', $$ select public.set_teammate_handle('bravo@example.org', 'delta') $$),
          'ERROR 42501', 'case 18: anon cannot call set_teammate_handle');

-- ---------------------------------------------------- 19 authenticated
select pg_temp.login('bravo@example.org');

select isnt(left(pg_temp.try_as('authenticated', format('select count(*)::text from public.%I', t)), 5),
            'ERROR', 'case 19: a teammate can read ' || t)
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox', 'follow_ups',
                  'contacts_summary']) t;
select is(pg_temp.try_as('authenticated', 'select count(*)::text from public.contacts'), '2',
          'case 19: a teammate sees every person, not only their own');
select is(pg_temp.try_as('authenticated', 'select count(*)::text from public.interview_transcripts'), '1',
          'case 19: a teammate sees the transcript');

select is(pg_temp.try_as('authenticated',
              $$ insert into public.contacts (first_name, last_name) values ('Grace', 'Hopper')
                 returning person_code $$),
          'BB-02', 'case 19: a teammate inserts a person, owned by them, with the next code');
select is(pg_temp.try_as('authenticated',
              $$ update public.contacts set title = 'Rear Admiral' where person_code = 'AA-01'
                 returning title $$),
          'Rear Admiral', 'case 19: a teammate updates a person');
select is(pg_temp.try_as('authenticated',
              $$ insert into public.companies (name) values ('Navy') returning name $$),
          'Navy', 'case 19: a teammate inserts a company');
select is(pg_temp.try_as('authenticated',
              $$ update public.companies set city = 'Arlington' where name = 'Navy' returning city $$),
          'Arlington', 'case 19: a teammate updates a company');
select is(pg_temp.try_as('authenticated', format(
              $$ insert into public.contact_notes (contact_id, text) values (%s, 'A touch by bravo.')
                 returning channel $$, pg_temp.pid('BB-01'))),
          'other', 'case 19: a teammate inserts a touch');
select is(pg_temp.try_as('authenticated', $$ update public.sales set administrator = true returning id::text $$),
          'ok', 'case 19: a teammate changes no row of sales');
select is((select count(*)::integer from public.sales where administrator), 1,
          'case 19: there is still one administrator');

select is(pg_temp.try_as('authenticated', v.stmt), 'ERROR 42501', 'case 19: a teammate cannot directly ' || v.what)
from (values
    ('insert an interview',
     format($$ insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                              title, overview, created_by)
               values (%s, '2026-11-20', %s, 'paste', true, 't', 'o', %s) $$,
            pg_temp.pid('BB-01'), pg_temp.sid('bravo'), pg_temp.sid('bravo'))),
    ('update an interview', $$ update public.interviews set overview = 'changed' $$),
    ('delete an interview', $$ delete from public.interviews $$),
    ('insert a transcript',
     $$ insert into public.interview_transcripts (interview_id, body)
        select id, repeat('x', 2000) from public.interviews $$),
    ('update a transcript', $$ update public.interview_transcripts set body = repeat('x', 2000) $$),
    ('delete a transcript', $$ delete from public.interview_transcripts $$),
    ('insert a hypothesis link',
     $$ insert into public.interview_hypotheses (interview_id, hypothesis, stance)
        select id, 'H9', 'supports' from public.interviews $$),
    ('update a hypothesis link', $$ update public.interview_hypotheses set stance = 'supports' $$),
    ('delete a hypothesis link', $$ delete from public.interview_hypotheses $$),
    ('insert into the inbox',
     format($$ insert into public.call_inbox (source, recorded_on, attendee_emails, transcript, submitted_by)
               values ('paste', '2026-11-20', array['y@example-com.example.org'], 'words', %s) $$, pg_temp.sid('bravo'))),
    ('update the inbox', $$ update public.call_inbox set state = 'dismissed' $$),
    ('delete from the inbox', $$ delete from public.call_inbox $$)
) as v(what, stmt);

-- --------------------------------------------- 20 a touch and its author
select is(pg_temp.try_as('authenticated',
              $$ with u as (update public.contact_notes set text = 'By bravo, edited by bravo.'
                            where text = 'By bravo.' returning 1)
                 select count(*)::text from u $$),
          '1', 'case 20: a teammate updates their own touch');
select is(pg_temp.try_as('authenticated',
              $$ with u as (update public.contact_notes set text = 'By alpha, edited by bravo.'
                            where text = 'By alpha.' returning 1)
                 select count(*)::text from u $$),
          '0', 'case 20: a teammate changes no row of a second teammate''s touch');
select is(pg_temp.try_as('authenticated', format(
              $$ update public.contact_notes set sales_id = %s where text = 'By bravo, edited by bravo.' $$,
              pg_temp.sid('alpha'))),
          'ERROR 42501', 'case 20: a teammate cannot hand their touch to someone else');
select results_eq(
    $$ select text from public.contact_notes where contact_id = pg_temp.pid('AA-01') order by text $$,
    $$ values ('By bravo, edited by bravo.'), ('By alpha.') $$,
    'case 20: the second teammate''s touch is as it was');

-- ----------------------------------- 21 a delete by a teammate removes nothing
create temp table before_delete as
    select (select count(*) from public.contacts) as contacts,
           (select count(*) from public.companies) as companies,
           (select count(*) from public.contact_notes) as notes;
grant select on before_delete to public;
select is(pg_temp.try_as('authenticated',
              format($$ with d as (delete from public.%I returning 1) select count(*)::text from d $$, t)),
          '0', 'case 21: a delete on ' || t || ' as a teammate removes no row')
from unnest(array['contacts', 'companies', 'contact_notes']) t;
select results_eq(
    $$ select (select count(*) from public.contacts), (select count(*) from public.companies),
              (select count(*) from public.contact_notes) $$,
    $$ select contacts, companies, notes from before_delete $$,
    'case 21: every person, company and touch is still there');

select pg_temp.logout();

-- -------------------------------- 22 nothing is deleted, even by the owner
select throws_ok($$ delete from public.contacts $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete people');
select throws_ok($$ delete from public.contacts where person_code = 'BB-01' $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete one person');
select throws_ok($$ truncate public.contacts cascade $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot truncate people');
select throws_ok($$ truncate public.contacts $$, null, null,
    'case 22: a plain truncate of people fails too');
select throws_ok($$ delete from public.companies where name = 'Example Clinic' $$,
    'P0001', 'people and interviews are never deleted',
    'case 22: deleting a company cannot take its people with it');
select throws_ok($$ delete from public.interviews $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete interviews');
select throws_ok($$ truncate public.interviews cascade $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot truncate interviews');
select throws_ok($$ delete from public.interview_transcripts $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete transcripts');
select throws_ok($$ truncate public.interview_transcripts $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot truncate transcripts');
select throws_ok($$ update public.interview_transcripts set body = repeat('tidy ', 400) $$,
    'P0001', 'a transcript is never changed', 'case 22: the owner cannot update a transcript');
select throws_ok($$ update public.interview_transcripts set reported_chars = 1 $$,
    'P0001', 'a transcript is never changed', 'case 22: not even its reported size');
-- touches and the inbox are never deleted either (issue 21, reopened)
select throws_ok($$ delete from public.contact_notes $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete touches');
select throws_ok($$ delete from public.contact_notes where text = 'By alpha.' $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete one touch');
select throws_ok($$ truncate public.contact_notes $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot truncate touches');
select is(pg_temp.try_as('service_role',
              $$ with d as (delete from public.contact_notes returning 1) select count(*)::text from d $$),
          'ERROR P0001',
          'case 22: the service role cannot delete touches');
select throws_ok($$ delete from public.call_inbox $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot delete from the inbox');
select throws_ok($$ truncate public.call_inbox $$,
    'P0001', 'people and interviews are never deleted', 'case 22: the owner cannot truncate the inbox');
select lives_ok($$ update public.contact_notes set text = text
                   where text = 'By alpha.' $$,
    'case 22: a touch can still be updated');
select is((select count(*)::integer from public.contact_notes), 3, 'case 22: the three touches are still there');
select is((select count(*)::integer from public.call_inbox), 1, 'case 22: the recording is still in the inbox');
-- what may be deleted, by the owner only, and why (docs/SCHEMA.md)
select lives_ok($$ delete from public.interview_hypotheses $$,
    'case 22: the owner may delete hypothesis links, which update_overview replaces');
select lives_ok($$ delete from public.companies where name = 'Navy' $$,
    'case 22: the owner may delete a company that has no people');
select is((select count(*)::integer from public.contacts), 3, 'case 22: the three people are still there');
select is((select count(*)::integer from public.interview_transcripts), 1, 'case 22: the transcript is still there');

-- ------------------------------------------------- 10 row level security
select is(
    (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
         and c.relname in ('sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                           'interview_transcripts', 'interview_hypotheses', 'call_inbox')),
    8, 'point 10: row level security is on for all eight tables');
select is(
    (select count(*)::integer from pg_policies
     where schemaname = 'public' and cmd in ('DELETE', 'ALL')
         and tablename in ('sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                           'interview_transcripts', 'interview_hypotheses', 'call_inbox')),
    0, 'point 11: no table of the schema has a delete policy');
select is(
    (select count(*)::integer from pg_policies
     where schemaname = 'public' and cmd <> 'SELECT'
         and tablename in ('sales', 'interviews', 'interview_transcripts', 'interview_hypotheses', 'call_inbox')),
    0, 'point 10: function only tables and sales have read policies only');
select is(
    (select count(*)::integer from pg_policies
     where schemaname = 'public' and 'anon' = any(roles)
         and tablename in ('sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                           'interview_transcripts', 'interview_hypotheses', 'call_inbox')),
    0, 'point 10: no policy names anon');

-- --------------------------------------------------- 24 the export role
select is((select rolcanlogin from pg_roles where rolname = 'hub_export'), false,
          'case 24: hub_export has no login');
select is((select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls or rolreplication
           from pg_roles where rolname = 'hub_export'), false,
          'case 24: hub_export has no special right');
select ok(has_table_privilege('hub_export', 'public.' || t, 'select'),
          'case 24: hub_export holds select on ' || t)
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox', 'follow_ups']) t;
select ok(not has_table_privilege('hub_export', 'public.' || t, 'insert, update, delete, truncate'),
          'case 24: hub_export holds no write on ' || t)
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox', 'follow_ups']) t;
select ok(not has_table_privilege('hub_export', 'auth.users', 'select'),
          'case 24: hub_export holds no select on auth.users');
select is(
    (select count(*)::integer
     from information_schema.role_table_grants g
     where g.grantee = 'hub_export'
         and (g.table_schema, g.table_name) not in (
             ('public', 'sales'), ('public', 'companies'), ('public', 'contacts'),
             ('public', 'contact_notes'), ('public', 'interviews'), ('public', 'interview_transcripts'),
             ('public', 'interview_hypotheses'), ('public', 'call_inbox'), ('public', 'follow_ups'))),
    0, 'case 24: hub_export is granted nothing outside the nine objects');

select is(pg_temp.try_as('hub_export', 'select count(*)::text from public.contacts'), '3',
          'case 24: acting as hub_export, every person is read');
select is(pg_temp.try_as('hub_export', 'select count(*)::text from public.interview_transcripts'), '1',
          'case 24: acting as hub_export, the transcript is read');
select is(pg_temp.try_as('hub_export', 'select count(*)::text from public.follow_ups'), '0',
          'case 24: acting as hub_export, follow_ups is read');
select isnt(left(pg_temp.try_as('hub_export', format('select count(*)::text from public.%I', t)), 5),
            'ERROR', 'case 24: acting as hub_export, ' || t || ' is read')
from unnest(array['sales', 'companies', 'contact_notes', 'interviews', 'interview_hypotheses', 'call_inbox']) t;
select is(pg_temp.try_as('hub_export', v.stmt), 'ERROR 42501', 'case 24: acting as hub_export, cannot ' || v.what)
from (values
    ('insert a company', $$ insert into public.companies (name) values ('Export Co') $$),
    ('update a person', $$ update public.contacts set title = 'x' $$),
    ('delete a touch', $$ delete from public.contact_notes $$),
    ('update a transcript', $$ update public.interview_transcripts set body = 'x' $$),
    ('insert into the inbox', $$ insert into public.call_inbox (source) values ('paste') $$),
    ('read auth.users', $$ select count(*)::text from auth.users $$),
    ('read deals', $$ select count(*)::text from public.deals $$),
    ('set a handle', $$ select public.set_teammate_handle('bravo@example.org', 'delta') $$)
) as v(what, stmt);

-- ------------------------------ issue 35: the export role is truly read only
-- Found by issue 27: pg_net granted its two tables to every role, so
-- hub_export could write there. The migration of issue 35 drops pg_net and
-- the one upstream function that used it.

-- case 1: as hub_export, an insert into every table of public is refused
select is(pg_temp.run_as('hub_export', format('insert into public.%I default values', c.relname)),
          'ERROR 42501', 'issue 35 case 1: acting as hub_export, an insert into ' || c.relname || ' is refused')
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
order by c.relname;

-- case 2: pg_net's tables are gone, or every write on them is refused
select ok(pg_temp.run_as('hub_export', format(v.stmt, t)) in ('ERROR 3F000', 'ERROR 42P01', 'ERROR 42501'),
          'issue 35 case 2: acting as hub_export, ' || v.what || ' on ' || t || ' is refused or the table is gone ('
          || pg_temp.run_as('hub_export', format(v.stmt, t)) || ')')
from unnest(array['net.http_request_queue', 'net._http_response']) t
    cross join (values
        ('an insert', 'insert into %s default values'),
        ('an update', 'update %s set id = id'),
        ('a delete', 'delete from %s'),
        ('a truncate', 'truncate %s')) as v(what, stmt);

-- case 3: everything hub_export holds, asked of the catalog. Every table,
-- view, sequence, function and schema outside pg_catalog and
-- information_schema (what every Postgres role holds there cannot be taken
-- away, and is the same for a role with nothing). A right on an object in a
-- schema the role may not enter cannot be used and is left out.
create temp table hub_export_holds as
select 'relation'::text as kind, n.nspname::text as sch, c.relname::text as obj, p.priv
from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
where c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('hub_export', c.oid, p.priv)
         or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
             and has_any_column_privilege('hub_export', c.oid, p.priv)))
union all
select 'sequence', n.nspname, c.relname, p.priv
from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) as p(priv)
where c.relkind = 'S' and has_sequence_privilege('hub_export', c.oid, p.priv)
union all
select 'function', n.nspname, f.oid::regprocedure::text, 'EXECUTE'
from pg_proc f
    join pg_namespace n on n.oid = f.pronamespace
where has_function_privilege('hub_export', f.oid, 'EXECUTE')
union all
select 'schema', n.nspname, '', p.priv
from pg_namespace n
    cross join unnest(array['USAGE', 'CREATE']) as p(priv)
where has_schema_privilege('hub_export', n.oid, p.priv);

create temp view hub_export_usable as
select h.*,
       (h.kind = 'schema' and h.sch = 'public' and h.priv = 'USAGE')
       or (h.kind = 'relation' and h.sch = 'public' and h.priv = 'SELECT'
           and h.obj in ('sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                         'interview_transcripts', 'interview_hypotheses', 'call_inbox', 'follow_ups')) as listed
from hub_export_holds h
where h.sch not in ('pg_catalog', 'information_schema')
    and h.sch !~ '^pg_(temp|toast)'
    and (h.kind = 'schema' or has_schema_privilege('hub_export', h.sch, 'USAGE'));

select is((select count(*)::integer from hub_export_usable where listed), 10,
          'issue 35 case 3: hub_export holds select on the nine objects of docs/SCHEMA.md and usage on public');
select is((select coalesce(string_agg(kind || ' ' || sch || rtrim('.' || obj, '.') || ': ' || priv, '; '
                                      order by kind, sch, obj, priv), '')
           from hub_export_usable where not listed),
          '', 'issue 35 case 3: and holds nothing else that it can use, in any schema');
select is((select coalesce(string_agg(kind || ' ' || sch || '.' || obj || ': ' || priv, '; '
                                      order by sch, obj, priv), '')
           from hub_export_usable
           where kind = 'relation' and priv in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
          '', 'issue 35 case 3: the catalog lists zero write rights for hub_export');
select is(has_database_privilege('hub_export', current_database(), 'CREATE'), false,
          'issue 35 case 3: hub_export may not create a schema in the database');

-- issue 40 item 9: the system schemas, no longer left out in silence. In
-- pg_catalog and information_schema hub_export may hold only these kinds of
-- right, each for the reason given, and nothing else:
--   USAGE on the two schemas     every role has it, a client cannot work without it
--   SELECT on a table or view    the catalog is readable by every role
--   EXECUTE on a function        PUBLIC holds it on the built in functions
--   UPDATE on pg_catalog.pg_settings
--                                 every role holds it; it changes only that
--                                 session's own settings, no stored data
--                                 (docs/DECISIONS.md, issue 40)
-- Any other right there (a write on a catalog table, CREATE on a schema, a
-- sequence) fails the first test. The second asks that every right counted
-- is one a role made here with nothing at all also holds, so hub_export holds
-- nothing in those schemas through a grant of its own.
create temp view hub_export_system as
select h.* from hub_export_holds h where h.sch in ('pg_catalog', 'information_schema');
select is((select coalesce(string_agg(kind || ' ' || sch || rtrim('.' || obj, '.') || ': ' || priv, '; '
                                      order by kind, sch, obj, priv), '')
           from hub_export_system
           where not ((kind = 'schema' and priv = 'USAGE')
                      or (kind = 'relation' and priv = 'SELECT')
                      or (kind = 'function' and priv = 'EXECUTE')
                      or (kind = 'relation' and sch = 'pg_catalog' and obj = 'pg_settings' and priv = 'UPDATE'))),
          '', 'issue 40 item 9: in pg_catalog and information_schema hub_export holds only the rights listed, and why');
create role hub_test_nothing nologin;
select is((select coalesce(string_agg(kind || ' ' || sch || rtrim('.' || obj, '.') || ': ' || priv, '; '
                                      order by kind, sch, obj, priv), '')
           from hub_export_system h
           where not case h.kind
               when 'schema' then has_schema_privilege('hub_test_nothing', h.sch, h.priv)
               when 'function' then has_function_privilege('hub_test_nothing', h.obj::regprocedure, h.priv)
               when 'sequence' then has_sequence_privilege('hub_test_nothing', (quote_ident(h.sch) || '.' || quote_ident(h.obj))::regclass, h.priv)
               else has_table_privilege('hub_test_nothing', (quote_ident(h.sch) || '.' || quote_ident(h.obj))::regclass, h.priv)
                    or has_any_column_privilege('hub_test_nothing', (quote_ident(h.sch) || '.' || quote_ident(h.obj))::regclass, h.priv)
           end),
          '', 'issue 40 item 9: and each of them is one that a role with nothing holds too');
select cmp_ok((select count(*)::integer from hub_export_system), '>', 0,
          'issue 40 item 9: the system schemas were looked at (the count above is not zero by accident)');
select is((select count(*)::integer from hub_export_system
           where kind = 'relation' and priv <> 'SELECT'), 1,
          'issue 40 item 9: the one write right counted there is update on pg_settings');

-- case 4: nothing in public reaches for pg_net or the http functions
select is((select coalesce(string_agg(f.proname, ', ' order by f.proname), '')
           from pg_proc f
           where f.pronamespace = 'public'::regnamespace and f.prosrc ~* '(\mnet\.|http_)'),
          '', 'issue 35 case 4: no function in public references net. or http_');
select is((select coalesce(string_agg(t.tgname, ', ' order by t.tgname), '')
           from pg_trigger t
               join pg_proc f on f.oid = t.tgfoid
               join pg_class c on c.oid = t.tgrelid
           where not t.tgisinternal and c.relnamespace = 'public'::regnamespace
               and (f.prosrc ~* '(\mnet\.|http_)' or t.tgname like '%delete_note_attachments')),
          '', 'issue 35 case 4: no trigger in public calls such a function');
select is((select count(*)::integer from pg_extension where extname = 'pg_net'), 0,
          'issue 35 case 4: the extension pg_net is not installed');
select is(to_regnamespace('net'), null, 'issue 35 case 4: there is no schema net');

-- case 5: a touch is still saved and updated by a signed in teammate whose
-- request carries a sign-in header (the path that used to call the edge
-- function through pg_net). Since issue 40 item 14 a new attachment is
-- refused; an old one, put here with the refusal switched off, can still be
-- taken away.
select pg_temp.login('alpha@example.org');
select set_config('request.headers', '{"authorization": "Bearer made-up-for-this-test"}', true);
select throws_ok($$ insert into public.contact_notes (contact_id, date, sales_id, channel, text, attachments)
                   values (pg_temp.pid('AA-01'), now(), pg_temp.sid('alpha'), 'email', 'With a file.',
                           array['{"title": "a.pdf", "path": "a.pdf"}'::jsonb]) $$,
    'P0001', 'files are not attached to a note in the hub: write what the file says in the note',
    'issue 40 item 14: a touch with an attachment is refused');
select pg_temp.logout();
alter table public.contact_notes disable trigger hub_refuse_new_attachments;
insert into public.contact_notes (contact_id, date, sales_id, channel, text, attachments)
    values (pg_temp.pid('AA-01'), now(), pg_temp.sid('alpha'), 'email', 'With a file.',
            array['{"title": "a.pdf", "path": "a.pdf"}'::jsonb]);
alter table public.contact_notes enable trigger hub_refuse_new_attachments;
select pg_temp.login('alpha@example.org');
select throws_ok($$ update public.contact_notes
                   set attachments = array['{"title": "b.pdf", "path": "b.pdf"}'::jsonb]
                   where text = 'With a file.' $$,
    'P0001', 'files are not attached to a note in the hub: write what the file says in the note',
    'issue 40 item 14: an old attachment cannot be replaced by a new one');
select throws_ok($$ update public.contact_notes
                   set attachments = array['{"title": "a.pdf", "path": "a.pdf"}'::jsonb, '{"title": "c.pdf", "path": "c.pdf"}'::jsonb]
                   where text = 'With a file.' $$,
    'P0001', 'files are not attached to a note in the hub: write what the file says in the note',
    'issue 40 item 14: nor can one be added beside it');
select lives_ok($$ update public.contact_notes set next_step = 'Read it.' where text = 'With a file.' $$,
    'issue 35 case 5: a touch that carries an old attachment can still be updated');
select lives_ok($$ update public.contact_notes set attachments = null where text = 'With a file.' $$,
    'issue 35 case 5: its attachment is removed');
select is((select count(*)::integer from public.contact_notes where text = 'With a file.'), 1,
          'issue 35 case 5: the touch is there');
select set_config('request.headers', '', true);
select pg_temp.logout();

select * from finish();
rollback;
