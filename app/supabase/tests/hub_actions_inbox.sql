-- team hub, issue 22 (B3): the fixed write actions for recordings and the inbox:
-- submit_recording, inbox_suggestions, confirm_recording, dismiss_recording.
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
    ('00000000-0000-4000-8000-0000000000d1', 'alpha@hub.test'),
    ('00000000-0000-4000-8000-0000000000d2', 'bravo@hub.test'),
    ('00000000-0000-4000-8000-0000000000d3', 'charlie@hub.test'),
    ('00000000-0000-4000-8000-0000000000d4', 'delta@hub.test'),
    ('00000000-0000-4000-8000-0000000000d5', 'later@hub.test');
update public.sales set administrator = (email = 'alpha@hub.test') where email like '%@hub.test';
select public.set_teammate_handle('alpha@hub.test', 'alpha');
select public.set_teammate_handle('bravo@hub.test', 'bravo');
select public.set_teammate_handle('charlie@hub.test', 'charlie');
select public.set_teammate_handle('delta@hub.test', 'delta');
update public.sales set secondary_emails = '["Bravo.Alt@elsewhere-org.example.org"]' where handle = 'bravo';

-- The text of one submit_recording call. Arguments ending in _sql are SQL, the rest are values.
create function pg_temp.submit_sql(
        gid text, attendees_sql text, consent_sql text default 'true', overview text default 'An overview.',
        body_sql text default 'pg_temp.transcript()', title text default 'Weekly call', hyp text default null,
        source text default 'granola', reported_sql text default '1500', day_sql text default 'current_date - 1',
        via text default 'claude')
    returns text language sql as $$
    select format('select public.submit_recording(%L, %L, %L, %s, %s, %L, %s, %s, %L::jsonb, %s, %L)',
                  gid, source, title, day_sql, attendees_sql, overview, body_sql, consent_sql, hyp, reported_sql, via)
$$;
-- The person codes an inbox item suggests, in order.
create function pg_temp.suggested(inbox bigint) returns text language sql as $$
    select coalesce(string_agg(c.person_code, ',' order by u.o), '')
    from public.call_inbox b, unnest(b.suggested_contact_ids) with ordinality as u(id, o)
        join public.contacts c on c.id = u.id
    where b.id = inbox
$$;
create function pg_temp.people_and_interviews() returns text language sql as
    $$ select (select count(*) from public.contacts) || ' people, ' || (select count(*) from public.interviews) || ' interviews' $$;

select pg_temp.login('charlie@hub.test');
select is(pg_temp.call($$ select public.add_person('Maria Okafor', null, 'Triage nurse', 'Example Clinic', 'maria@example-com.example.org') ->> 'person_code' $$),
          'CC-01', 'fixture: Maria, with an address');
select is(pg_temp.call($$ select public.add_person('Alan Turing', 'bravo', null, null, 'alan@bletchley-example.example.org') ->> 'person_code' $$),
          'BB-01', 'fixture: Alan, with an address');
select is(pg_temp.call($$ select public.add_person('Grace Hopper', null, null, null, '+1 555 0100') ->> 'person_code' $$),
          'CC-02', 'fixture: Grace, with a phone number and no address');

-- ------------------------------------------- 13 submit_recording, saved
create temp table first_submit as
select pg_temp.calljson(pg_temp.submit_sql('rec-1', $$array['charlie@hub.test', '  MARIA@Example-com.example.org ', 'bravo.alt@ELSEWHERE-org.example.org']$$,
    overview => 'She said "I waited six hours in the lobby" twice.',
    hyp => '[{"hypothesis": "H1", "stance": "supports", "why": "the wait"}]')) as r;
select is((select r ->> 'result' from first_submit), 'saved',
          'case 13: one attendee on file and consent true: submit_recording returns saved (address in capitals, spaces around it, teammates left out)');
