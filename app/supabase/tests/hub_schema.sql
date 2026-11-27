-- team hub, issue 21 (B2): the schema of docs/SCHEMA.md, held by the database.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner. Everything here is rolled back at the end.
-- The numbers in the descriptions are the test cases of issue 21.
begin;
select no_plan();

-- ---------------------------------------------------------------- fixtures
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
-- An interview with its transcript, as the owner. Returns the interview id.
create function pg_temp.interview(person bigint, by_sales bigint, body text, reported integer)
    returns bigint language plpgsql as $$
declare v bigint;
begin
    insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                   title, overview, created_by)
    values (person, '2026-11-20', by_sales, 'paste', true, 'Interview: test', 'overview', by_sales)
    returning id into v;
    insert into public.interview_transcripts (interview_id, body, reported_chars)
    values (v, body, reported);
    return v;
end $$;

insert into public.user_invitations (user_id) values
    ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000a2'),
    ('00000000-0000-4000-8000-0000000000a3'), ('00000000-0000-4000-8000-0000000000a4');
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000a1', 'alpha@example.org'),
    ('00000000-0000-4000-8000-0000000000a2', 'bravo@example.org'),
    ('00000000-0000-4000-8000-0000000000a3', 'charlie@example.org'),
    ('00000000-0000-4000-8000-0000000000a4', 'later@example.org');
update public.sales set administrator = (email = 'alpha@example.org') where email like '%@hub.test';

-- ------------------------------------------------- 6 tables, columns, types
select has_table('public', t, 'case 6: table ' || t || ' exists')
from unnest(array['sales', 'companies', 'contacts', 'contact_notes', 'interviews',
                  'interview_transcripts', 'interview_hypotheses', 'call_inbox']) t;
select has_view('public', 'follow_ups', 'case 6: view follow_ups exists');

select col_type_is('public', v.t, v.c, v.ty, 'case 6: ' || v.t || '.' || v.c || ' is ' || v.ty)
from (values
    ('sales', 'handle', 'text'), ('sales', 'id_prefix', 'text'),
    ('contacts', 'person_code', 'text'), ('contacts', 'slug', 'text'),
    ('contacts', 'name_key', 'text'), ('contacts', 'status', 'text'),
    ('contacts', 'sales_id', 'bigint'), ('contacts', 'quote_by_name', 'boolean'),
    ('contacts', 'contact_key', 'text'), ('contacts', 'referred_by', 'text'),
    ('contacts', 'referred_by_contact_id', 'bigint'),
    ('contact_notes', 'contact_id', 'bigint'), ('contact_notes', 'date', 'timestamp with time zone'),
    ('contact_notes', 'sales_id', 'bigint'), ('contact_notes', 'channel', 'text'),
    ('contact_notes', 'text', 'text'), ('contact_notes', 'next_step', 'text'),
    ('contact_notes', 'next_due', 'date'),
    ('interviews', 'id', 'bigint'), ('interviews', 'contact_id', 'bigint'),
    ('interviews', 'date', 'date'), ('interviews', 'interviewer_id', 'bigint'),
    ('interviews', 'source', 'text'), ('interviews', 'granola_id', 'text'),
    ('interviews', 'consent_to_record', 'boolean'), ('interviews', 'title', 'text'),
    ('interviews', 'overview', 'text'), ('interviews', 'created_at', 'timestamp with time zone'),
    ('interviews', 'created_by', 'bigint'),
    ('interview_transcripts', 'interview_id', 'bigint'), ('interview_transcripts', 'body', 'text'),
    ('interview_transcripts', 'reported_chars', 'integer'),
    ('interview_transcripts', 'chars', 'integer'), ('interview_transcripts', 'sha256', 'text'),
    ('interview_hypotheses', 'interview_id', 'bigint'), ('interview_hypotheses', 'hypothesis', 'text'),
    ('interview_hypotheses', 'stance', 'text'), ('interview_hypotheses', 'why', 'text'),
    ('call_inbox', 'id', 'bigint'), ('call_inbox', 'granola_id', 'text'),
    ('call_inbox', 'source', 'text'), ('call_inbox', 'title', 'text'),
    ('call_inbox', 'recorded_on', 'date'), ('call_inbox', 'attendee_emails', 'text[]'),
    ('call_inbox', 'overview', 'text'), ('call_inbox', 'transcript', 'text'),
    ('call_inbox', 'reported_chars', 'integer'), ('call_inbox', 'consent_to_record', 'boolean'),
    ('call_inbox', 'submitted_by', 'bigint'), ('call_inbox', 'suggested_contact_ids', 'bigint[]'),
    ('call_inbox', 'state', 'text'), ('call_inbox', 'reason', 'text'),
    ('call_inbox', 'interview_id', 'bigint'), ('call_inbox', 'resolved_by', 'bigint'),
    ('call_inbox', 'resolved_at', 'timestamp with time zone')
) as v(t, c, ty);

