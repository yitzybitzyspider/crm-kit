-- team hub, issue 22 (B3): the fixed write actions for people.
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
update public.sales set secondary_emails = '["BB.Alt@elsewhere-org.example.org"]' where handle = 'bravo';

select pg_temp.login('charlie@hub.test');

-- ------------------------------------------------------------ 2 add_person
select is(pg_temp.call($$ select public.add_person('Maria Okafor', null, 'Triage nurse', 'Example Clinic',
                                                   'Maria@Example-com.example.org', 'a friend of BB', null, 'claude') $$)::text,
          '{"name": "Maria Okafor", "slug": "maria-okafor", "owner": "charlie", "status": "to-contact", "person_code": "CC-01"}',
          'case 2: add_person(''Maria Okafor'', ...) as charlie returns CC-01, to-contact, maria-okafor');
select results_eq(
    $$ select c.person_code, c.slug, c.status, c.first_name, c.last_name, c.title, c.contact_key, c.referred_by,
              c.quote_by_name, c.sales_id, co.name, c.email_jsonb -> 0 ->> 'email'
       from public.contacts c join public.companies co on co.id = c.company_id $$,
    $$ select 'CC-01', 'maria-okafor', 'to-contact', 'Maria', 'Okafor', 'Triage nurse', 'maria@example-com.example.org',
              'a friend of BB', false, pg_temp.sid('charlie'), 'Example Clinic', 'maria@example-com.example.org' $$,
    'case 2: the person is stored with code, slug, status, name split at the last space, role, contact, organization');
select is(pg_temp.call($$ select public.add_person('Alan Turing', 'bravo') ->> 'person_code' $$), 'BB-01',
          'case 2: a person added for another teammate takes that teammate''s prefix');
select is(pg_temp.call($$ select public.add_person('Cher', null, null, 'EXAMPLE clinic') ->> 'slug' $$), 'cher',
          'case 2: a one word name is a name');
select is((select count(*)::integer from public.companies), 1,
          'case 2: an organization already on file under other capitals is used, not made twice');
select is(pg_temp.call(format($$ select public.add_person(%L) ->> 'person_code' $$,
                              'A' || repeat('b', 195) || ' Cee')), 'CC-03',
          'edge: a name of exactly 200 characters is accepted');
select is(pg_temp.call($$ select public.add_person('Robert''); drop table contacts; --', null,
                                                   '<b>nurse</b> **lead** "quoted"; -- x') ->> 'person_code' $$),
          'CC-04', 'edge: text with quotes, semicolons, -- and markup is accepted');
select is((select title from public.contacts where person_code = 'CC-04'),
          '<b>nurse</b> **lead** "quoted"; -- x', 'edge: and stored as written');
select is((select first_name || ' ' || last_name from public.contacts where person_code = 'CC-04'),
          'Robert''); drop table contacts; --', 'edge: the name too, and the table is still here');