select is((select r ->> 'person_code' from first_submit), 'CC-01', 'case 13: with the person code');
select results_eq(
    $$ select i.id, i.contact_id, i.interviewer_id, i.created_by, i.source, i.granola_id, i.date, i.title, t.chars,
              t.reported_chars, t.sha256
       from public.interviews i join public.interview_transcripts t on t.interview_id = i.id $$,
    $$ select (r ->> 'interview_id')::bigint, pg_temp.pid('CC-01'), pg_temp.sid('charlie'), pg_temp.sid('charlie'),
              'granola', 'rec-1', current_date - 1, 'Weekly call', 1500, 1500, public.hub_sha256(pg_temp.transcript())
       from first_submit $$,
    'case 13: an interview exists for that person, with the caller as interviewer and the transcript whole');
select is((select count(*)::integer from public.call_inbox), 0, 'case 13: nothing is in call_inbox');
select is((select status from public.contacts where person_code = 'CC-01'), 'interviewed', 'case 13: the person is interviewed');
select is((select string_agg(hypothesis || ' ' || stance, ',') from public.interview_hypotheses), 'H1 supports',
          'case 13: the hypothesis link is saved');

-- ---------------------------------------- 14 submit_recording, to the inbox
create temp table inbox_cases (n integer, what text, stmt text, reason text, r jsonb, before text, after text);
insert into inbox_cases (n, what, stmt, reason) values
    (1, 'no person matches', pg_temp.submit_sql('rec-10', $$array['stranger@nowhere-example.example.org']$$), 'no person matches an attendee'),
    (2, 'two people match', pg_temp.submit_sql('rec-11', $$array['maria@example-com.example.org', 'ALAN@bletchley-example.example.org', 'alpha@hub.test']$$),
     '2 people match an attendee'),
    (3, 'consent null', pg_temp.submit_sql('rec-12', $$array['alan@bletchley-example.example.org']$$, consent_sql => 'null'), 'consent not confirmed'),
    (4, 'consent false', pg_temp.submit_sql('rec-13', $$array['alan@bletchley-example.example.org']$$, consent_sql => 'false'), 'consent not confirmed'),
    (5, 'only teammates attended', pg_temp.submit_sql('rec-14', $$array['charlie@hub.test', 'BRAVO@hub.test', 'bravo.alt@elsewhere-org.example.org']$$),
     'no attendee outside the team'),
    (6, 'an empty attendee list', pg_temp.submit_sql('rec-15', $$array[]::text[]$$), 'no attendee outside the team'),
    (7, 'no attendee list', pg_temp.submit_sql('rec-16', 'null'), 'no attendee outside the team'),
    (8, 'an attendee list of empty entries', pg_temp.submit_sql('rec-17', $$array['', '  ', null]$$), 'no attendee outside the team'),
    (9, 'no recorder id, pasted', pg_temp.submit_sql(null, $$array['stranger@nowhere-example.example.org']$$, source => 'paste', reported_sql => 'null'),
     'no person matches an attendee');
do $$
declare
    c record;
begin
    for c in select * from inbox_cases order by n loop
        update inbox_cases set before = pg_temp.people_and_interviews() where n = c.n;
        update inbox_cases set r = pg_temp.calljson(c.stmt) where n = c.n;
        update inbox_cases set after = pg_temp.people_and_interviews() where n = c.n;
    end loop;
end $$;
select is(c.r ->> 'result', 'inbox', 'case 14: ' || c.what || ': the recording goes to the inbox') from inbox_cases c order by n;
select is(c.r ->> 'reason', c.reason, 'case 14: ' || c.what || ': the reason is "' || c.reason || '"') from inbox_cases c order by n;
select is((select b.reason || ' / ' || b.state from public.call_inbox b where b.id = (c.r ->> 'inbox_id')::bigint),
          c.reason || ' / waiting', 'case 14: ' || c.what || ': the inbox row is waiting, with the reason')
