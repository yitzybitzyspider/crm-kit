-- team hub, issue 65: add_person_with_touches, a new person and their first
-- touches in one call, all or nothing. pgTAP. Run by scripts/dbtest.sh in the
-- db workflow, against a throwaway stack, as the database owner with a
-- teammate's sign-in set on the request. Everything here is rolled back at
-- the end. The numbers in the descriptions are the test cases of issue 65.
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

-- Runs one statement and says what happened: the single value it returned,
-- '(null)' when it returned none, or 'ERROR: ' and the sentence. A statement
-- that fails leaves nothing behind, as a failed request leaves nothing.
create function pg_temp.call(stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    begin
        execute stmt into r;
        return coalesce(r, '(null)');
    exception when others then
        return 'ERROR: ' || sqlerrm;
    end;
end $$;

-- The same for a statement that returns one jsonb value: an error comes back as {"error": ...}.
create function pg_temp.calljson(stmt text) returns jsonb language plpgsql as $$
declare
    r text := pg_temp.call(stmt);
begin
    if r like 'ERROR: %' or r = '(null)' then
        return jsonb_build_object('error', r);
    end if;
    return r::jsonb;
end $$;

-- The same, as another database role.
create function pg_temp.call_as(role_name text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    execute format('set local role %I', role_name);
    begin
        execute stmt into r;
        r := coalesce(r, '(null)');
    exception when others then
        r := 'ERROR: ' || sqlerrm;
    end;
    execute 'reset role';
    return r;
end $$;

-- Everything the call could have written, as one line of text.
create function pg_temp.state() returns text language sql as $$
    select concat_ws('|',
        (select count(*) from public.contacts), (select count(*) from public.companies),
        (select count(*) from public.contact_notes), (select count(*) from public.audit_log),
        (select count(*) from public.log_requests),
        (select md5(coalesce(string_agg(concat_ws(',', person_code, status, sales_id), ';' order by id), ''))
         from public.contacts))
$$;

-- The sentence a statement is refused with, when it is refused and nothing
-- at all was written. Anything else comes back marked.
create function pg_temp.refused(stmt text) returns text language plpgsql as $$
declare
    v_before text := pg_temp.state();
    r text := pg_temp.call(stmt);
begin
    if r not like 'ERROR: %' then
        return 'NOT REFUSED, it returned: ' || r;
    end if;
    if pg_temp.state() <> v_before then
        return substr(r, 8) || ' [BUT SOMETHING WAS WRITTEN]';
    end if;
    return substr(r, 8);
end $$;

-- One call of the action with a person and a list of touches, as SQL text.
create function pg_temp.log(person text, touches text, rid text default null) returns text language sql as $$
    select format('select public.add_person_with_touches(%L::jsonb, %L::jsonb, %s, ''claude'')',
                  person, touches, coalesce(quote_literal(rid) || '::uuid', 'null'))
$$;

-- --------------------------------------------------------------- teammates
insert into public.user_invitations (user_id) values
    ('00000000-0000-4000-8000-0000000065d1'), ('00000000-0000-4000-8000-0000000065d2');
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000065d1', 'delta@example.org'),
    ('00000000-0000-4000-8000-0000000065d2', 'bravo@example.org');
select public.set_teammate_handle('delta@example.org', 'delta');
select public.set_teammate_handle('bravo@example.org', 'bravo');
select pg_temp.login('delta@example.org');

-- ------------------------------------------------------- the function itself
select ok((select p.prosecdef and p.proconfig @> array['search_path=""']
           from pg_proc p where p.oid = 'public.add_person_with_touches(jsonb, jsonb, uuid, text)'::regprocedure),
          'it runs as its owner with an empty search path');
select ok(has_function_privilege('authenticated', 'public.add_person_with_touches(jsonb, jsonb, uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.add_person_with_touches(jsonb, jsonb, uuid, text)', 'execute')
          and not has_function_privilege('service_role', 'public.add_person_with_touches(jsonb, jsonb, uuid, text)', 'execute')
          and not has_function_privilege('hub_export', 'public.add_person_with_touches(jsonb, jsonb, uuid, text)', 'execute'),
          'only a signed in teammate may call it');
select ok(not has_table_privilege(r, 'public.log_requests', p), 'log_requests: ' || r || ' has no ' || p)
from unnest(array['anon', 'authenticated', 'service_role', 'hub_export']) r,
     unnest(array['select', 'insert', 'update', 'delete']) p;

-- ------------------------------------------------------------------ case 1
create temp table a1 as select coalesce(max(id), 0) as last_id from public.audit_log;
select is(pg_temp.calljson(pg_temp.log(
    '{"name": "Casey Lane", "role": "ER resident", "organization": "Metro",
      "contact": ["casey@example-test.example.org", "https://www.linkedin.com/in/casey-lane-x/"]}',
    format('[{"channel": "other", "what": "Met her at the conference.", "date": "%s", "status": "contacted"},
             {"channel": "email", "what": "She wrote back and wants to talk.", "date": "%s", "status": "replied",
              "next": "Send times", "due": "%s"}]',
           current_date - 3, current_date - 1, current_date + 4))) - 'touch_ids',
    '{"name": "Casey Lane", "slug": "casey-lane", "owner": "delta", "status": "replied", "touches": 2,
      "request_id": null, "person_code": "DD-01"}'::jsonb,
    'case 1: a person and two touches in one call: the code, owner, final status and the count come back');