select col_not_null('public', v.t, v.c, 'case 6: ' || v.t || '.' || v.c || ' is not null')
from (values
    ('contacts', 'person_code'), ('contacts', 'slug'), ('contacts', 'name_key'),
    ('contacts', 'status'), ('contacts', 'sales_id'), ('contacts', 'quote_by_name'),
    ('contact_notes', 'contact_id'), ('contact_notes', 'date'), ('contact_notes', 'sales_id'),
    ('contact_notes', 'channel'), ('contact_notes', 'text'),
    ('interviews', 'contact_id'), ('interviews', 'date'), ('interviews', 'interviewer_id'),
    ('interviews', 'source'), ('interviews', 'consent_to_record'), ('interviews', 'title'),
    ('interviews', 'overview'), ('interviews', 'created_at'), ('interviews', 'created_by'),
    ('interview_transcripts', 'body'),
    ('interview_hypotheses', 'interview_id'), ('interview_hypotheses', 'hypothesis'),
    ('interview_hypotheses', 'stance'),
    ('call_inbox', 'source'), ('call_inbox', 'recorded_on'), ('call_inbox', 'attendee_emails'),
    ('call_inbox', 'transcript'), ('call_inbox', 'submitted_by'), ('call_inbox', 'state')
) as v(t, c);

select col_is_null('public', v.t, v.c, 'case 6: ' || v.t || '.' || v.c || ' may be null')
from (values
    ('sales', 'handle'), ('sales', 'id_prefix'),
    ('contacts', 'contact_key'), ('contacts', 'referred_by'), ('contacts', 'referred_by_contact_id'),
    ('contact_notes', 'next_step'), ('contact_notes', 'next_due'),
    ('interviews', 'granola_id'), ('interview_transcripts', 'reported_chars'),
    ('interview_hypotheses', 'why'),
    ('call_inbox', 'granola_id'), ('call_inbox', 'title'), ('call_inbox', 'overview'),
    ('call_inbox', 'reported_chars'), ('call_inbox', 'consent_to_record'),
    ('call_inbox', 'suggested_contact_ids'), ('call_inbox', 'reason'),
    ('call_inbox', 'interview_id'), ('call_inbox', 'resolved_by'), ('call_inbox', 'resolved_at')
) as v(t, c);

select col_is_pk('public', 'interview_transcripts', 'interview_id',
                 'case 6: one transcript per interview');
select col_is_pk('public', 'interview_hypotheses', array['interview_id', 'hypothesis'],
                 'case 6: one stance per interview and hypothesis');
select col_default_is('public', 'contacts', 'status', 'to-contact',
                      'case 7: the default status is to-contact');
select col_default_is('public', 'contact_notes', 'channel', 'other',
                      'case 8: the default channel is other');
select col_default_is('public', 'call_inbox', 'state', 'waiting',
                      'case 6: a recording starts as waiting');

-- ------------------------------------------------- 15 handles and prefixes
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('Early', 'Bird', (select id from public.sales where email = 'alpha@example.org')) $$,
    'P0001', 'this teammate has no handle yet',
    'case 15: an owner with no handle cannot own a new person');

select is(public.set_teammate_handle('alpha@example.org', 'alpha'), 'AA',
          'case 15: set_teammate_handle gives alpha the prefix SK');