from inbox_cases c order by n;
select is(c.after, c.before, 'case 14: ' || c.what || ': no interview and no new person (' || c.before || ')')
from inbox_cases c order by n;
select is((select count(*)::integer from public.call_inbox), 9, 'case 14: nine recordings are waiting');
select results_eq(
    $$ select b.granola_id, b.source, b.title, b.recorded_on, b.attendee_emails, b.overview, b.reported_chars,
              b.consent_to_record, b.submitted_by, b.transcript = pg_temp.transcript(), b.interview_id, b.resolved_by
       from public.call_inbox b where b.granola_id = 'rec-11' $$,
    $$ select 'rec-11', 'granola', 'Weekly call', current_date - 1,
              array['maria@example-com.example.org', 'alan@bletchley-example.example.org', 'alpha@hub.test'], 'An overview.', 1500, true,
              pg_temp.sid('charlie'), true, null::bigint, null::bigint $$,
    'case 14: the inbox row holds what was submitted, the transcript word for word, the addresses trimmed and in small letters');
select is((select consent_to_record::text from public.call_inbox where granola_id = 'rec-12'), null,
          'case 14: consent not asked yet is stored as null');
select is((select consent_to_record from public.call_inbox where granola_id = 'rec-13'), false,
          'case 14: consent refused is stored as false');

-- ------------------------------ 15 a cut short transcript, and the same recording twice
select is(pg_temp.refused(v.stmt), v.want, 'case 15: submit_recording refused, ' || v.what)
from (values
    ('a cut short transcript on the way to an interview',
     pg_temp.submit_sql('rec-20', $$array['alan@bletchley-example.example.org']$$, reported_sql => '1501'),
     'the transcript is cut short: 1500 of 1501 characters'),
    ('a cut short transcript on the way to the inbox',
     pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, reported_sql => '20000'),
     'the transcript is cut short: 1500 of 20000 characters'),
    ('a transcript of 999 characters on the way to the inbox',
     pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, body_sql => 'left(pg_temp.transcript(), 999)', reported_sql => '999'),
     'the transcript is too short: 999 characters, an interview needs at least 1000'),
    ('granola with no reported size', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, reported_sql => 'null'),
     'a granola recording needs reported_chars, the size the recorder reported'),
    ('the same granola_id as a saved interview', pg_temp.submit_sql('rec-1', $$array['maria@example-com.example.org']$$),
     format('this recording is already saved as interview %s for CC-01', (select r ->> 'interview_id' from first_submit))),
    ('the same granola_id as a waiting recording', pg_temp.submit_sql('rec-10', $$array['stranger@nowhere-example.example.org']$$),
     format('this recording is already in the inbox as item %s (waiting)', (select id from public.call_inbox where granola_id = 'rec-10'))),
    ('a bad quote on the way to the inbox',
     pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, overview => 'She said "we never had any trouble" once.'),
     'this quote in the overview is not word for word in the transcript: "we never had any trouble"'),
    ('a lone quotation mark on the way to the inbox',
     pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, overview => 'She is 5'' 10" tall.'),
     'the overview has an odd number of double quotation marks, so its quotes cannot be told apart: close the open one, or write a lone mark another way'),
    ('a bad hypothesis on the way to the inbox',
     pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, hyp => '[{"hypothesis": "H1", "stance": "maybe"}]'),
     'stance ''maybe'' is not allowed: use supports, contradicts or unclear'),
    ('no overview', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, overview => null), 'the overview is empty'),
    ('no title', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, title => null), 'the title is empty'),
    ('no date', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, day_sql => 'null'), 'the recorded_on date is empty'),
    ('a date in the future', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, day_sql => 'pg_temp.today() + 1'),
     format('the recorded_on date %s is in the future', pg_temp.today() + 1)),
    ('an unknown source', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, source => 'zoom'),
     'source ''zoom'' is not allowed: use granola, paste or other'),
    ('an address with a space inside it', pg_temp.submit_sql('rec-20', $$array['two words@nowhere-example.example.org']$$),
     'an attendee address is longer than 300 characters or has a space inside it'),
    ('via that is neither ui nor claude', pg_temp.submit_sql('rec-20', $$array['stranger@nowhere-example.example.org']$$, via => 'sync'),
     'via must be ui or claude')
) as v(what, stmt, want);
select is((select count(*)::integer from public.interviews) + (select count(*)::integer from public.call_inbox)
          + (select count(*)::integer from public.call_inbox where granola_id = 'rec-20') * 100
          + (select count(*)::integer from public.interviews where granola_id = 'rec-20') * 100,
          10, 'case 15: the refused recording is in neither table: still one interview and nine waiting');

