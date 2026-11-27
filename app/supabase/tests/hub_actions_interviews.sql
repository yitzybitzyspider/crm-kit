-- team hub, issue 22 (B3): the fixed write actions save_interview and update_overview.
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

-- The text of one save_interview call. Arguments ending in _sql are SQL, the rest are values.
create function pg_temp.save_sql(
        code text, overview text, body_sql text default 'pg_temp.transcript()', hyp text default null,
        consent_sql text default 'true', source text default 'paste', reported_sql text default 'null',
        gid text default null, day_sql text default 'current_date - 2', title text default 'Interview: test',
        interviewer text default null, via text default 'claude')
    returns text language sql as $$
    select format('select public.save_interview(%L, %s, %L, %L, %L, %s, %L, %L, %s, %L::jsonb, %s, %L) ->> ''interview_id''',
                  code, day_sql, interviewer, source, gid, consent_sql, title, overview, body_sql, hyp, reported_sql, via)
$$;

select pg_temp.login('charlie@example.org');
select is(pg_temp.call($$ select public.add_person('Maria Okafor', null, 'Triage nurse', 'Example Clinic') ->> 'person_code' $$),
          'CC-01', 'fixture: the person who is interviewed');
select is(pg_temp.call($$ select public.add_person('Alan Turing') ->> 'person_code' $$), 'CC-02',
          'fixture: the person every refusal is tried on');
select is(pg_temp.call($$ select public.add_person('Grace Hopper') ->> 'person_code' $$), 'CC-03',
          'fixture: a third person');
select is(char_length(pg_temp.transcript()), 1500, 'fixture: the transcript is 1500 characters');

-- -------------------------------------------------------- 10 save_interview
create temp table saved as
select pg_temp.call(pg_temp.save_sql('CC-01',
    E'## Who\nMaria, triage nurse.\n\n## Quotes\n"I waited six hours in the lobby before anyone saw me."\n',
    hyp => '[{"hypothesis": "H2", "stance": "supports", "why": "waited six hours"}, {"hypothesis": "H5", "stance": "unclear"}]',
    gid => 'granola-abc', source => 'granola', reported_sql => '1500',
    title => 'Interview: Maria Okafor, triage nurse, Example Clinic')) as id;
select matches((select id from saved), '^[0-9]+$', 'case 10: save_interview returns the interview id');
select results_eq(
    $$ select i.contact_id, i.date, i.interviewer_id, i.source, i.granola_id, i.consent_to_record, i.title,
              i.created_by, t.chars, t.sha256, t.reported_chars, t.body = pg_temp.transcript()
       from public.interviews i join public.interview_transcripts t on t.interview_id = i.id $$,
    $$ select pg_temp.pid('CC-01'), current_date - 2, pg_temp.sid('charlie'), 'granola', 'granola-abc', true,
              'Interview: Maria Okafor, triage nurse, Example Clinic', pg_temp.sid('charlie'), 1500,
              public.hub_sha256(pg_temp.transcript()), 1500, true $$,
    'case 10: one interview and one transcript, chars and sha256 matching the text, reported size equal to its length accepted');
select results_eq(
    $$ select hypothesis, stance, why from public.interview_hypotheses order by hypothesis $$,
    $$ values ('H2', 'supports', 'waited six hours'), ('H5', 'unclear', null) $$,
    'case 10: two hypothesis rows');
select is((select status from public.contacts where person_code = 'CC-01'), 'interviewed',
          'case 10: the person is interviewed');
select is(pg_temp.call($$ select public.set_status('CC-01', 'interviewed') ->> 'status' $$), 'interviewed',
          'case 7: set_status interviewed is accepted once an interview is on file');