select results_eq(
    $$ select status, title, email_jsonb -> 0 ->> 'email', linkedin_url from public.contacts where person_code = 'DD-01' $$,
    $$ values ('replied'::text, 'ER resident'::text, 'casey@example-test.example.org'::text,
               'https://www.linkedin.com/in/casey-lane-x/'::text) $$,
    'case 1: one person, status replied, both contact details filed');
select results_eq(
    $$ select n.channel, n.status, n.next_step, n.next_due from public.contact_notes n
       where n.contact_id = pg_temp.pid('DD-01') order by n.date $$,
    format($$ values ('other'::text, 'contacted'::text, null::text, null::date),
                     ('email', 'replied', 'Send times', %L::date) $$, current_date + 4),
    'case 1: two touches, in date order, the second with its next step and due date');
select results_eq(
    $$ select next_step, next_due from public.follow_ups where contact_id = pg_temp.pid('DD-01') $$,
    format($$ values ('Send times'::text, %L::date) $$, current_date + 4),
    'case 1: the follow-up list has the next step and its due date');

-- ------------------------------------------------------------------ case 10
select is((select count(*)::integer from public.audit_log a
           where a.id > (select last_id from a1)
               and a.action = 'add_person' and a.table_name = 'contacts' and a.via = 'claude'
               and a.actor_handle = 'delta' and a.row_id = pg_temp.pid('DD-01')::text and a.old_row is null),
          1, 'case 10: the person''s insert is in the audit table as add_person, via claude, by delta');
select is((select count(*)::integer from public.audit_log a
           where a.id > (select last_id from a1)
               and a.action = 'log_touch' and a.table_name = 'contact_notes' and a.via = 'claude'
               and a.actor_handle = 'delta' and a.old_row is null
               and (a.new_row ->> 'contact_id')::bigint = pg_temp.pid('DD-01')),
          2, 'case 10: each touch is in the audit table as log_touch, via claude, by delta');
select is((select count(*)::integer from public.audit_log a
           where a.id > (select last_id from a1) and (a.action is null or a.action not in ('add_person', 'log_touch'))),
          0, 'case 10: no audit row under any other action');

-- ------------------------------------------------------------------ case 2
select is(pg_temp.refused(pg_temp.log('{"name": "Dana Ortiz"}',
          '[{"channel": "email", "what": "Sent the note."}, {"channel": "sms", "what": "Texted her."}]')),
          'touch 2: channel ''sms'' is not allowed: use email, linkedin, phone, text, intro, in-person or other',
          'case 2: touch 2 on channel sms is refused, naming the touch, and nothing is written');
select is((select count(*)::integer from public.contacts where name_key = public.hub_name_key('Dana Ortiz')), 0,
          'case 2: no person row');