-- ------------------------------------------------------------ 16 suggestions
select is(pg_temp.call($$ select public.add_person('Devi Rao', null, null, 'Big Clinic', 'devi@bigclinic-example.example.org') ->> 'person_code' $$),
          'CC-03', 'fixture: Devi, whose address the attendee has');
select is(pg_temp.call($$ select public.add_person('Omar Haddad', null, null, 'Big Clinic', 'omar@bigclinic-example.example.org') ->> 'person_code' $$),
          'CC-04', 'fixture: Omar, on the same domain');
select is(pg_temp.call($$ select public.add_person('Lena Fischer', 'bravo', null, null, 'lena.fischer@gmail.com') ->> 'person_code' $$),
          'BB-02', 'fixture: Lena, named in the title, on a public mail domain');
create temp table s1 as
select pg_temp.calljson(pg_temp.submit_sql('rec-30', $$array['devi@bigclinic-example.example.org', 'charlie@hub.test']$$, consent_sql => 'null',
                                       title => 'Intro: Dr. Lena FISCHER and Devi')) as r;
select is((select r ->> 'reason' from s1), 'consent not confirmed', 'case 16: one match and no consent yet: inbox');
select is(pg_temp.suggested((select (r ->> 'inbox_id')::bigint from s1)), 'CC-03,CC-04,BB-02',
          'case 16: the person with the attendee''s address comes first, the one on the same domain second, the one named in the title third');
select is(pg_temp.call(format($$ select string_agg(person_code || ' ' || matched, ', ') from public.inbox_suggestions(%s) $$,
                              (select r ->> 'inbox_id' from s1))),
          'CC-03 email, CC-04 domain, BB-02 name', 'case 16: inbox_suggestions gives the same list, with the group that matched');

create temp table s2 as
select pg_temp.calljson(pg_temp.submit_sql('rec-31', $$array['someone.else@gmail.com']$$, title => 'Catch up')) as r;
select is((select r ->> 'reason' from s2), 'no person matches an attendee', 'case 16: a gmail.com attendee nobody has on file: inbox');
select is(pg_temp.suggested((select (r ->> 'inbox_id')::bigint from s2)), '',
          'case 16: a gmail.com attendee suggests nobody by domain');
select is((select suggested_contact_ids from public.call_inbox where granola_id = 'rec-31'), '{}'::bigint[],
          'case 16: with nobody to suggest the list is empty, not null');

select is(pg_temp.call($$ select public.add_person('Priya Nair', null, null, 'Big Clinic', 'priya@bigclinic-example.example.org') ->> 'person_code' $$),
          'CC-05', 'fixture: a fourth candidate, on the same domain');
create temp table s3 as
select pg_temp.calljson(pg_temp.submit_sql('rec-32', $$array['devi@bigclinic-example.example.org', 'omar@bigclinic-example.example.org']$$,
                                       title => 'Lena Fischer, Devi and Omar')) as r;
select is((select r ->> 'reason' from s3), '2 people match an attendee', 'case 16: two attendees on file: inbox');
select is(pg_temp.suggested((select (r ->> 'inbox_id')::bigint from s3)), 'CC-03,CC-04,CC-05',
          'case 16: four candidates give three: the two by address in code order, then the one by domain; the one by name is left out');

select is(pg_temp.call(format($$ select string_agg(person_code || ' ' || matched, ', ') from public.inbox_suggestions(%s) $$,
                              (select r ->> 'inbox_id' from s2))),
          '(null)', 'case 16: inbox_suggestions for the gmail.com recording is empty for now');
select is(pg_temp.call($$ select public.add_person('Sam Else', null, null, null, 'Someone.Else@gmail.com') ->> 'person_code' $$),
          'CC-06', 'fixture: a person added after that recording arrived');
select is(pg_temp.call(format($$ select string_agg(person_code || ' ' || matched || ' ' || name || ' ' || owner || ' ' || status, ', ')
                                 from public.inbox_suggestions(%s) $$, (select r ->> 'inbox_id' from s2))),
          'CC-06 email Sam Else charlie to-contact', 'case 16: inbox_suggestions includes a person added after the submit');