select is(public.set_teammate_handle('BB@example.org ', 'bravo'), 'BB',
          'case 15: the email is matched whatever its case');
select is(public.set_teammate_handle('charlie@example.org', 'charlie'), 'CC',
          'case 15: charlie gets PM');
select results_eq(
    $$ select handle, id_prefix from public.sales where email like '%@hub.test' order by email $$,
    $$ values ('bravo', 'BB'), (null, null), ('charlie', 'CC'), ('alpha', 'AA') $$,
    'case 15: handle and prefix are stored together, and are null until set');

select throws_ok($$ select public.set_teammate_handle('nobody@example.org', 'delta') $$,
    'P0001', 'no teammate has that email', 'case 15: an unknown email is refused');
select throws_ok($$ select public.set_teammate_handle('later@example.org', 'boss') $$,
    'P0001', 'unknown handle: use a handle from team.json', 'case 15: an unknown handle is refused');
select throws_ok($$ select public.set_teammate_handle('later@example.org', 'bravo') $$,
    'P0001', 'that handle is already taken', 'case 15: a taken handle is refused');
select throws_ok($$ update public.sales set handle = 'boss' where email = 'later@example.org' $$,
    '23514', null, 'case 15: the check refuses an unknown handle written directly');
update public.sales set id_prefix = 'DD' where email = 'bravo@example.org';
select is((select id_prefix from public.sales where email = 'bravo@example.org'), 'BB',
          'case 15: the prefix is set only by the database, from the handle');

-- a signed in teammate who is not an administrator
select pg_temp.login('bravo@example.org');
set local role authenticated;
select throws_ok($$ select public.set_teammate_handle('later@example.org', 'delta') $$,
    'P0001', 'only an administrator can set a handle',
    'case 15: a caller who is not an administrator is refused');
reset role;
select pg_temp.logout();

-- ------------------------------------------- 10 person codes, 11 name cases
insert into public.contacts (first_name, last_name, sales_id)
    values ('Ada', 'Lovelace', pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id, person_code, slug, name_key)
    values ('Grace', 'Hopper', pg_temp.sid('alpha'), 'DD-77', 'mine', 'mine');
insert into public.contacts (first_name, last_name, sales_id)
    values ('Alan', 'Turing', pg_temp.sid('bravo'));

select results_eq(
    $$ select person_code, slug, name_key, status from public.contacts
       where last_name in ('Lovelace', 'Hopper', 'Turing') order by person_code $$,
    $$ values ('BB-01', 'alan-turing', 'alan turing', 'to-contact'),
              ('AA-01', 'ada-lovelace', 'ada lovelace', 'to-contact'),
              ('AA-02', 'grace-hopper', 'grace hopper', 'to-contact') $$,
    'case 10: AA-01, AA-02 and BB-01, and a supplied code, slug and key are replaced by the database''s');

select throws_ok($$ update public.contacts set person_code = 'AA-09' where person_code = 'AA-01' $$,
    'P0001', 'a person code is never changed', 'case 10: an update of person_code is refused');
select throws_ok($$ update public.contacts set slug = 'countess' where person_code = 'AA-01' $$,
    'P0001', 'a slug is never changed', 'case 10: an update of slug is refused');
select throws_ok($$ update public.contacts set name_key = 'countess' where person_code = 'AA-01' $$,
    'P0001', 'a name key is never changed', 'case 10: an update of name_key is refused');
select lives_ok($$ update public.contacts set title = 'Analyst', status = null where person_code = 'AA-01' $$,
    'case 10: other fields can be updated, and a null status keeps the old one');
select is((select status from public.contacts where person_code = 'AA-01'), 'to-contact',
          'case 10: the status is unchanged after an update that sent null');

-- the teammate now owns a person: the handle is fixed
select throws_ok($$ select public.set_teammate_handle('alpha@example.org', 'delta') $$,
    'P0001', 'a handle cannot change once the teammate owns a person',
    'case 15: a handle cannot change once the teammate owns a person');