-- edge: touch 3 of 3 refused (its date is in the future)
select is(pg_temp.refused(pg_temp.log('{"name": "Dana Ortiz", "organization": "Brand New Clinic"}',
          format('[{"channel": "email", "what": "a"}, {"channel": "phone", "what": "b"},
                   {"channel": "email", "what": "c", "date": "%s"}]', current_date + 30))),
          format('touch 3: the date %s is in the future', current_date + 30),
          'edge: touch 3 of 3 refused: no person, no touches 1 and 2, no new organization');

-- ------------------------------------------------------------------ case 3
select is(pg_temp.refused(pg_temp.log('{"name": "Dr. Casey Lane, MD"}', '[{"channel": "email", "what": "Hello"}]')),
          'already on file (same name): DD-01, Casey Lane, owner delta, status replied, last touch '
          || to_char(current_date - 1, 'YYYY-MM-DD') || ' by delta via email',
          'case 3: a person already on file is refused naming them, and nothing is written');

-- ------------------------------------------------------------------ case 4, 5
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}', '[]')), 'touches: give 1 to 20 touches, not 0',
          'case 4: an empty list of touches is refused');
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}',
          (select jsonb_agg(jsonb_build_object('channel', 'email', 'what', 'note ' || n))::text
           from generate_series(1, 21) n))),
          'touches: give 1 to 20 touches, not 21', 'case 5: 21 touches are refused');
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}', '{"channel": "email"}')),
          'touches must be a list of 1 to 20 touches', 'touches that are not a list are refused');

-- ------------------------------------------------------------------ case 6
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park", "phone_number": "+1 415 555 0100"}',
                                      '[{"channel": "email", "what": "Hi"}]')),
          'person: unknown key ''phone_number'': use name, role, organization, contact, referred_by, owner, quote_by_name or category',
          'case 6: an unknown key in person is refused');
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}', '[{"channel": "email", "what": "Hi", "note": "x"}]')),
          'touch 1: unknown key ''note'': use channel, what, date, by, next, due or status',
          'an unknown key in a touch is refused, naming the touch');
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park", "contact": 5}', '[{"channel": "email", "what": "Hi"}]')),
          'person: contact must be a list of text', 'a contact that is not text is refused');
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}', '[{"channel": "email", "what": "Hi", "date": "11/20/2026"}]')),
          'touch 1: date must be a date as YYYY-MM-DD, not ''11/20/2026''', 'a date in another shape is refused, naming the touch');
select is(pg_temp.refused(pg_temp.log('[1]', '[{"channel": "email", "what": "Hi"}]')),
          'person must be an object with at least a name', 'a person that is not an object is refused');

-- edge: due with no next
select is(pg_temp.refused(pg_temp.log('{"name": "Eve Park"}',
          format('[{"channel": "email", "what": "Hi"}, {"channel": "email", "what": "Again", "due": "%s"}]', current_date + 2))),
          'touch 2: a due date needs a next step', 'edge: a due date with no next step is refused, naming the touch');

-- edge: scheduled on touch 1, replied on touch 2: the last one wins
select is(pg_temp.calljson(pg_temp.log('{"name": "Femi Ade"}',
          format('[{"channel": "email", "what": "Booked Tuesday.", "date": "%s", "status": "scheduled"},
                   {"channel": "email", "what": "She wrote again.", "date": "%s", "status": "replied"}]',
                 current_date - 2, current_date - 1))) ->> 'status',
          'replied', 'edge: scheduled then replied ends replied');
select is((select status from public.contacts where name_key = public.hub_name_key('Femi Ade')), 'replied',
          'edge: and the person is replied');

-- edge: touches are applied in date order, then list order
select is(pg_temp.calljson(pg_temp.log('{"name": "Gus Hale"}',
          format('[{"channel": "email", "what": "second", "date": "%1$s", "status": "replied"},
                   {"channel": "email", "what": "first", "date": "%2$s", "status": "scheduled"},
                   {"channel": "phone", "what": "third", "date": "%1$s"}]',
                 current_date - 1, current_date - 5))) ->> 'status',
          'replied', 'edge: the latest touch sets the final status, whatever its place in the list');
select results_eq(
    $$ select n.text from public.contact_notes n where n.contact_id = (select id from public.contacts
       where name_key = public.hub_name_key('Gus Hale')) order by n.id $$,
    $$ values ('first'::text), ('second'), ('third') $$,
    'edge: saved in date order, then list order');

