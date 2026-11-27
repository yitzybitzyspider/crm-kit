-- team hub, issue 47 (router addition): an invitation by email address, so
-- a teammate's account can be made from the Supabase dashboard. pgTAP, run by
-- scripts/dbtest.sh in the db workflow against a throwaway stack, as the
-- database owner. Everything here is rolled back at the end. The same through
-- the administrator API (what the dashboard calls) is in
-- app/e2e-signin/last-gaps.e2e.ts.
begin;
select no_plan();

select is((select count(*)::int from public.sales), 0, 'invite: the database starts with no teammate');
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

-- the first user, on the list
select public.allow_signup_email('lead@clinic-example.example.org');
select is(pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000047b1', 'lead@clinic-example.example.org')$$),
    'ok', 'invite: the first allowed user signs up');

-- 1. what invite_teammate_email takes
select is(public.invite_teammate_email('  Tess@Clinic-example.example.org '), 'tess@clinic-example.example.org',
    'invite: an address is kept trimmed and in lower case');
select is(pg_temp.try($$select public.invite_teammate_email('@clinic.example')$$),
    'ERROR that is not one email address', 'invite: one address, never a domain');
select is(pg_temp.try($$select public.invite_teammate_email(null)$$),
    'ERROR that is not one email address', 'invite: no address is refused');

-- 2. invited and on the list: teammate 2, with an id the dashboard picks
select public.allow_signup_email('tess@clinic-example.example.org');
select is(pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000047b2', 'TESS@clinic-example.example.org')$$),
    'ok', 'invite: an invited address on the list gets an account, with no invitation row for its id');
select is((select administrator from public.sales where user_id = '00000000-0000-4000-8000-0000000047b2'), false,
    'invite: and is a teammate, not an administrator');
select is((select count(*)::int from hub_private.invited_emails where email = 'tess@clinic-example.example.org'), 0,
    'invite: the invitation is used up');

-- 3. on the list, not invited: refused after the first user
select public.allow_signup_email('una@clinic-example.example.org');
select is(pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000047b3', 'una@clinic-example.example.org')$$),
    'ERROR Sign up is not allowed', 'invite: an address on the list but not invited is refused');

-- 4. invited, not on the list: refused by the list, which is asked first
select public.invite_teammate_email('ivan@elsewhere-example.example.org');
select is(pg_temp.try($$insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000047b4', 'ivan@elsewhere-example.example.org')$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'invite: an invited address not on the list is refused');
select is(pg_temp.try($$insert into auth.users (id, email, is_sso_user) values ('00000000-0000-4000-8000-0000000047b5', 'ivan@elsewhere-example.example.org', true)$$),
    'ERROR Sign up is not allowed: this email is not on the hub''s list',
    'invite: and so is the same address flagged as SSO');
select is((select count(*)::int from public.sales), 2, 'invite: two teammates, no more');

-- 5. who may invite
select is(pg_temp.try_as('authenticated', $$select public.invite_teammate_email('a@b-example.example.org')$$), 'ERROR 42501',
    'invite: a signed in role cannot call invite_teammate_email');
select is(pg_temp.try_as('anon', $$select public.invite_teammate_email('a@b-example.example.org')$$), 'ERROR 42501',
    'invite: nor can the public key');
select is(pg_temp.try_as('service_role', $$select public.invite_teammate_email('a@b-example.example.org')$$), 'ERROR 42501',
    'invite: nor can the service key');
select is(pg_temp.try_as('authenticated', $$select count(*) from hub_private.invited_emails$$), 'ERROR 42501',
    'invite: no API role can read the invitations');
select ok(not has_function_privilege(r, 'public.invite_teammate_email(text)', 'execute'),
          'invite: ' || r || ' holds no execute on invite_teammate_email')
from unnest(array['anon', 'authenticated', 'service_role', 'hub_export']) as r;
select set_config('request.jwt.claims',
    json_build_object('sub', '00000000-0000-4000-8000-0000000047b1', 'role', 'authenticated')::text, true);
select is(pg_temp.try($$select public.invite_teammate_email('a@b-example.example.org')$$),
    'ERROR only the database owner can invite a teammate',
    'invite: a session carrying a sign-in is refused, even the owner''s');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