select throws_ok($$ update public.sales set handle = 'delta' where email = 'alpha@example.org' $$,
    'P0001', 'a handle cannot change once the teammate owns a person',
    'case 15: the same holds for a direct update of sales');

-- an administrator, signed in, can set a handle
select pg_temp.login('alpha@example.org');
set local role authenticated;
select is(public.set_teammate_handle('later@example.org', 'delta'), 'DD',
          'case 15: a signed in administrator sets a handle');
reset role;
select pg_temp.logout();

insert into public.contacts (first_name, last_name, sales_id)
    values ('Dr. Renée', 'Álvarez, MD', pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id)
    values ('木口', null, pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id)
    values ('Anne', 'O''Neil', pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id)
    values (repeat('a', 150), repeat('b', 149), pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id)
    values (repeat('a', 150), repeat('c', 149), pg_temp.sid('alpha'));

select results_eq(
    $$ select person_code, name_key, slug from public.contacts
       where person_code in ('AA-03', 'AA-04', 'AA-05') order by person_code $$,
    $$ values ('AA-03', 'renee alvarez', 'renee-alvarez'),
              ('AA-04', '木口', 'person-aa-04'),
              ('AA-05', 'anne oneil', 'anne-oneil') $$,
    'case 11: accents, titles and apostrophes fold away; a name in another script keeps itself and gets a code slug');
select is((select slug from public.contacts where person_code = 'AA-06'), repeat('a', 80),
          'case 11: a 300 character name is accepted and its slug is cut to 80');
select is((select slug from public.contacts where person_code = 'AA-07'), repeat('a', 80) || '-2',
          'case 11: a second long name sharing the first 80 characters gets -2');
select is((select char_length(first_name || ' ' || last_name) from public.contacts where person_code = 'AA-06'),
          300, 'case 11: the long name is stored whole');

select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('renee', 'alvarez', pg_temp.sid('bravo')) $$,
    'P0001', 'this person is already on file as AA-03',
    'case 11 and 12: the same name without accent or title is refused, naming the person on file');
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('Anne', 'ONeil', pg_temp.sid('bravo')) $$,
    'P0001', 'this person is already on file as AA-05',
    'case 11: the same name without its apostrophe is refused');
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('Dr.', null, pg_temp.sid('bravo')) $$,
    'P0001', 'a person needs a name', 'case 11: a name that is only a title is refused');
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('', '', pg_temp.sid('bravo')) $$,
    'P0001', 'a person needs a name', 'case 11: an empty name is refused');
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id)
       values ('   ', '  ', pg_temp.sid('bravo')) $$,
    'P0001', 'a person needs a name', 'case 11: a name of only spaces is refused');

select is(public.hub_name_key('Dr. Renée Álvarez, MD'), 'renee alvarez', 'case 11: hub_name_key folds a full example');
select is(public.hub_name_key('  Ph.D. Mary-Jane   O’Brien RN '), 'mary jane obrien',
          'case 11: hub_name_key drops credentials with periods, hyphens to spaces, curly apostrophes');
select is(public.hub_name_key('Dr.'), '', 'case 11: hub_name_key of a title alone is empty');
select is(public.hub_name_key(' 木口 '), '木口', 'case 11: hub_name_key keeps a name in another script, trimmed');

-- 99 to 100
insert into public.contacts (first_name, last_name, sales_id)
    select 'Bulk', 'Person n' || g, pg_temp.sid('bravo') from generate_series(2, 99) g;
select is((select max(person_code) from public.contacts where person_code like 'BB-__'), 'BB-99',
          'case 10: the 99th person of a prefix is BB-99');
insert into public.contacts (first_name, last_name, sales_id)
    values ('Hundredth', 'Person', pg_temp.sid('bravo'));
select is((select person_code from public.contacts where first_name = 'Hundredth'), 'BB-100',
          'case 10: the 100th is BB-100');
select is((select count(distinct person_code)::integer from public.contacts where person_code like 'BB-%'),
          100, 'case 10: one hundred distinct codes, no number shared');

