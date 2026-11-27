-- team hub, issue 40 item 11: the sign-up list. pgTAP, run by
-- scripts/dbtest.sh in the db workflow against a throwaway stack, as the
-- database owner. Everything here is rolled back at the end. The same rule
-- through Supabase's own sign-up endpoint, with sign-ups switched on, is
-- proven in app/e2e-signin/signin.e2e.ts (job "trigger alone").
begin;
select no_plan();

-- A stack that was just started holds no teammate; each pgTAP file rolls
-- back. Only this file's entries are on the list.
select is((select count(*)::int from public.sales), 0, 'item 11: the database starts with no teammate');
delete from hub_private.signup_allow_list;

create function pg_temp.try(stmt text) returns text language plpgsql as $$
begin
    execute stmt;
    return 'ok';
exception when others then
    return 'ERROR ' || sqlerrm;
end $$;

create function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    execute format('set local role %I', role_name);
    begin
        execute stmt;
        r := 'ok';
    exception when others then
        r := 'ERROR ' || sqlstate;
    end;
    execute 'reset role';
    return r;
end $$;

-- 1. the first user of an empty database, a stranger: refused, no teammate
select is(
    pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000040a1', 'stranger@elsewhere-example.example.org')$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'item 11: a stranger as the first user of an empty database is refused');
select is((select count(*)::int from public.sales), 0, 'item 11: and no teammate was made');

-- 2. the same stranger flagged as an SSO user gets no way round the list
select is(
    pg_temp.try($$insert into auth.users (id, email, is_sso_user) values ('00000000-0000-4000-8000-0000000040a2', 'stranger@elsewhere-example.example.org', true)$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'item 11: an SSO flagged stranger is refused too');

-- 3. an email on the list, in other capitals: the first user, administrator
select is(public.allow_signup_email('  Lead@Clinic-example.example.org '), 'lead@clinic-example.example.org',
    'item 11: allow_signup_email keeps one exact address in lower case');
select is(
    pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000040a3', 'LEAD@clinic-example.example.org')$$),
    'ok', 'item 11: an email on the list signs up');
select is((select administrator from public.sales where user_id = '00000000-0000-4000-8000-0000000040a3'), true,
    'item 11: the first allowed user is the administrator');

-- 4. after the first user: a stranger with an invitation row is still refused
insert into public.user_invitations (user_id) values ('00000000-0000-4000-8000-0000000040a4');
select is(
    pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000040a4', 'other@elsewhere-example.example.org')$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'item 11: an invited stranger is refused after the first user exists');
select is(
    pg_temp.try($$insert into auth.users (id, email, is_sso_user) values ('00000000-0000-4000-8000-0000000040a5', 'other@elsewhere-example.example.org', true)$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'item 11: and so is an SSO flagged one');
select is((select count(*)::int from public.sales), 1, 'item 11: still one teammate');

-- 5. what the list takes
select is(pg_temp.try($$insert into hub_private.signup_allow_list (entry) values ('@gmail.com')$$)
    like 'ERROR %signup_allow_list_entry_shape%', true,
    'item 11: a domain entry that is not a .test domain is refused');
select is(pg_temp.try($$insert into hub_private.signup_allow_list (entry) values ('Upper@Case-example.example.org')$$)
    like 'ERROR %signup_allow_list_entry_shape%', true,
    'item 11: an entry not in lower case is refused');
select is(pg_temp.try($$select public.allow_signup_email('@hub.test')$$),
    'ERROR that is not one email address', 'item 11: allow_signup_email takes one address, never a domain');
select is(pg_temp.try($$insert into hub_private.signup_allow_list (entry) values ('@team.test')$$), 'ok',
    'item 11: a .test domain entry is taken, for test stacks');
select is(pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000040a6', 'x@nottheteam-test.example.org')$$)
    like 'ERROR Sign up is not allowed: this email is not on%', true,
    'item 11: a domain entry matches the whole domain only, not its tail');

-- 6. who may change the list
select is(pg_temp.try_as('authenticated', $$select public.allow_signup_email('a@b-example.example.org')$$), 'ERROR 42501',
    'item 11: a signed in role cannot call allow_signup_email');
select is(pg_temp.try_as('anon', $$select public.allow_signup_email('a@b-example.example.org')$$), 'ERROR 42501',
    'item 11: nor can the public key');
select is(pg_temp.try_as('service_role', $$select public.allow_signup_email('a@b-example.example.org')$$), 'ERROR 42501',
    'item 11: nor can the service key');
select is(pg_temp.try_as('authenticated', $$select count(*) from hub_private.signup_allow_list$$), 'ERROR 42501',
    'item 11: no API role can read the list');
select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000040a3', 'role', 'authenticated')::text, true);
select is(pg_temp.try($$select public.allow_signup_email('a@b-example.example.org')$$),
    'ERROR only the database owner can change the sign-up list',
    'item 11: a session carrying a sign-in is refused, even the owner''s');
select set_config('request.jwt.claims', '', true);
select is(public.remove_signup_email('LEAD@clinic-example.example.org'), 'lead@clinic-example.example.org',
    'item 11: remove_signup_email takes an address off the list');

select * from finish();
rollback;