-- ------------------------------------------------------------------ case 7
select is(pg_temp.calljson(pg_temp.log('{"name": "Hana Ito"}',
          '[{"channel": "email", "what": "Hi"}, {"channel": "phone", "what": "Called."}]',
          '6f1d5b8e-6565-4e1a-9c65-000000000001')) ->> 'person_code', 'DD-04', 'case 7: the first call with a request id saves');
create temp table s7 as select pg_temp.state() as s;
select is(pg_temp.calljson(pg_temp.log('{"name": "Hana Ito"}',
          '[{"channel": "email", "what": "Hi"}, {"channel": "phone", "what": "Called."}]',
          '6f1d5b8e-6565-4e1a-9c65-000000000001')) - 'touch_ids',
          '{"name": "Hana Ito", "slug": "hana-ito", "owner": "delta", "status": "contacted", "touches": 2,
            "repeat": true, "request_id": "6f1d5b8e-6565-4e1a-9c65-000000000001", "person_code": "DD-04"}'::jsonb,
          'case 7: the same request id again returns the first result, marked as a repeat');
select is(pg_temp.state(), (select s from s7), 'case 7: and writes nothing');
select is((select count(*)::integer from public.contact_notes where contact_id = pg_temp.pid('DD-04')), 2,
          'case 7: one person, two touches in all');

-- ------------------------------------------------------------------ case 8
select is(pg_temp.refused(pg_temp.log('{"name": "Hana Itoh"}',
          '[{"channel": "email", "what": "Hi"}, {"channel": "phone", "what": "Called."}]',
          '6f1d5b8e-6565-4e1a-9c65-000000000001')),
          'request id already used for something else: make a new one for a new log',
          'case 8: the same request id with a different name is refused');
select pg_temp.login('bravo@example.org');
select is(pg_temp.refused(pg_temp.log('{"name": "Hana Ito"}',
          '[{"channel": "email", "what": "Hi"}, {"channel": "phone", "what": "Called."}]',
          '6f1d5b8e-6565-4e1a-9c65-000000000001')),
          'request id already used for something else: make a new one for a new log',
          'the same request id and body from another teammate is refused too');
select pg_temp.login('delta@example.org');

-- a refused call keeps no request id: fixed and sent again with the same id, it saves
select is(pg_temp.refused(pg_temp.log('{"name": "Ivy Moss"}', '[{"channel": "sms", "what": "Hi"}]',
                                      '6f1d5b8e-6565-4e1a-9c65-000000000002')),
          'touch 1: channel ''sms'' is not allowed: use email, linkedin, phone, text, intro, in-person or other',
          'a refused call with a request id keeps nothing');
select is(pg_temp.calljson(pg_temp.log('{"name": "Ivy Moss"}', '[{"channel": "text", "what": "Hi"}]',
                                       '6f1d5b8e-6565-4e1a-9c65-000000000002')) ->> 'person_code',
          'DD-05', 'the same request id, fixed, then saves');
select is((select count(*)::integer from public.log_requests), 2, 'two request ids kept, both of calls that saved');
select is((select count(*)::integer from public.log_requests r
           where r.result::text like '%Hi%' or r.body_sha256 like '%Ivy%'), 0,
          'log_requests keeps a hash of the request, not its text');

-- ------------------------------------------------------------------ case 9
select is(pg_temp.call_as('anon', pg_temp.log('{"name": "Jo Wells"}', '[{"channel": "email", "what": "Hi"}]')),
          'ERROR: permission denied for function add_person_with_touches', 'case 9: anon is refused');
select is(pg_temp.call_as('service_role', pg_temp.log('{"name": "Jo Wells"}', '[{"channel": "email", "what": "Hi"}]')),
          'ERROR: permission denied for function add_person_with_touches', 'case 9: so is the service role');
select pg_temp.logout();
select ok(pg_temp.refused(pg_temp.log('{"name": "Jo Wells"}', '[{"channel": "email", "what": "Hi"}]')) like 'sign in first%',
          'signed out, it is refused before anything is written');

select * from finish();
rollback;