-- ------------------------------------------------ 12, 13 contact details
insert into public.contacts (first_name, last_name, sales_id, contact_key)
    values ('Email', 'Given', pg_temp.sid('charlie'), '  Jane@Example-COM.example.org ');
insert into public.contacts (first_name, last_name, sales_id, contact_key)
    values ('Linkedin', 'Given', pg_temp.sid('charlie'), 'https://www.LinkedIn.com/in/Given');
insert into public.contacts (first_name, last_name, sales_id, contact_key)
    values ('Phone', 'Given', pg_temp.sid('charlie'), '+1 (415) 555-0100');
insert into public.contacts (first_name, last_name, sales_id, contact_key)
    values ('Other', 'Given', pg_temp.sid('charlie'), 'Ask at the front desk');
insert into public.contacts (first_name, last_name, sales_id, email_jsonb)
    values ('From', 'Theapp', pg_temp.sid('charlie'), '[{"email": "App@Example-com.example.org", "type": "Work"}]');

select results_eq(
    $$ select first_name, contact_key, email_jsonb::text, linkedin_url, phone_jsonb::text
       from public.contacts where sales_id = pg_temp.sid('charlie') order by person_code $$,
    $$ values
       ('Email', 'jane@example-com.example.org', '[{"type": "Work", "email": "jane@example-com.example.org"}]', null, null),
       ('Linkedin', 'https://www.linkedin.com/in/given', null, 'https://www.LinkedIn.com/in/Given', null),
       ('Phone', '+1 (415) 555-0100', null, null, '[{"type": "Work", "number": "+1 (415) 555-0100"}]'),
       ('Other', 'ask at the front desk', null, null, null),
       ('From', 'app@example-com.example.org', '[{"type": "Work", "email": "app@example-com.example.org"}]', null, null) $$,
    'case 13: an email, a LinkedIn address and a phone number are filed under their kind; anything else stays in contact_key only');

select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id, contact_key)
       values ('Second', 'Jane', pg_temp.sid('bravo'), 'JANE@example-com.example.org') $$,
    'P0001', 'this contact detail is already on file for CC-01',
    'case 12: the same contact detail in another case is refused, naming the person on file');
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id, email_jsonb)
       values ('Third', 'Jane', pg_temp.sid('bravo'), '[{"email": " jane@example-com.example.org", "type": "Home"}]') $$,
    'P0001', 'this contact detail is already on file for CC-01',
    'case 12: the same holds when the detail comes as the app sends it, with spaces around');
select throws_ok(
    $$ update public.contacts set contact_key = 'Jane@example-com.example.org' where person_code = 'CC-04' $$,
    'P0001', 'this contact detail is already on file for CC-01',
    'case 12: a contact key cannot be changed to one already on file');

-- ------------------------------------------------------------ 7 statuses
select lives_ok(format($$ update public.contacts set status = %L where person_code = 'AA-02' $$, s),
                'case 7: the status ' || s || ' is accepted')
from unnest(array['to-contact', 'declined', 'do-not-contact']) s;
select throws_ok($$ update public.contacts set status = 'cold' where person_code = 'AA-02' $$,
    '23514', null, 'case 7: the status cold is refused');
select throws_ok($$ update public.contacts set status = 7 where person_code = 'AA-02' $$,
    '23514', null, 'case 7: a number as status is refused');

-- --------------------------------------------- 14 statuses that need proof
select throws_ok(format($$ update public.contacts set status = %L where person_code = 'AA-02' $$, s),
                 'P0001', 'the status ' || s || ' needs at least one touch on file',
                 'case 14: ' || s || ' is refused with no touch')
from unnest(array['contacted', 'replied', 'scheduled']) s;
select throws_ok(
    $$ insert into public.contacts (first_name, last_name, sales_id, status)
       values ('Too', 'Soon', pg_temp.sid('bravo'), 'contacted') $$,
    'P0001', 'the status contacted needs at least one touch on file',
    'case 14: a new person cannot start as contacted');
select throws_ok($$ update public.contacts set status = 'interviewed' where person_code = 'AA-02' $$,
    'P0001', 'the status interviewed needs an interview on file',
    'case 14: interviewed is refused with no interview');