select is(pg_temp.suggested((select (r ->> 'inbox_id')::bigint from s2)), '',
          'case 16: while the list stored at submit is as it was');
select is(pg_temp.refused($$ select count(*) from public.inbox_suggestions(999999) $$), 'no inbox item has the id 999999',
          'case 16: inbox_suggestions refuses an unknown item');

-- ------------------------------------------------------ 17 confirm_recording
create temp table item as
select b.id, public.hub_sha256(b.transcript) as sha256
from public.call_inbox b where b.granola_id = 'rec-12';
select is(pg_temp.refused(v.stmt), v.want, 'case 17: confirm_recording refused, ' || v.what)
from (values
    ('consent false', format($$ select public.confirm_recording(%s, 'BB-01', false) $$, (select id from item)),
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('consent null', format($$ select public.confirm_recording(%s, 'BB-01', null) $$, (select id from item)),
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('consent left out', format($$ select public.confirm_recording(%s, 'BB-01') $$, (select id from item)),
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('an unknown person', format($$ select public.confirm_recording(%s, 'BB-99', true) $$, (select id from item)),
     'no person has the code BB-99'),
    ('an unknown item', $$ select public.confirm_recording(999999, 'BB-01', true) $$, 'no inbox item has the id 999999'),
    ('via that is neither ui nor claude', format($$ select public.confirm_recording(%s, 'BB-01', true, 'x') $$, (select id from item)),
     'via must be ui or claude')
) as v(what, stmt, want);

select pg_temp.login('bravo@hub.test');
create temp table confirmed as
select pg_temp.calljson(format($$ select public.confirm_recording(%s, 'bb-01', true, 'ui') $$, (select id from item))) as r;
select is((select r ->> 'person_code' from confirmed), 'BB-01', 'case 17: confirm_recording with consent true is accepted');
select results_eq(
    $$ select i.contact_id, i.interviewer_id, i.created_by, i.source, i.granola_id, i.date, i.title, i.overview,
              t.sha256, t.chars, t.reported_chars
       from public.interviews i join public.interview_transcripts t on t.interview_id = i.id
       where i.id = (select (r ->> 'interview_id')::bigint from confirmed) $$,
    $$ select pg_temp.pid('BB-01'), pg_temp.sid('bravo'), pg_temp.sid('bravo'), 'granola', 'rec-12', current_date - 1,
              'Weekly call', 'An overview.', (select sha256 from item), 1500, 1500 $$,
    'case 17: the interview is created with the inbox transcript byte for byte (same sha256)');
select results_eq(
    $$ select b.state, b.resolved_by, b.interview_id, b.consent_to_record, b.resolved_at is not null,
              public.hub_sha256(b.transcript), b.reason
       from public.call_inbox b where b.id = (select id from item) $$,
    $$ select 'confirmed', pg_temp.sid('bravo'), (select (r ->> 'interview_id')::bigint from confirmed), true, true,
              (select sha256 from item), 'consent not confirmed' $$,
    'case 17: the inbox row stays, confirmed, with who resolved it, the interview and its transcript');
select is((select status from public.contacts where person_code = 'BB-01'), 'interviewed', 'case 17: the person is interviewed');

select pg_temp.login('charlie@hub.test');
select is(pg_temp.refused(format($$ select public.confirm_recording(%s, 'CC-02', true) $$, (select id from item))),
          format('already confirmed by bravo as interview %s', (select r ->> 'interview_id' from confirmed)),
          'case 17: a confirmed item is refused, naming who confirmed it');
select is(pg_temp.refused(format($$ select public.dismiss_recording(%s, 'changed my mind') $$, (select id from item))),
          'only a waiting recording can be dismissed: this one was confirmed by bravo',
          'case 18: a confirmed item cannot be dismissed');

-- hypothesis links submitted with a recording that waited are saved at confirm
create temp table s4 as
select pg_temp.calljson(pg_temp.submit_sql('rec-40', $$array['stranger@nowhere-example.example.org']$$,
    overview => 'She said "nobody told us why" in the end.',
    hyp => '[{"hypothesis": "H4", "stance": "contradicts", "why": "nobody explained"}]')) as r;
select is(pg_temp.call(format($$ select public.confirm_recording(%s, 'CC-02', true) ->> 'person_code' $$,
                              (select r ->> 'inbox_id' from s4))),
          'CC-02', 'case 17: a recording nobody matched is confirmed for the person chosen');
select is((select h.hypothesis || ' ' || h.stance || ' ' || h.why
           from public.interview_hypotheses h join public.interviews i on i.id = h.interview_id
           where i.granola_id = 'rec-40'),
          'H4 contradicts nobody explained', 'case 17: and its hypothesis link is saved with the interview');

-- ------------------------------------------------------ 18 dismiss_recording
create temp table item2 as
select b.id, public.hub_sha256(b.transcript) as sha256 from public.call_inbox b where b.granola_id = 'rec-13';
select is(pg_temp.refused(v.stmt), v.want, 'case 18: dismiss_recording refused, ' || v.what)
from (values
    ('no reason', format($$ select public.dismiss_recording(%s, null) $$, (select id from item2)), 'the reason is empty'),
    ('an empty reason', format($$ select public.dismiss_recording(%s, '  ') $$, (select id from item2)), 'the reason is empty'),
    ('an unknown item', $$ select public.dismiss_recording(999999, 'not an interview') $$, 'no inbox item has the id 999999'),
    ('a reason of 10,001 characters', format($$ select public.dismiss_recording(%s, %L) $$, (select id from item2), repeat('r', 10001)),
     'the reason is too long: 10001 characters, the limit is 10000'),
    ('via that is neither ui nor claude', format($$ select public.dismiss_recording(%s, 'not an interview', 'x') $$, (select id from item2)),
     'via must be ui or claude')
) as v(what, stmt, want);
select is(pg_temp.call(format($$ select public.dismiss_recording(%s, 'A team meeting, not an interview.', 'ui')::text $$,
                              (select id from item2))),
          format('{"state": "dismissed", "inbox_id": %s}', (select id from item2)),
          'case 18: dismiss_recording with a reason is accepted');
select results_eq(
    $$ select b.state, b.reason, b.resolved_by, b.resolved_at is not null, public.hub_sha256(b.transcript),
              b.interview_id
       from public.call_inbox b where b.id = (select id from item2) $$,
    $$ select 'dismissed', 'A team meeting, not an interview.', pg_temp.sid('charlie'), true, (select sha256 from item2),
              null::bigint $$,
    'case 18: the row and its transcript remain, dismissed, with the reason');
select is(pg_temp.refused(format($$ select public.dismiss_recording(%s, 'again') $$, (select id from item2))),
          'only a waiting recording can be dismissed: this one was dismissed by charlie',
          'case 18: a dismissed item cannot be dismissed again');
select is(pg_temp.call(format($$ select public.confirm_recording(%s, 'CC-03', true) ->> 'person_code' $$, (select id from item2))),
          'CC-03', 'case 17: confirm_recording works on a dismissed item, so a wrong skip can be put right');
select results_eq(
    $$ select b.state, b.interview_id is not null from public.call_inbox b where b.id = (select id from item2) $$,
    $$ values ('confirmed', true) $$,
    'case 17: the dismissed item is now confirmed, with its interview');
select is((select count(*)::integer from public.call_inbox), 13,
          'case 18: nothing was deleted: every recording that went to the inbox is still a row');

-- a recording put in the inbox by hand, too short to be an interview, cannot be confirmed
select pg_temp.logout();
insert into public.call_inbox (source, title, recorded_on, attendee_emails, overview, transcript, submitted_by)
values ('paste', 'By hand', current_date - 1, '{}', 'An overview.', 'only a few words', pg_temp.sid('bravo'));
select pg_temp.login('charlie@hub.test');
select is(pg_temp.refused(format($$ select public.confirm_recording(%s, 'CC-04', true) $$,
                                 (select id from public.call_inbox where title = 'By hand'))),
          'the transcript is too short: 16 characters, an interview needs at least 1000',
          'case 17: confirm goes through the same checks as save_interview');

select * from finish();
rollback;
