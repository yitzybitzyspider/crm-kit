-- team hub, issue 22 (B3): the fixed write action for touches, log_touch.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner with a teammate's sign-in set on the request.
-- Everything here is rolled back at the end. The numbers in the descriptions
-- are the test cases of issue 22.
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

-- Everything a fixed action could have written, as one line of text.
create function pg_temp.state() returns text language sql as $$
    select concat_ws('|',
        (select count(*) from public.contacts), (select count(*) from public.companies),
        (select count(*) from public.contact_notes), (select count(*) from public.interviews),
        (select count(*) from public.interview_transcripts), (select count(*) from public.interview_hypotheses),
        (select count(*) from public.call_inbox), (select count(*) from public.audit_log),
        (select md5(coalesce(string_agg(concat_ws(',', person_code, status, sales_id, title, contact_key,
                                                  company_id, background, referred_by, quote_by_name), ';' order by id), ''))
         from public.contacts),
        (select md5(coalesce(string_agg(concat_ws(',', id, state, reason, interview_id, resolved_by), ';' order by id), ''))
         from public.call_inbox),
        (select md5(coalesce(string_agg(concat_ws(',', id, overview), ';' order by id), '')) from public.interviews),
        (select md5(coalesce(string_agg(concat_ws(',', interview_id, hypothesis, stance, why), ';'
                                        order by interview_id, hypothesis), '')) from public.interview_hypotheses))
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

-- A transcript of exactly 1500 characters with a line break inside a sentence.
create function pg_temp.transcript() returns text language sql immutable as $$
    select rpad('Interviewer: How long did you wait? Maria: I waited six hours in the lobby before anyone saw me. '
                || 'Then the nurse said the' || E'\n' || 'scanner was down again, and nobody told us why. ',
                1500, 'We talked about the clinic and the long days there. ')
$$;

-- The latest date it is anywhere on earth: the day after it is "tomorrow" for everyone.
create function pg_temp.today() returns date language sql as
    $$ select (now() at time zone 'Pacific/Kiritimati')::date $$;

-- --------------------------------------------------------------- teammates
insert into public.user_invitations (user_id) values
    ('00000000-0000-4000-8000-0000000000d1'), ('00000000-0000-4000-8000-0000000000d2'),
    ('00000000-0000-4000-8000-0000000000d3'), ('00000000-0000-4000-8000-0000000000d4'),
    ('00000000-0000-4000-8000-0000000000d5');
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000000d1', 'alpha@example.org'),
    ('00000000-0000-4000-8000-0000000000d2', 'bravo@example.org'),
    ('00000000-0000-4000-8000-0000000000d3', 'charlie@example.org'),
    ('00000000-0000-4000-8000-0000000000d4', 'delta@example.org'),
    ('00000000-0000-4000-8000-0000000000d5', 'later@example.org');
update public.sales set administrator = (email = 'alpha@example.org') where email like '%@hub.test';
select public.set_teammate_handle('alpha@example.org', 'alpha');
select public.set_teammate_handle('bravo@example.org', 'bravo');
select public.set_teammate_handle('charlie@example.org', 'charlie');
select public.set_teammate_handle('delta@example.org', 'delta');
update public.sales set secondary_emails = '["BB.Alt@elsewhere-org.example.org"]' where handle = 'bravo';

select pg_temp.login('charlie@example.org');
select is(pg_temp.call($$ select public.add_person('Maria Okafor', null, 'Triage nurse') ->> 'person_code' $$), 'CC-01',
          'fixture: one person, to-contact');
select is(pg_temp.call($$ select public.add_person('Alan Turing') ->> 'person_code' $$), 'CC-02',
          'fixture: a second person, to-contact');

-- ------------------------------------------------------------- 8 log_touch
select is(pg_temp.call($$ select public.log_touch('CC-01', null, null, 'email', 'Sent the intro email.', null, null, null,
                                                  'claude') - 'touch_id' $$),
          '{"by": "charlie", "status": "contacted", "person_code": "CC-01"}',
          'case 8: log_touch on a to-contact person with no status returns contacted');
select results_eq(
    $$ select n.sales_id, n.channel, n.text, n.next_step, n.next_due, n.status,
              n.date between now() - interval '1 minute' and now() + interval '1 minute'
       from public.contact_notes n where n.contact_id = pg_temp.pid('CC-01') $$,
    $$ select pg_temp.sid('charlie'), 'email', 'Sent the intro email.', null::text, null::date, 'contacted', true $$,
    'case 8: the touch is saved, by the caller, dated now');
select is((select status from public.contacts where person_code = 'CC-01'), 'contacted',
          'case 8: and the person is contacted');