-- ------------------------------------------------- 8, 9 touches
insert into public.contact_notes (contact_id, sales_id, text)
    values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'Sent a first email.');
select is((select channel from public.contact_notes where contact_id = pg_temp.pid('AA-02')), 'other',
          'case 8: a touch with no channel given is other');
select lives_ok(format($$ update public.contact_notes set channel = %L where contact_id = pg_temp.pid('AA-02') $$, c),
                'case 8: the channel ' || c || ' is accepted')
from unnest(array['email', 'linkedin', 'phone', 'text', 'intro', 'in-person', 'other']) c;
select throws_ok($$ update public.contact_notes set channel = 'fax' where contact_id = pg_temp.pid('AA-02') $$,
    '23514', null, 'case 8: the channel fax is refused');

select lives_ok(format($$ update public.contacts set status = %L where person_code = 'AA-02' $$, s),
                'case 14: ' || s || ' is accepted once there is a touch')
from unnest(array['contacted', 'replied', 'scheduled']) s;

select lives_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, text, date)
       values (pg_temp.pid('AA-01'), pg_temp.sid('alpha'), 'Date sent as null.', null) $$,
    'case 6: a touch whose date is sent as null is accepted, as upstream''s clients send it');
select ok((select date is not null and date <= now() from public.contact_notes where text = 'Date sent as null.'),
          'case 6: and its date is the moment it was added');
select throws_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, text, next_due)
       values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'No step.', '2026-12-01') $$,
    '23514', null, 'case 9: next_due without next_step is refused');
select throws_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, text, next_step, next_due)
       values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'Blank step.', '   ', '2026-12-01') $$,
    '23514', null, 'case 9: next_due with a blank next_step is refused');
select lives_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, text, date, channel, next_step, next_due)
       values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'Asked for a call.', '2026-11-10 10:00+00',
               'email', 'Send times', '2026-12-01') $$,
    'case 9: next_due with a next_step is accepted');
insert into public.contact_notes (contact_id, sales_id, text, date, channel, next_step)
    values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'Older step.', '2026-11-01 10:00+00', 'phone', 'Old step');
insert into public.contact_notes (contact_id, sales_id, text, date)
    values (pg_temp.pid('AA-02'), pg_temp.sid('alpha'), 'Newest, no step.', '2026-11-15 10:00+00');
select results_eq(
    $$ select person_code, next_step, next_due, channel from public.follow_ups $$,
    $$ values ('AA-02', 'Send times', '2026-12-01'::date, 'email') $$,
    'case 9: follow_ups gives, per person, the newest touch that has a next step');

-- ------------------------------------------- 16, 17 interviews, transcripts
select throws_ok(
    $$ do $do$
       begin
           insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                          title, overview, created_by)
           values (pg_temp.pid('AA-02'), '2026-11-20', pg_temp.sid('alpha'), 'paste', true,
                   'Interview: no transcript', 'overview', pg_temp.sid('alpha'));
           set constraints all immediate;
       end $do$ $$,
    'P0001', 'an interview is saved with its transcript, or not at all',
    'case 16: an interview with no transcript row is refused when the deferred check runs, as at commit');
select throws_ok(
    $$ select pg_temp.interview(pg_temp.pid('AA-02'), pg_temp.sid('alpha'), repeat('a', 999), null) $$,
    '23514', null, 'case 16: a transcript of 999 characters is refused');
select throws_ok(
    $$ select pg_temp.interview(pg_temp.pid('AA-02'), pg_temp.sid('alpha'), repeat('a', 1000), 1001) $$,
    '23514', null, 'case 16: a transcript shorter than its reported size is refused');
select throws_ok(
    $$ insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                      title, overview, created_by)
       values (pg_temp.pid('AA-02'), '2026-11-20', pg_temp.sid('alpha'), 'paste', false,
               'Interview: no consent', 'overview', pg_temp.sid('alpha')) $$,
    '23514', null, 'case 16: consent_to_record false is refused');