-- ----------------------------------------------- 11 save_interview refusals
select is(pg_temp.refused(v.stmt), v.want, 'case 11: save_interview refused, ' || v.what)
from (values
    ('consent false', pg_temp.save_sql('CC-02', 'An overview.', consent_sql => 'false'),
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('consent null', pg_temp.save_sql('CC-02', 'An overview.', consent_sql => 'null'),
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('a transcript of 999 characters', pg_temp.save_sql('CC-02', 'An overview.', 'left(pg_temp.transcript(), 999)'),
     'the transcript is too short: 999 characters, an interview needs at least 1000'),
    ('an empty transcript', pg_temp.save_sql('CC-02', 'An overview.', $$''$$), 'the transcript is empty'),
    ('a null transcript', pg_temp.save_sql('CC-02', 'An overview.', 'null'), 'the transcript is empty'),
    ('source granola with no reported_chars', pg_temp.save_sql('CC-02', 'An overview.', source => 'granola'),
     'a granola recording needs reported_chars, the size the recorder reported'),
    ('a transcript of 1500 with reported_chars 1501', pg_temp.save_sql('CC-02', 'An overview.', reported_sql => '1501'),
     'the transcript is cut short: 1500 of 1501 characters'),
    ('a granola_id already saved', pg_temp.save_sql('CC-02', 'An overview.', gid => 'granola-abc'),
     format('this recording is already saved as interview %s for CC-01', (select id from saved))),
    ('an empty overview', pg_temp.save_sql('CC-02', ''), 'the overview is empty'),
    ('a null overview', pg_temp.save_sql('CC-02', null), 'the overview is empty'),
    ('an empty title', pg_temp.save_sql('CC-02', 'An overview.', title => ' '), 'the title is empty'),
    ('hypothesis 2', pg_temp.save_sql('CC-02', 'An overview.', hyp => '[{"hypothesis": "2", "stance": "supports"}]'),
     'hypothesis ''2'' is not of the form H<number>, for example H2'),
    ('hypothesis given as a number', pg_temp.save_sql('CC-02', 'An overview.', hyp => '[{"hypothesis": 2, "stance": "supports"}]'),
     'hypothesis ''2'' is not of the form H<number>, for example H2'),
    ('stance maybe', pg_temp.save_sql('CC-02', 'An overview.', hyp => '[{"hypothesis": "H2", "stance": "maybe"}]'),
     'stance ''maybe'' is not allowed: use supports, contradicts or unclear'),
    ('H2 twice', pg_temp.save_sql('CC-02', 'An overview.',
        hyp => '[{"hypothesis": "H2", "stance": "supports"}, {"hypothesis": "H2", "stance": "unclear"}]'),
     'H2 is listed twice'),
    ('hypotheses that are not a list', pg_temp.save_sql('CC-02', 'An overview.', hyp => '{"hypothesis": "H2", "stance": "supports"}'),
     'hypotheses must be a list, for example [{"hypothesis": "H2", "stance": "supports", "why": "one line"}]'),
    ('a hypothesis that is not an object', pg_temp.save_sql('CC-02', 'An overview.', hyp => '["H2"]'),
     'each hypothesis must look like {"hypothesis": "H2", "stance": "supports", "why": "one line"}'),
    ('an overview quote of five words that is not in the transcript',
     pg_temp.save_sql('CC-02', 'She said "we never had any trouble" and left.'),
     'this quote in the overview is not word for word in the transcript: "we never had any trouble"'),
    ('a quote that differs from the transcript by one capital letter',
     pg_temp.save_sql('CC-02', 'She said "i waited six hours in the lobby".'),
     'this quote in the overview is not word for word in the transcript: "i waited six hours in the lobby"'),
    ('a quote that differs from the transcript by one comma',
     pg_temp.save_sql('CC-02', 'She said "scanner was down again and nobody told us why".'),
     'this quote in the overview is not word for word in the transcript: "scanner was down again and nobody told us why"'),
    ('a long quote, shown by its first 60 characters',
     pg_temp.save_sql('CC-02', 'She said "' || repeat('never said this ', 10) || '".'),
     'this quote in the overview is not word for word in the transcript: "' || left(repeat('never said this ', 10), 60) || '"'),
    ('a date in the future', pg_temp.save_sql('CC-02', 'An overview.', day_sql => 'pg_temp.today() + 1'),
     format('the date %s is in the future', pg_temp.today() + 1)),
    ('no date', pg_temp.save_sql('CC-02', 'An overview.', day_sql => 'null'), 'the date is empty'),
    ('an unknown source', pg_temp.save_sql('CC-02', 'An overview.', source => 'zoom'),
     'source ''zoom'' is not allowed: use granola, paste or other'),
    ('an unknown person', pg_temp.save_sql('CC-99', 'An overview.'), 'no person has the code CC-99'),
    ('an unknown interviewer', pg_temp.save_sql('CC-02', 'An overview.', interviewer => 'bob'),
     'interviewer ''bob'' is not a team handle (see team.json)'),
    ('an overview of 100,001 characters', pg_temp.save_sql('CC-02', repeat('o', 100001)),
     'the overview is too long: 100001 characters, the limit is 100000'),
    ('a transcript of 5,000,001 characters', pg_temp.save_sql('CC-02', 'An overview.', $$repeat('x', 5000001)$$),
     'the transcript is too long: 5000001 characters, the limit is 5000000'),
    ('via that is neither ui nor claude', pg_temp.save_sql('CC-02', 'An overview.', via => 'granola'),
     'via must be ui or claude')
) as v(what, stmt, want);
select results_eq(
    $$ select (select count(*)::integer from public.interviews), (select count(*)::integer from public.interview_transcripts),
              (select status from public.contacts where person_code = 'CC-02') $$,
    $$ values (1, 1, 'to-contact') $$,
    'case 11: after the refusals there is one interview, one transcript, and the person is still to-contact');

-- -------------------------------------------------------- 12 the quote rule
select matches(pg_temp.call(pg_temp.save_sql('CC-02',
        E'She said "the nurse said the scanner was down again" which matters.\n'
        || E'A short "totally made up" remark of three words is not checked.\n'
        || E'Curly marks work too: “I waited six hours in the lobby”.\n'
        || E'A quote that runs over\ntwo lines of the overview: "nobody told\nus why".\n'
        || 'An empty pair "" and a quote opened curly and closed straight: ' || E'\u201Cnobody told us why".',
        interviewer => 'bravo', source => 'other')),
    '^[0-9]+$',
    'case 12: a quote split by a line break in the transcript passes, a three word passage is not checked, a curly quoted passage that is there passes');
select is((select interviewer_id from public.interviews where contact_id = pg_temp.pid('CC-02')), pg_temp.sid('bravo'),
          'case 12: and the interview is saved for the interviewer named');
select is(pg_temp.refused(pg_temp.save_sql('CC-03', E'She said “this was never said at all”.')),
          'this quote in the overview is not word for word in the transcript: "this was never said at all"',
          'case 12: a curly quoted passage is checked');
select is(pg_temp.refused(pg_temp.save_sql('CC-03', 'She said "we were told nothing at all" once.')),
          'this quote in the overview is not word for word in the transcript: "we were told nothing at all"',
          'case 12: a quote of four words or more that is not there is refused');
select is(pg_temp.refused(pg_temp.save_sql('CC-03', 'She said "down again, and nobody knew".')),
          'this quote in the overview is not word for word in the transcript: "down again, and nobody knew"',
          'case 12: a quote of exactly five words that is not there is refused');
select is(pg_temp.refused(pg_temp.save_sql('CC-03', 'She is 5'' 10" tall and said "we never had any trouble at all" once.')),
          'the overview has an odd number of double quotation marks, so its quotes cannot be told apart: close the open one, or write a lone mark another way',
          'case 12: a lone mark before a quote, which would pair the marks wrongly and leave the quote unchecked, is refused');
select is(pg_temp.refused(pg_temp.save_sql('CC-03', 'A lone mark at the very end "')),
          'the overview has an odd number of double quotation marks, so its quotes cannot be told apart: close the open one, or write a lone mark another way',
          'case 12: a lone mark anywhere is refused');
select is((select status from public.contacts where person_code = 'CC-03'), 'to-contact',
          'case 12: the person the refused interviews were for is still to-contact');

-- ------------------------------------------------------ 19 update_overview
create temp table before_update as
select t.sha256, t.chars from public.interview_transcripts t where t.interview_id = (select id::bigint from saved);
select is(pg_temp.call(format($$ select public.update_overview(%s, %L, %L::jsonb, 'claude')::text $$, (select id from saved),
              E'## Who\nMaria.\n\n## Quotes\n"Then the nurse said the scanner was down again"\n',
              '[{"hypothesis": "H3", "stance": "contradicts", "why": "the scanner, not the queue"}]')),
          format('{"hypotheses": 1, "interview_id": %s}', (select id from saved)),
          'case 19: update_overview is accepted');
select is((select overview from public.interviews where id = (select id::bigint from saved)),
          E'## Who\nMaria.\n\n## Quotes\n"Then the nurse said the scanner was down again"\n',
          'case 19: the overview is the new one, as written');
select results_eq(
    $$ select hypothesis, stance, why from public.interview_hypotheses
       where interview_id = (select id::bigint from saved) order by hypothesis $$,
    $$ values ('H3', 'contradicts', 'the scanner, not the queue') $$,
    'case 19: the links are replaced');
select results_eq(
    $$ select t.sha256, t.chars from public.interview_transcripts t where t.interview_id = (select id::bigint from saved) $$,
    $$ select sha256, chars from before_update $$,
    'case 19: the transcript''s sha256 is the same before and after');
select is(pg_temp.call(format($$ select public.update_overview(%s, 'Shorter.') ->> 'hypotheses' $$, (select id from saved))),
          '1', 'case 19: with no hypotheses given the links are left as they are');
select is(pg_temp.call(format($$ select public.update_overview(%s, 'Shorter.', '[]') ->> 'hypotheses' $$, (select id from saved))),
          '0', 'case 19: an empty list removes the links');
select is(pg_temp.refused(v.stmt), v.want, 'case 19: update_overview refused, ' || v.what)
from (values
    ('a bad quote', format($$ select public.update_overview(%s, 'She said "we never had any trouble" once.') $$, (select id from saved)),
     'this quote in the overview is not word for word in the transcript: "we never had any trouble"'),
    ('an empty overview', format($$ select public.update_overview(%s, '') $$, (select id from saved)), 'the overview is empty'),
    ('a bad stance', format($$ select public.update_overview(%s, 'Fine.', '[{"hypothesis": "H1", "stance": "yes"}]') $$, (select id from saved)),
     'stance ''yes'' is not allowed: use supports, contradicts or unclear'),
    ('an unknown interview', $$ select public.update_overview(999999, 'Fine.') $$, 'no interview has the id 999999'),
    ('no interview id', $$ select public.update_overview(null, 'Fine.') $$, 'the interview id is empty'),
    ('via that is neither ui nor claude', format($$ select public.update_overview(%s, 'Fine.', null, 'x') $$, (select id from saved)),
     'via must be ui or claude')
) as v(what, stmt, want);
select is((select overview from public.interviews where id = (select id::bigint from saved)), 'Shorter.',
          'case 19: after the refusals the overview is as it was');
select results_eq(
    $$ select t.sha256, t.chars from public.interview_transcripts t where t.interview_id = (select id::bigint from saved) $$,
    $$ select sha256, chars from before_update $$,
    'case 19: and the transcript is still the same');

-- no action changes a transcript: no function of ours writes interview_transcripts but the one insert
select is(
    (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~* 'update\s+public\.interview_transcripts'),
    0, 'case 19: no function updates a transcript');

-- ------------------------------------------------------------ at the limits
select matches(pg_temp.call(pg_temp.save_sql('CC-03', repeat('o', 100000), $$repeat('x ', 2500000)$$)), '^[0-9]+$',
               'edge: an overview of exactly 100,000 characters and a transcript of exactly 5,000,000 are accepted');
select results_eq(
    $$ select char_length(i.overview), t.chars from public.interviews i
       join public.interview_transcripts t on t.interview_id = i.id where i.contact_id = pg_temp.pid('CC-03') $$,
    $$ values (100000, 5000000) $$,
    'edge: and stored whole');

select * from finish();
rollback;