select is(pg_temp.call($$ select public.set_status('CC-01', 'replied') ->> 'status' $$), 'replied',
          'case 8: the person is set to replied');
select is(pg_temp.call($$ select public.log_touch('CC-01', 'bravo', current_date - 3, 'phone', 'Called back.',
                                                  'Send the consent form', current_date + 7) ->> 'status' $$),
          'replied', 'case 8: log_touch on a replied person with no status leaves replied');
select is((select status from public.contacts where person_code = 'CC-01'), 'replied',
          'case 8: the person stays replied');
select results_eq(
    $$ select n.sales_id, n.channel, n.next_step, n.next_due, n.status, (n.date at time zone 'UTC')::date,
              to_char(n.date at time zone 'UTC', 'HH24:MI')
       from public.contact_notes n where n.text = 'Called back.' $$,
    $$ select pg_temp.sid('bravo'), 'phone', 'Send the consent form', current_date + 7, 'replied', current_date - 3,
              '12:00' $$,
    'case 8: a touch logged for a teammate, with a date, a next step and a due date, is stored as given');
select is((select count(*)::integer from public.follow_ups where person_code = 'CC-01' and next_step = 'Send the consent form'),
          1, 'case 8: the next step shows in follow_ups');

select is(pg_temp.call($$ select public.log_touch('CC-01', null, null, 'in-person', 'Agreed a time.', null, null,
                                                  'scheduled') ->> 'status' $$),
          'scheduled', 'case 8: log_touch with status scheduled returns scheduled');
select is((select status from public.contacts where person_code = 'CC-01'), 'scheduled',
          'case 8: and the person is scheduled');
select is((select count(*)::integer from public.contact_notes where contact_id = pg_temp.pid('CC-01')), 3,
          'case 8: three touches on file');
select is(pg_temp.call($$ select row(f.last_touch_date, f.last_touch_channel, f.last_touch_text)::text
                          from public.find_person('CC-01') f $$),
          format('(%s,in-person,"Agreed a time.")', current_date),
          'case 4: find_person returns the last touch: date, channel and text');
select is(pg_temp.call(format($$ select public.log_touch('CC-02', null, null, 'other', %L) ->> 'status' $$,
                              repeat('w', 10000))),
          'contacted', 'edge: a what of exactly 10,000 characters is accepted');
select is(pg_temp.call($$ select f.last_touch_text from public.find_person('CC-02') f $$), repeat('w', 80),
          'case 4: the last touch text is cut to its first 80 characters');
select is(pg_temp.call($$ select public.log_touch('CC-02', null, pg_temp.today(), 'email',
                                                  'It''s "quoted"; -- <i>x</i> ''); drop table contact_notes;') ->> 'status' $$),
          'contacted', 'edge: a touch dated today, with quotes, a semicolon and markup, is accepted');
select is((select count(*)::integer from public.contact_notes
           where text = 'It''s "quoted"; -- <i>x</i> ''); drop table contact_notes;'), 1,
          'edge: and stored as written');
select is(pg_temp.call($$ select public.log_touch('CC-02', null, null, 'email', 'No longer interested.', null, null,
                                                  'declined') ->> 'status' $$),
          'declined', 'case 8: a touch may move the person to declined');