select throws_ok(
    $$ insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                      title, overview, created_by)
       values (pg_temp.pid('AA-02'), '2026-11-20', pg_temp.sid('alpha'), 'fax', true,
               'Interview: odd source', 'overview', pg_temp.sid('alpha')) $$,
    '23514', null, 'case 16: a source outside granola, paste and other is refused');

select lives_ok(
    $$ select pg_temp.interview(pg_temp.pid('AA-02'), pg_temp.sid('alpha'), repeat('a', 1000), 1000) $$,
    'case 16: a transcript of 1000 characters, as long as reported, is accepted');
select lives_ok($$ set constraints all immediate $$,
    'case 16: the deferred check passes for an interview that has its transcript');
set constraints all deferred;

select results_eq(
    $$ select chars, sha256 from public.interview_transcripts $$,
    $$ values (1000, '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3') $$,
    'case 17: chars and sha256 match the body');
select is((select sha256 from public.interview_transcripts),
          (select encode(extensions.digest(body, 'sha256'), 'hex') from public.interview_transcripts),
          'case 17: sha256 agrees with pgcrypto');
select throws_ok(
    $$ do $do$
       declare v bigint;
       begin
           insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                          title, overview, created_by)
           values (pg_temp.pid('AA-02'), '2026-11-21', pg_temp.sid('alpha'), 'paste', true,
                   'Interview: written chars', 'overview', pg_temp.sid('alpha'))
           returning id into v;
           insert into public.interview_transcripts (interview_id, body, chars)
           values (v, repeat('b', 1200), 5);
       end $do$ $$,
    '428C9', null, 'case 17: chars cannot be written by a caller');
select throws_ok(
    $$ do $do$
       declare v bigint;
       begin
           insert into public.interviews (contact_id, date, interviewer_id, source, consent_to_record,
                                          title, overview, created_by)
           values (pg_temp.pid('AA-02'), '2026-11-21', pg_temp.sid('alpha'), 'paste', true,
                   'Interview: written sha', 'overview', pg_temp.sid('alpha'))
           returning id into v;
           insert into public.interview_transcripts (interview_id, body, sha256)
           values (v, repeat('b', 1200), 'abc');
       end $do$ $$,
    '428C9', null, 'case 17: sha256 cannot be written by a caller');

select lives_ok($$ update public.contacts set status = 'interviewed' where person_code = 'AA-02' $$,
    'case 14: interviewed is accepted once there is an interview');
select lives_ok(format($$ update public.contacts set status = %L where person_code = 'AA-02' $$, s),
                'case 7: the status ' || s || ' is accepted')
from unnest(array['contacted', 'replied', 'scheduled', 'interviewed']) s;

-- hypothesis links and the inbox
select lives_ok(
    $$ insert into public.interview_hypotheses (interview_id, hypothesis, stance, why)
       select id, 'H2', 'supports', 'said so' from public.interviews $$,
    'case 6: a hypothesis link is accepted');
select throws_ok(
    $$ insert into public.interview_hypotheses (interview_id, hypothesis, stance)
       select id, 'two', 'supports' from public.interviews $$,
    '23514', null, 'case 6: a hypothesis that is not H and a number is refused');
select throws_ok(
    $$ insert into public.interview_hypotheses (interview_id, hypothesis, stance)
       select id, 'H3', 'maybe' from public.interviews $$,
    '23514', null, 'case 6: a stance outside supports, contradicts and unclear is refused');
select lives_ok(
    $$ insert into public.call_inbox (source, recorded_on, attendee_emails, transcript, submitted_by)
       values ('granola', '2026-11-20', array['a@example-com.example.org'], 'words', pg_temp.sid('alpha')) $$,
    'case 6: a recording with consent not yet asked goes in the inbox');
select throws_ok(
    $$ insert into public.call_inbox (source, recorded_on, attendee_emails, transcript, submitted_by, state)
       values ('granola', '2026-11-20', array['a@example-com.example.org'], 'words', pg_temp.sid('alpha'), 'lost') $$,
    '23514', null, 'case 6: an inbox state outside waiting, confirmed and dismissed is refused');

select * from finish();
rollback;