-- --------------------------------------------------- 3 add_person refusals
select is(pg_temp.refused(v.stmt), v.want, 'case 3: add_person refused, ' || v.what)
from (values
    ('an empty name', $$ select public.add_person('') $$, 'the name is empty'),
    ('a null name', $$ select public.add_person(null) $$, 'the name is empty'),
    ('a name of only spaces', $$ select public.add_person('   ') $$, 'the name is empty'),
    ('a name that is only a title', $$ select public.add_person('Dr.') $$,
     '''Dr.'' is only a title or punctuation, not a name'),
    ('a name that is only a number', $$ select public.add_person('123') $$,
     '''123'' is only a number, not a name'),
    ('an unknown owner', $$ select public.add_person('Grace Hopper', 'bob') $$,
     'owner ''bob'' is not a team handle (see team.json)'),
    ('the same name as written', $$ select public.add_person('Maria Okafor') $$,
     'already on file (same name): CC-01, Maria Okafor, owner charlie, status to-contact, last touch none'),
    ('the same name with a title and a credential', $$ select public.add_person('dr maria okafor md', 'bravo') $$,
     'already on file (same name): CC-01, Maria Okafor, owner charlie, status to-contact, last touch none'),
    ('the same contact in other capitals', $$ select public.add_person('Someone Else', null, null, null, 'MARIA@EXAMPLE-COM.example.org') $$,
     'already on file (same contact): CC-01, Maria Okafor, owner charlie, status to-contact, last touch none'),
    ('a name of two lines', $$ select public.add_person(E'Grace\nHopper') $$, 'the name must be one line'),
    ('a role of 301 characters', format($$ select public.add_person('Grace Hopper', null, %L) $$, repeat('r', 301)),
     'the role is too long: 301 characters, the limit is 300'),
    ('via that is neither ui nor claude',
     $$ select public.add_person('Grace Hopper', null, null, null, null, null, null, 'email') $$,
     'via must be ui or claude'),
    ('via null', $$ select public.add_person('Grace Hopper', via => null) $$, 'via must be ui or claude')
) as v(what, stmt, want);
select is(pg_temp.refused(format($$ select public.add_person(%L) $$, 'A' || repeat('b', 196) || ' Cee')),
          'the name is too long: 201 characters, the limit is 200',
          'case 3: add_person refused, a 201 character name');
select is((select count(*)::integer from public.contacts), 5, 'case 3: after the refusals there are still five people');

-- ----------------------------------------------------------- 4 find_person
select is(pg_temp.call(format($$ select string_agg(person_code, ',') from public.find_person(%L) $$, v.q)),
          v.want, 'case 4: find_person finds the person by ' || v.what)
from (values
    ('code', 'cc-01', 'CC-01'),
    ('slug', 'maria-okafor', 'CC-01'),
    ('part of the name', 'okafor', 'CC-01'),
    ('the name with a title', 'Dr. Maria OKAFOR, MD', 'CC-01'),
    ('email', 'maria@example', 'CC-01'),
    ('organization', 'example clin', 'CC-01,CC-02'),
    ('a query with % in it (treated as text)', '%', '(null)'),
    ('a query with _ in it (treated as text)', 'm_ria', '(null)'),
    ('a query that is SQL (treated as text)', $$'; drop table contacts; --$$, 'CC-04')
) as v(what, q, want);
select is(pg_temp.call($$ select row(f.person_code, f.name, f.role, f.organization, f.owner, f.status,
                                     f.last_touch_date, f.last_touch_channel, f.last_touch_text)::text
                          from public.find_person('CC-01', 'claude') f $$),
          '(CC-01,"Maria Okafor","Triage nurse","Example Clinic",charlie,to-contact,,,)',
          'case 4: it returns code, name, role, organization, owner, status and an empty last touch');
select is(pg_temp.refused($$ select count(*) from public.find_person('') $$),
          'the query is empty: give a name, a person code, a contact detail or an organization',
          'case 4: an empty query is refused');
select is(pg_temp.refused($$ select count(*) from public.find_person('  ') $$),
          'the query is empty: give a name, a person code, a contact detail or an organization',
          'case 4: a query of only spaces is refused');
select is(pg_temp.refused($$ select count(*) from public.find_person('okafor', 'sms') $$),
          'via must be ui or claude', 'case 4: via is checked on a read too');

-- --------------------------------------------------------- 5 update_person
select is(pg_temp.call($$ select public.update_person('CC-01', role => 'Charge nurse', via => 'claude')::text $$),
          '{"changed": ["role"], "person_code": "CC-01"}', 'case 5: update_person changes the role');
select results_eq(
    $$ select c.title, c.contact_key, c.referred_by, c.quote_by_name, co.name, c.person_code, c.slug, c.status,
              c.sales_id
       from public.contacts c join public.companies co on co.id = c.company_id where c.person_code = 'CC-01' $$,
    $$ select 'Charge nurse', 'maria@example-com.example.org', 'a friend of BB', false, 'Example Clinic', 'CC-01', 'maria-okafor',
              'to-contact', pg_temp.sid('charlie') $$,
    'case 5: and only the role: contact, referrer, organization, code, slug, status and owner are as they were');
select is(pg_temp.call($$ select public.update_person('cc-01', organization => 'City Hospital', contact => 'm.okafor@city-example.example.org',
                                                      referred_by => '', quote_by_name => true,
                                                      notes => E'Met at the fair.\nPrefers mornings.') ->> 'person_code' $$),
          'CC-01', 'case 5: several fields at once, the code given in small letters');
select results_eq(
    $$ select c.title, c.contact_key, c.referred_by, c.quote_by_name, co.name, c.background,
              c.email_jsonb::text, c.person_code, c.slug
       from public.contacts c join public.companies co on co.id = c.company_id where c.person_code = 'CC-01' $$,
    $$ select 'Charge nurse', 'm.okafor@city-example.example.org', null::text, true, 'City Hospital',
              E'Met at the fair.\nPrefers mornings.',
              '[{"type": "Work", "email": "maria@example-com.example.org"}, {"type": "Work", "email": "m.okafor@city-example.example.org"}]',
              'CC-01', 'maria-okafor' $$,
    'case 5: each given field changed, an empty one cleared, the new address filed with the old, code and slug unchanged');
select is(pg_temp.call($$ select public.add_person('Grace Hopper', null, null, null, 'grace@navy-example.example.org') ->> 'person_code' $$),
          'CC-05', 'case 5: a second person with their own contact');
select is(pg_temp.refused(v.stmt), v.want, 'case 5: update_person refused, ' || v.what)
from (values
    ('a contact held by another person', $$ select public.update_person('CC-01', contact => 'Grace@Navy-example.example.org') $$,
     'already on file (same contact): CC-05, Grace Hopper, owner charlie, status to-contact, last touch none'),
    ('nothing to change', $$ select public.update_person('CC-01') $$,
     'nothing to change: give at least one of role, organization, contact, referred_by, quote_by_name, notes, category'),
    ('an unknown person', $$ select public.update_person('CC-99', role => 'x') $$, 'no person has the code CC-99'),
    ('an empty person code', $$ select public.update_person('', role => 'x') $$, 'the person code is empty'),
    ('notes of 10,001 characters', format($$ select public.update_person('CC-01', notes => %L) $$, repeat('n', 10001)),
     'the notes is too long: 10001 characters, the limit is 10000'),
    ('via that is neither ui nor claude', $$ select public.update_person('CC-01', role => 'x', via => 'job') $$,
     'via must be ui or claude')
) as v(what, stmt, want);
select is(pg_temp.call(format($$ select public.update_person('CC-01', notes => %L) ->> 'person_code' $$, repeat('n', 10000))),
          'CC-01', 'edge: notes of exactly 10,000 characters are accepted');

-- ------------------------------------------------------------- 6 set_owner
select is(pg_temp.call($$ select public.set_owner('CC-01', 'bravo', 'claude')::text $$),
          '{"owner": "bravo", "person_code": "CC-01"}', 'case 6: set_owner hands the person to bravo');
select results_eq(
    $$ select sales_id, person_code, slug from public.contacts where slug = 'maria-okafor' $$,
    $$ select pg_temp.sid('bravo'), 'CC-01', 'maria-okafor' $$,
    'case 6: the owner changed and the code did not');
select is(pg_temp.refused(v.stmt), v.want, 'case 6: set_owner refused, ' || v.what)
from (values
    ('an unknown handle', $$ select public.set_owner('CC-01', 'bob') $$,
     'owner ''bob'' is not a team handle (see team.json)'),
    ('an unknown person', $$ select public.set_owner('ZZ-01', 'bravo') $$, 'no person has the code ZZ-01'),
    ('via that is neither ui nor claude', $$ select public.set_owner('CC-01', 'bravo', 'x') $$, 'via must be ui or claude')
) as v(what, stmt, want);
select is(pg_temp.call($$ select public.set_owner('CC-01') ->> 'owner' $$), 'charlie',
          'case 6: with no owner named, the person comes to the caller');

-- ------------------------------------------------------------ 7 set_status
select is(pg_temp.call($$ select public.set_status('CC-01', 'declined', 'claude')::text $$),
          '{"status": "declined", "person_code": "CC-01"}', 'case 7: set_status declined is accepted');
select is((select status from public.contacts where person_code = 'CC-01'), 'declined', 'case 7: and stored');
select is(pg_temp.refused(v.stmt), v.want, 'case 7: set_status refused, ' || v.what)
from (values
    ('contacted with no touch', $$ select public.set_status('CC-01', 'contacted') $$,
     'log the touch first: ''contacted'' needs a touch on file for CC-01'),
    ('replied with no touch', $$ select public.set_status('CC-01', 'replied') $$,
     'log the touch first: ''replied'' needs a touch on file for CC-01'),
    ('scheduled with no touch', $$ select public.set_status('CC-01', 'scheduled') $$,
     'log the touch first: ''scheduled'' needs a touch on file for CC-01'),
    ('interviewed with no interview', $$ select public.set_status('CC-01', 'interviewed') $$,
     'save the interview first: ''interviewed'' needs an interview on file for CC-01'),
    ('a status that is not one of the seven', $$ select public.set_status('CC-01', 'cold') $$,
     'status ''cold'' is not allowed: use to-contact, contacted, replied, scheduled, interviewed, declined or do-not-contact'),
    ('an empty status', $$ select public.set_status('CC-01', '') $$,
     'the status is empty: use to-contact, contacted, replied, scheduled, interviewed, declined or do-not-contact'),
    ('an unknown person', $$ select public.set_status('CC-99', 'declined') $$, 'no person has the code CC-99'),
    ('via that is neither ui nor claude', $$ select public.set_status('CC-01', 'declined', 'x') $$,
     'via must be ui or claude')
) as v(what, stmt, want);
select is((select status from public.contacts where person_code = 'CC-01'), 'declined',
          'case 7: after the refusals the status is as it was');
select is(pg_temp.call($$ select public.set_status('CC-01', 'do-not-contact') ->> 'status' $$), 'do-not-contact',
          'case 7: do-not-contact is accepted');

-- ------------------------------- issue 64: several contact details, sorted
-- The numbers are the test cases of issue 64.
select is(pg_temp.call($$ select public.add_person('Casey Lane', contacts => array[
              'a@b-org.example.org', 'https://www.linkedin.com/in/x/', 'https://emergency.metro.edu/content/x', '+1 415 555 0100'])
              ->> 'person_code' $$),
          'CC-06', '64 case 1: add_person takes a list of four details');
select results_eq(
    $$ select email_jsonb::text, linkedin_url, links, phone_jsonb::text, contact_key
       from public.contacts where person_code = 'CC-06' $$,
    $$ values ('[{"type": "Work", "email": "a@b-org.example.org"}]', 'https://www.linkedin.com/in/x/',
               array['https://emergency.metro.edu/content/x'], '[{"type": "Work", "number": "+1 415 555 0100"}]',
               'a@b-org.example.org') $$,
    '64 case 1: the email, the LinkedIn, the profile page and the phone are each filed where they belong');
select is(pg_temp.refused($$ select public.add_person('Ivy Message', contacts => array['iMessage']) $$),
          'contact detail "iMessage" is not an email, phone, LinkedIn or web link',
          '64 case 2: a detail that is no kind is refused in one plain line, no constraint name, nothing written');
select is(pg_temp.refused($$ select public.add_person('Ivy Message', contacts => array['ivy@example.org', 'iMessage']) $$),
          'contact detail "iMessage" is not an email, phone, LinkedIn or web link',
          '64 case 3: one bad detail among good ones refuses the whole call, nothing written');
select is(pg_temp.refused($$ select public.add_person('Ivy Message', contacts => array['text her on Signal please, she is usually free after six']) $$),
          'contact detail "text her on Signal please, she is usuall" is not an email, phone, LinkedIn or web link',
          '64 case 2: the refusal names only the first 40 characters');
select is(pg_temp.call($$ select public.add_person('Dee Twice', contacts => array['dup@twice-org.example.org', 'DUP@Twice-org.example.org']) ->> 'person_code' $$),
          'CC-07', '64 case 4: the same detail twice in one call is accepted');
select is((select email_jsonb::text from public.contacts where person_code = 'CC-07'),
          '[{"type": "Work", "email": "dup@twice-org.example.org"}]', '64 case 4: and stored once');
select is(pg_temp.refused($$ select public.add_person('Mia Copy', contacts => array['new@copy-org.example.org', 'Maria@Example-com.example.org']) $$),
          'already on file (same contact): ' || public.hub_describe_person(pg_temp.pid('CC-01')),
          '64 case 5: an email already on another person refuses the whole call, naming that person');
select is(pg_temp.call($$ select public.update_person('CC-06', contacts => array['https://metro.example/profile'])::text $$),
          '{"changed": ["contact"], "person_code": "CC-06"}', '64 case 6: update_person adds a web link');
select results_eq(
    $$ select email_jsonb::text, linkedin_url, links, phone_jsonb::text, contact_key
       from public.contacts where person_code = 'CC-06' $$,
    $$ values ('[{"type": "Work", "email": "a@b-org.example.org"}]', 'https://www.linkedin.com/in/x/',
               array['https://emergency.metro.edu/content/x', 'https://metro.example/profile'],
               '[{"type": "Work", "number": "+1 415 555 0100"}]', 'a@b-org.example.org') $$,
    '64 case 6: links gains it and every other detail is as it was');
select is(pg_temp.call($$ select public.update_person('CC-06', contacts => array['A@B-org.example.org', 'emergency.metro.edu/content/x/',
                                                                                 '14155550100'])::text $$),
          '{"changed": [], "person_code": "CC-06"}', '64 case 7: details already on this person are skipped, not refused');
select is((select concat_ws('|', email_jsonb::text, links::text, phone_jsonb::text) from public.contacts where person_code = 'CC-06'),
          '[{"type": "Work", "email": "a@b-org.example.org"}]|{https://emergency.metro.edu/content/x,https://metro.example/profile}|'
          || '[{"type": "Work", "number": "+1 415 555 0100"}]',
          '64 case 7: and nothing changed');
select is(pg_temp.call($$ select public.add_person('Dan Two', contacts => array['linkedin.com/in/dan-two']) ->> 'person_code' $$),
          'CC-08', 'fixture: a person with a LinkedIn given without https://');
select is(pg_temp.refused($$ select public.update_person('CC-06', contacts => array['https://metro.example/other',
                                                                                  'HTTPS://LinkedIn.com/in/Dan-Two/']) $$),
          'already on file (same contact): ' || public.hub_describe_person(pg_temp.pid('CC-08')),
          '64 case 8: another person''s LinkedIn (other capitals, https:// and a trailing / ignored) refuses the update');
select is(pg_temp.refused(format($$ select public.add_person('Eleven Details', contacts => %L::text[]) $$,
                                 (select array_agg('e' || i || '@eleven.org') from generate_series(1, 11) i))),
          'at most 10 contact details in one call: 11 given', '64 case 9: 11 details are refused, nothing written');
select is(pg_temp.call(format($$ select public.add_person('Ten Details', contacts => %L::text[]) ->> 'person_code' $$,
                              (select array_agg('t' || i || '@ten.org') from generate_series(1, 10) i))),
          'CC-09', '64 edge: 10 details are accepted');
select is(pg_temp.call($$ select public.add_person('Bea Bare', contacts => array['emergency.metro.edu/content/bea']) ->> 'person_code' $$),
          'CC-10', '64 case 10: a bare address with a path is accepted');
select is((select links from public.contacts where person_code = 'CC-10'), array['https://emergency.metro.edu/content/bea'],
          '64 case 10: and stored with https://');
select is(pg_temp.call($$ select public.add_person('Lin Two', contacts => array['https://www.linkedin.com/in/lin-one',
                                                                                'linkedin.com/in/lin-two']) ->> 'person_code' $$),
          'CC-11', '64 case 11: two different LinkedIn addresses');
select results_eq($$ select linkedin_url, links from public.contacts where person_code = 'CC-11' $$,
                  $$ values ('https://www.linkedin.com/in/lin-one', array['https://linkedin.com/in/lin-two']) $$,
                  '64 case 11: the first is the LinkedIn, the second goes to links');
select is(pg_temp.call($$ select public.add_person('Old Caller', null, null, null, 'old@caller-org.example.org') ->> 'person_code' $$),
          'CC-12', '64 case 12: a single text detail, the old way of calling, still works');
select results_eq($$ select email_jsonb::text, contact_key, links from public.contacts where person_code = 'CC-12' $$,
                  $$ values ('[{"type": "Work", "email": "old@caller-org.example.org"}]', 'old@caller-org.example.org', '{}'::text[]) $$,
                  '64 case 12: and is filed as before');
select is(pg_temp.refused($$ select public.add_person('Old Bad', null, null, null, 'iMessage') $$),
          'contact detail "iMessage" is not an email, phone, LinkedIn or web link',
          '64 case 12: the old way is sorted too');
select is(pg_temp.call($$ select string_agg(person_code, ',') from public.find_person('emergency.metro.edu') $$),
          'CC-06,CC-10', '64 case 13: find_person finds people by a web link');
select is(pg_temp.call($$ select array_to_string(f.contact, ', ') from public.find_person('CC-06') f $$),
          'a@b-org.example.org, +1 415 555 0100, https://www.linkedin.com/in/x/, https://emergency.metro.edu/content/x, '
          || 'https://metro.example/profile',
          '64: find_person gives every detail of the person, emails, phones, LinkedIn, then links');
select is(pg_temp.refused(format($$ select public.add_person('Long Link', contacts => array[%L]) $$,
                                 'https://example.org/' || repeat('p', 281))),
          'the contact detail is too long: 301 characters, the limit is 300', '64 edge: a detail of 301 characters is refused');
select is(pg_temp.call(format($$ select public.add_person('Long Link', contacts => array[%L]) ->> 'person_code' $$,
                              'https://example.org/' || repeat('p', 280))),
          'CC-13', '64 edge: a detail of 300 characters is accepted');
select is(pg_temp.call($$ select public.add_person('Casey Case', contacts => array['LinkedIn.com/in/casey']) ->> 'person_code' $$),
          'CC-14', '64 edge: LinkedIn.com without https://');
select is((select linkedin_url from public.contacts where person_code = 'CC-14'), 'https://LinkedIn.com/in/casey',
          '64 edge: is stored as https://LinkedIn.com/in/casey');
select is(pg_temp.call($$ select public.add_person('Bo Blank', contacts => array['', '   ', null, 'bo@blank-org.example.org']) ->> 'person_code' $$),
          'CC-15', '64 edge: blank details are skipped');
select is((select email_jsonb::text from public.contacts where person_code = 'CC-15'),
          '[{"type": "Work", "email": "bo@blank-org.example.org"}]', '64 edge: and only the real one is stored');
select is(pg_temp.refused(v.stmt), v.want, '64 edge: refused, ' || v.what)
from (values
    ('a phone already on another person, written otherwise',
     $$ select public.add_person('Pho Copy', contacts => array['+1 (415) 555-0100']) $$,
     'already on file (same contact): ' || public.hub_describe_person(pg_temp.pid('CC-06'))),
    ('a web link already on another person, with http:// and a trailing /',
     $$ select public.add_person('Web Copy', contacts => array['http://Emergency.Metro.edu/content/bea/']) $$,
     'already on file (same contact): ' || public.hub_describe_person(pg_temp.pid('CC-10'))),
    ('a javascript: address naming linkedin.com',
     $$ select public.add_person('Eve Link', contacts => array['javascript:alert(1)//linkedin.com']) $$,
     'contact detail "javascript:alert(1)//linkedin.com" is not an email, phone, LinkedIn or web link'),
    ('a phone of six digits', $$ select public.add_person('Six Digits', contacts => array['555 010']) $$,
     'contact detail "555 010" is not an email, phone, LinkedIn or web link'),
    ('a bare host with no path', $$ select public.add_person('No Path', contacts => array['metro.edu']) $$,
     'contact detail "metro.edu" is not an email, phone, LinkedIn or web link'),
    ('an update with a detail that is no kind', $$ select public.update_person('CC-06', contacts => array['call her']) $$,
     'contact detail "call her" is not an email, phone, LinkedIn or web link')
) as v(what, stmt, want);
select is(pg_temp.call($$ select public.update_person('CC-12', contacts => array['+1 (510) 555-0199', 'old@caller-org.example.org'])::text $$),
          '{"changed": ["contact"], "person_code": "CC-12"}', '64: an update adds a phone and skips the email on file');
select is((select phone_jsonb::text from public.contacts where person_code = 'CC-12'),
          '[{"type": "Work", "number": "+1 (510) 555-0199"}]', '64: the phone is filed with the person''s phones');

-- ------------------------------------------- 20 who may call, every action
-- One call of each action, with arguments that would otherwise be accepted
-- or refused for another reason: the caller is judged first.
create temp table calls (fn text, stmt text);
grant select on calls to public;
insert into calls values
    ('find_person', $$ select count(*) from public.find_person('okafor') $$),
    ('add_person', $$ select public.add_person('New Person') $$),
    ('update_person', $$ select public.update_person('CC-01', role => 'x') $$),
    ('set_owner', $$ select public.set_owner('CC-01', 'bravo') $$),
    ('set_status', $$ select public.set_status('CC-01', 'declined') $$),
    ('log_touch', $$ select public.log_touch('CC-01', null, null, 'email', 'Hello') $$),
    ('save_interview', $$ select public.save_interview('CC-01', current_date - 2, null, 'paste', null, true, 't', 'o',
                                                      repeat('word ', 300)) $$),
    ('update_overview', $$ select public.update_overview(1, 'o') $$),
    ('submit_recording', $$ select public.submit_recording(null, 'paste', 't', current_date - 2, array['a@b-example.example.org'],
                                                           'o', repeat('word ', 300), true) $$),
    ('confirm_recording', $$ select public.confirm_recording(1, 'CC-01', true) $$),
    ('dismiss_recording', $$ select public.dismiss_recording(1, 'not an interview') $$),
    ('inbox_suggestions', $$ select count(*) from public.inbox_suggestions(1) $$);

select pg_temp.logout();
select is(pg_temp.refused(c.stmt), 'sign in first: this action is for a signed in teammate',
          'case 20: ' || c.fn || ' refuses a caller with no sign-in')
from calls c;
select is(pg_temp.call_as('anon', c.stmt), 'ERROR: permission denied for function ' || c.fn,
          'case 20: ' || c.fn || ' cannot be called by the anon role')
from calls c;
select is(pg_temp.call_as('service_role', c.stmt), 'ERROR: permission denied for function ' || c.fn,
          'case 20: ' || c.fn || ' cannot be called by the service role')
from calls c;

select pg_temp.login('later@hub.test');
select is(pg_temp.refused(c.stmt), 'this teammate has no handle yet',
          'case 20: ' || c.fn || ' refuses a teammate with no handle')
from calls c;

update public.sales set disabled = true where handle = 'delta';
select pg_temp.login('delta@hub.test');
select is(pg_temp.refused(c.stmt), 'this teammate is disabled',
          'case 20: ' || c.fn || ' refuses a disabled teammate')
from calls c;

select set_config('request.jwt.claims',
    '{"sub": "00000000-0000-4000-8000-0000000000ff", "role": "authenticated"}', true);
select is(pg_temp.refused(c.stmt), 'sign in first: this sign-in is not a teammate',
          'case 20: ' || c.fn || ' refuses a sign-in that is no teammate')
from calls c;

-- and a signed in teammate with a handle is let in, through the authenticated role itself
select pg_temp.login('bravo@hub.test');
select is(pg_temp.call_as('authenticated', $$ select public.add_person('Katherine Johnson') ->> 'person_code' $$),
          'BB-02', 'case 20: a signed in teammate calls add_person as the authenticated role');
select is(pg_temp.call_as('authenticated', $$ select string_agg(person_code, ',') from public.find_person('katherine') $$),
          'BB-02', 'case 20: and find_person');
select is(pg_temp.refused($$ select public.set_owner('CC-01', 'delta') $$), 'owner ''delta'' is disabled',
          'case 20: a person cannot be handed to a disabled teammate');

-- the shared parts are for the owner only: not one of them can be called through the API
select is(pg_temp.call_as(r, 'select ' || f), 'ERROR: permission denied for function ' || split_part(split_part(f, '.', 2), '(', 1),
          'the shared part ' || split_part(f, '(', 1) || ' cannot be called by ' || r)
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.hub_caller()', 'public.hub_end()', $$public.hub_begin('add_person', 'ui')$$,
                  $$public.hub_person('CC-01')$$, 'public.hub_describe_person(1)', 'public.hub_latest_today()',
                  $$public.hub_company('X', 1)$$, $$public.hub_line('a', 'b', 3, true)$$,
                  $$public.hub_block('a', 'b', 3, true)$$, $$public.hub_missing_quote('a', 'b')$$,
                  $$public.hub_check_quotes('a', 'b')$$,
                  $$public.hub_check_transcript('paste', 'x', null)$$, $$public.hub_check_hypotheses('[]')$$,
                  'public.hub_day(current_date, $$d$$)', $$public.hub_recording_on_file('g', null)$$,
                  $$public.hub_write_interview(1, current_date, 1, 1, 'paste', null, 't', 'o', 'x', null, '[]', 'notes')$$,
                  $$public.hub_kind('notes')$$, $$public.hub_consent_refusal('notes')$$,
                  $$public.hub_check_text('notes', 'paste', 'x', null)$$,
                  $$public.hub_check_overview('debrief', 'a', 'b')$$,
                  $$public.hub_person_emails('a@b-example.example.org', '[]')$$, $$public.hub_addresses(array['a@b-example.example.org'])$$,
                  $$public.hub_outside_addresses(array['a@b-example.example.org'])$$,
                  $$(select count(*) from public.hub_suggestions(array['a@b-example.example.org'], 't'))$$]) f;