-- --------------------------------------------------- 9 log_touch refusals
select is(pg_temp.refused(v.stmt), v.want, 'case 9: log_touch refused, ' || v.what)
from (values
    ('channel fax', $$ select public.log_touch('CC-01', null, null, 'fax', 'Hello') $$,
     'channel ''fax'' is not allowed: use email, linkedin, phone, text, intro, in-person or other'),
    ('no channel', $$ select public.log_touch('CC-01', null, null, null, 'Hello') $$,
     'the channel is empty: use email, linkedin, phone, text, intro, in-person or other'),
    ('an empty what', $$ select public.log_touch('CC-01', null, null, 'email', '') $$, 'the what is empty'),
    ('a what of only spaces and line breaks', $$ select public.log_touch('CC-01', null, null, 'email', E' \n ') $$,
     'the what is empty'),
    ('a null what', $$ select public.log_touch('CC-01', null, null, 'email', null) $$, 'the what is empty'),
    ('tomorrow''s date', $$ select public.log_touch('CC-01', null, pg_temp.today() + 1, 'email', 'Hello') $$,
     format('the date %s is in the future', pg_temp.today() + 1)),
    ('next_due with no next_step', $$ select public.log_touch('CC-01', null, null, 'email', 'Hello', null, current_date + 3) $$,
     'a due date needs a next step'),
    ('next_due with an empty next_step', $$ select public.log_touch('CC-01', null, null, 'email', 'Hello', '  ', current_date + 3) $$,
     'a due date needs a next step'),
    ('an unknown person code', $$ select public.log_touch('CC-99', null, null, 'email', 'Hello') $$,
     'no person has the code CC-99'),
    ('status interviewed', $$ select public.log_touch('CC-01', null, null, 'email', 'Hello', null, null, 'interviewed') $$,
     'interviewed is set by saving an interview, not by a touch'),
    ('a status that is not one of the seven', $$ select public.log_touch('CC-01', null, null, 'email', 'Hello', null, null, 'warm') $$,
     'status ''warm'' is not allowed: use to-contact, contacted, replied, scheduled, declined or do-not-contact'),
    ('an unknown teammate', $$ select public.log_touch('CC-01', 'bob', null, 'email', 'Hello') $$,
     'by ''bob'' is not a team handle (see team.json)'),
    ('a next step of 301 characters',
     format($$ select public.log_touch('CC-01', null, null, 'email', 'Hello', %L) $$, repeat('s', 301)),
     'the next step is too long: 301 characters, the limit is 300'),
    ('a what of 10,001 characters',
     format($$ select public.log_touch('CC-01', null, null, 'email', %L) $$, repeat('w', 10001)),
     'the what is too long: 10001 characters, the limit is 10000'),
    ('via that is neither ui nor claude',
     $$ select public.log_touch('CC-01', null, null, 'email', 'Hello', null, null, null, 'phone') $$,
     'via must be ui or claude')
) as v(what, stmt, want);
select is((select count(*)::integer from public.contact_notes), 6, 'case 9: after the refusals there are still six touches');
select is((select string_agg(status, ',' order by person_code) from public.contacts), 'scheduled,declined',
          'case 9: and both people have the status they had');

-- ------------------------------------------------ issue 63: the text channel
-- The numbers in these descriptions are the test cases of issue 63.
select is(pg_temp.call($$ select public.add_person('Caro Text') ->> 'person_code' $$), 'CC-03',
          'issue 63 fixture: a third person, to-contact');
select is(pg_temp.call($$ select public.log_touch('CC-03', null, null, 'text', 'Texted her about a time.') ->> 'status' $$),
          'contacted', 'issue 63 case 1: log_touch with channel text on a to-contact person returns contacted');
select is((select channel from public.contact_notes where text = 'Texted her about a time.'), 'text',
          'issue 63 case 1: the touch is saved with channel text');
select is((select status from public.contacts where person_code = 'CC-03'), 'contacted',
          'issue 63 case 1: and the person is contacted');
select is(pg_temp.call($$ select public.log_touch('CC-03', null, null, ' TEXT ', 'WhatsApped a reminder.') ->> 'status' $$),
          'contacted', 'issue 63 case 2: channel '' TEXT '' is accepted');
select is((select channel from public.contact_notes where text = 'WhatsApped a reminder.'), 'text',
          'issue 63 case 2: and saved as text');
select is(pg_temp.refused(v.stmt), v.want, 'issue 63 case 3: log_touch refused, ' || v.what)
from (values
    ('channel sms', $$ select public.log_touch('CC-03', null, null, 'sms', 'Hello') $$,
     'channel ''sms'' is not allowed: use email, linkedin, phone, text, intro, in-person or other'),
    ('channel imessage', $$ select public.log_touch('CC-03', null, null, 'iMessage', 'Hello') $$,
     'channel ''imessage'' is not allowed: use email, linkedin, phone, text, intro, in-person or other'),
    ('channel whatsapp', $$ select public.log_touch('CC-03', null, null, 'whatsapp', 'Hello') $$,
     'channel ''whatsapp'' is not allowed: use email, linkedin, phone, text, intro, in-person or other')
) as v(what, stmt, want);
select throws_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, channel, text)
       values (pg_temp.pid('CC-03'), pg_temp.sid('charlie'), 'carrier-pigeon', 'Sent a bird.') $$,
    '23514', null, 'issue 63 case 4: a direct insert with channel carrier-pigeon is refused by the check');
select lives_ok(
    $$ insert into public.contact_notes (contact_id, sales_id, channel, text)
       values (pg_temp.pid('CC-03'), pg_temp.sid('charlie'), 'text', 'A direct insert of a text.') $$,
    'issue 63 case 4: a direct insert with channel text is accepted by the check');
select is((select count(*)::integer from public.contact_notes where contact_id = pg_temp.pid('CC-03')), 3,
          'issue 63: three touches on file for CC-03, none from the refusals');

select * from finish();
rollback;