select ok(not has_function_privilege(r, f, 'execute'), 'the trigger function ' || f || ' cannot be executed by ' || r)
from unnest(array['anon', 'authenticated', 'service_role']) r,
     unnest(array['public.hub_audit_row()', 'public.hub_refuse_audit_change()']) f;

-- only these twelve functions of this issue are open to a signed in teammate
select is(
    (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
         and has_function_privilege('authenticated', p.oid, 'execute')
         and (p.proname like 'hub\_%'
              or p.proname in ('find_person', 'add_person', 'update_person', 'set_owner', 'set_status', 'log_touch',
                               'save_interview', 'update_overview', 'submit_recording', 'confirm_recording',
                               'dismiss_recording', 'inbox_suggestions'))
         and p.proname not in ('hub_name_fold', 'hub_name_key', 'hub_prefix_for_handle', 'hub_sha256')),
    'add_person, confirm_recording, dismiss_recording, find_person, inbox_suggestions, log_touch, save_interview, '
    || 'set_owner, set_status, submit_recording, update_overview, update_person',
    'the twelve actions, and no shared part, can be executed by a signed in teammate');
select is(
    (select count(*)::integer
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
         and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))
         and (p.proname like 'hub\_%'
              or p.proname in ('find_person', 'add_person', 'update_person', 'set_owner', 'set_status', 'log_touch',
                               'save_interview', 'update_overview', 'submit_recording', 'confirm_recording',
                               'dismiss_recording', 'inbox_suggestions'))
         and p.proname not in ('hub_name_fold', 'hub_name_key', 'hub_prefix_for_handle', 'hub_sha256')),
    0, 'none of them can be executed by anon or by the service role');
select is(
    (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
         and p.proname in ('find_person', 'add_person', 'update_person', 'set_owner', 'set_status', 'log_touch',
                           'save_interview', 'update_overview', 'submit_recording', 'confirm_recording',
                           'dismiss_recording', 'inbox_suggestions')
         and p.prosecdef and p.proconfig @> array['search_path=""']),
    12, 'each of the twelve runs as its owner with an empty search path');

select * from finish();
rollback;
