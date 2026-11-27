-- team hub, issue 22 (B3): the audit table.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner. Everything here is rolled back at the end.
-- The numbers in the descriptions are the test cases of issue 22.
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

-- the owner may act as the export role for these tests only (rolled back)
do $$
begin
    if not pg_has_role(current_user, 'hub_export', 'member') then
        execute format('grant hub_export to %I', current_user);
    end if;
end $$;

-- How many audit rows match: who, via, action, table, row id.
create function pg_temp.audit(p_handle text, p_via text, p_action text, p_table text, p_row text) returns integer
    language sql as $$
    select count(*)::integer from public.audit_log a
    where a.actor_handle is not distinct from p_handle and a.via = p_via and a.action = p_action
        and a.table_name = p_table and a.row_id = p_row
$$;
-- The one audit row for an action on a table row, as old and new values of one field.
create function pg_temp.change(p_action text, p_table text, p_row text, p_field text) returns text
    language sql as $$
    select string_agg(coalesce(a.old_row ->> p_field, '(none)') || ' -> ' || coalesce(a.new_row ->> p_field, '(none)'),
                      ' ; ' order by a.id)
    from public.audit_log a
    where a.action = p_action and a.table_name = p_table and a.row_id = p_row
$$;

-- ------------------------------------------------- the table and its triggers
select has_table('public', 'audit_log', 'the table audit_log exists');
select col_type_is('public', 'audit_log', v.c, v.ty, 'audit_log.' || v.c || ' is ' || v.ty)
from (values ('id', 'bigint'), ('at', 'timestamp with time zone'), ('actor_user_id', 'uuid'), ('actor_handle', 'text'),
             ('via', 'text'), ('action', 'text'), ('table_name', 'text'), ('row_id', 'text'),
             ('old_row', 'jsonb'), ('new_row', 'jsonb')) as v(c, ty);
select is(
    (select string_agg(c.relname, ', ' order by c.relname)
     from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_proc p on p.oid = t.tgfoid
     where not t.tgisinternal and p.proname = 'hub_audit_row' and t.tgname = 'zzz_hub_audit'
         and t.tgtype & 1 = 1 and t.tgtype & 28 = 28 and t.tgenabled = 'O'),
    'call_inbox, companies, contact_notes, contacts, interview_hypotheses, interview_transcripts, interviews, sales',
    'a row trigger for insert, update and delete records every one of the eight tables');
-- setting the handles in the fixtures was a write to sales by the owner with no sign-in
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'sales' and a.action = 'update' and a.via = 'dashboard' and a.actor_user_id is null
               and a.old_row ->> 'handle' is null and a.new_row ->> 'handle' = 'charlie'),
          1, 'case 22: a change to sales by the owner with no sign-in is recorded with via dashboard, old and new handle');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'sales' and a.action = 'insert' and a.new_row ->> 'email' = 'charlie@hub.test'),
          1, 'the sales row made at sign-up is recorded too');

-- ------------------------------------------- 21 each action, who and what
select pg_temp.login('charlie@hub.test');
create temp table n0 as select count(*) as n from public.audit_log;

select is(pg_temp.call($$ select public.add_person('Maria Okafor', null, 'Triage nurse', 'Example Clinic', 'maria@example-com.example.org',
                                                   null, null, 'claude') ->> 'person_code' $$), 'CC-01', 'fixture: add_person');
select is(pg_temp.audit('charlie', 'claude', 'add_person', 'contacts', pg_temp.pid('CC-01')::text), 1,
          'case 21: add_person writes one audit row for the person: caller, via as passed, the action''s name, the table, the row id');
select results_eq(
    $$ select a.actor_user_id, a.old_row is null, a.new_row ->> 'person_code', a.new_row ->> 'status',
              a.new_row ->> 'first_name', a.at is not null
       from public.audit_log a where a.action = 'add_person' and a.table_name = 'contacts' $$,
    $$ select '00000000-0000-4000-8000-0000000000d3'::uuid, true, 'CC-01', 'to-contact', 'Maria', true $$,
    'case 21: with the caller''s user id, no row before and the whole row after');
select is(pg_temp.audit('charlie', 'claude', 'add_person', 'companies',
                        (select id::text from public.companies where name = 'Example Clinic')), 1,
          'case 21: the organization add_person made is recorded under add_person too');

select is(pg_temp.call($$ select public.update_person('CC-01', role => 'Charge nurse', via => 'ui') ->> 'person_code' $$),
          'CC-01', 'fixture: update_person');
select is(pg_temp.audit('charlie', 'ui', 'update_person', 'contacts', pg_temp.pid('CC-01')::text), 1,
          'case 21: update_person writes one audit row, via ui');
select is(pg_temp.change('update_person', 'contacts', pg_temp.pid('CC-01')::text, 'title'), 'Triage nurse -> Charge nurse',
          'case 21: with the role before and after');

select is(pg_temp.call($$ select public.set_owner('CC-01', 'bravo', 'claude') ->> 'owner' $$), 'bravo', 'fixture: set_owner');
select is(pg_temp.audit('charlie', 'claude', 'set_owner', 'contacts', pg_temp.pid('CC-01')::text), 1,
          'case 21: set_owner writes one audit row');
select is(pg_temp.change('set_owner', 'contacts', pg_temp.pid('CC-01')::text, 'sales_id'),
          pg_temp.sid('charlie') || ' -> ' || pg_temp.sid('bravo'), 'case 21: with the owner before and after');

select is(pg_temp.call($$ select public.set_status('CC-01', 'declined', 'ui') ->> 'status' $$), 'declined', 'fixture: set_status');
select is(pg_temp.audit('charlie', 'ui', 'set_status', 'contacts', pg_temp.pid('CC-01')::text), 1,
          'case 21: set_status writes one audit row');
select is(pg_temp.change('set_status', 'contacts', pg_temp.pid('CC-01')::text, 'status'), 'to-contact -> declined',
          'case 21: with the status before and after');
select is(pg_temp.call($$ select public.set_status('CC-01', 'to-contact', 'ui') ->> 'status' $$), 'to-contact', 'fixture: back to to-contact');

-- a touch logged in a teammate's name: the audit row names the real caller
create temp table touch as
select (pg_temp.calljson($$ select public.log_touch('CC-01', 'bravo', null, 'email', 'Sent the intro.', null, null, null, 'claude') $$)
        ->> 'touch_id') as id;
select is(pg_temp.audit('charlie', 'claude', 'log_touch', 'contact_notes', (select id from touch)), 1,
          'case 21: log_touch writes one audit row for the touch, naming the real caller');
select results_eq(
    $$ select a.old_row is null, (a.new_row ->> 'sales_id')::bigint, a.new_row ->> 'channel', a.new_row ->> 'text'
       from public.audit_log a where a.action = 'log_touch' and a.table_name = 'contact_notes' $$,
    $$ select true, pg_temp.sid('bravo'), 'email', 'Sent the intro.' $$,
    'case 21: with the touch as written, in the name of the teammate it was logged for');
select is((select count(*)::integer from public.audit_log a
           where a.action = 'log_touch' and a.table_name = 'contacts' and a.actor_handle = 'charlie' and a.via = 'claude'
               and a.old_row ->> 'status' = 'to-contact' and a.new_row ->> 'status' = 'contacted'),
          1, 'case 21: and one for the person, to-contact before and contacted after');

create temp table iv as
select (pg_temp.calljson($$ select public.save_interview('CC-01', current_date - 2, null, 'paste', null, true,
            'Interview: Maria', 'She said "I waited six hours in the lobby".', pg_temp.transcript(),
            '[{"hypothesis": "H2", "stance": "supports"}]', null, 'claude') $$) ->> 'interview_id') as id;
select is(pg_temp.audit('charlie', 'claude', 'save_interview', v.t, v.row_id), 1,
          'case 21: save_interview writes one audit row for ' || v.t)
from (values ('interviews', (select id from iv)), ('interview_transcripts', (select id from iv)),
             ('interview_hypotheses', (select id from iv) || ':H2'), ('contacts', pg_temp.pid('CC-01')::text)) as v(t, row_id);
select is(pg_temp.change('save_interview', 'contacts', pg_temp.pid('CC-01')::text, 'status'), 'contacted -> interviewed',
          'case 21: the person''s status before and after the interview');

select is(pg_temp.call(format($$ select public.update_overview(%s, 'A corrected overview.', '[{"hypothesis": "H3", "stance": "unclear"}]', 'ui') ->> 'hypotheses' $$,
                              (select id from iv))), '1', 'fixture: update_overview');
select is(pg_temp.audit('charlie', 'ui', 'update_overview', 'interviews', (select id from iv)), 1,
          'case 21: update_overview writes one audit row for the interview');
select is(pg_temp.change('update_overview', 'interviews', (select id from iv), 'overview'),
          'She said "I waited six hours in the lobby". -> A corrected overview.',
          'case 21: with the overview before and after');
select is(pg_temp.change('update_overview', 'interview_hypotheses', (select id from iv) || ':H2', 'stance'), 'supports -> (none)',
          'case 21: the link it removed is recorded, with what it was');
select is(pg_temp.change('update_overview', 'interview_hypotheses', (select id from iv) || ':H3', 'stance'), '(none) -> unclear',
          'case 21: and the link it added');

create temp table inbox as
select (pg_temp.calljson($$ select public.submit_recording('rec-1', 'granola', 'Weekly call', current_date - 1,
            array['stranger@nowhere-example.example.org'], 'An overview.', pg_temp.transcript(), true, null, 1500, 'claude') $$)
        ->> 'inbox_id') as id;
select is(pg_temp.audit('charlie', 'claude', 'submit_recording', 'call_inbox', (select id from inbox)), 1,
          'case 21: submit_recording writes one audit row for the inbox item');
select is(pg_temp.change('submit_recording', 'call_inbox', (select id from inbox), 'state'), '(none) -> waiting',
          'case 21: with no row before and the waiting row after');

select is(pg_temp.call($$ select public.add_person('Alan Turing', null, null, null, 'alan@bletchley-example.example.org') ->> 'person_code' $$),
          'CC-02', 'fixture: a second person');
create temp table sub2 as
select pg_temp.calljson($$ select public.submit_recording('rec-2', 'granola', 'Call with Alan', current_date - 1,
            array['alan@bletchley-example.example.org'], 'An overview.', pg_temp.transcript(), true, null, 1500, 'ui') $$) as r;
select is((select r ->> 'result' from sub2), 'saved', 'fixture: a recording that is saved at submit');
select is(pg_temp.audit('charlie', 'ui', 'submit_recording', v.t, v.row_id), 1,
          'case 21: a recording saved at submit is recorded under submit_recording for ' || v.t)
from (values ('interviews', (select r ->> 'interview_id' from sub2)),
             ('interview_transcripts', (select r ->> 'interview_id' from sub2)),
             ('contacts', pg_temp.pid('CC-02')::text)) as v(t, row_id);

select pg_temp.login('bravo@hub.test');
select is(pg_temp.call($$ select public.add_person('Grace Hopper') ->> 'person_code' $$), 'BB-01', 'fixture: a third person, as bravo');
create temp table conf as
select pg_temp.calljson(format($$ select public.confirm_recording(%s, 'BB-01', true, 'ui') $$, (select id from inbox))) as r;
select is(pg_temp.audit('bravo', 'ui', 'confirm_recording', 'call_inbox', (select id from inbox)), 1,
          'case 21: confirm_recording writes one audit row for the inbox item, as the teammate who confirmed');
select is(pg_temp.change('confirm_recording', 'call_inbox', (select id from inbox), 'state'), 'waiting -> confirmed',
          'case 21: with the state before and after');
select is(pg_temp.audit('bravo', 'ui', 'confirm_recording', 'interviews', (select r ->> 'interview_id' from conf)), 1,
          'case 21: and one for the interview it made');

create temp table inbox2 as
select (pg_temp.calljson($$ select public.submit_recording('rec-3', 'granola', 'Team sync', current_date - 1,
            array['bravo@hub.test'], 'An overview.', pg_temp.transcript(), true, null, 1500, 'claude') $$) ->> 'inbox_id') as id;
select is(pg_temp.call(format($$ select public.dismiss_recording(%s, 'A team meeting.', 'claude') ->> 'state' $$, (select id from inbox2))),
          'dismissed', 'fixture: dismiss_recording');
select is(pg_temp.audit('bravo', 'claude', 'dismiss_recording', 'call_inbox', (select id from inbox2)), 1,
          'case 21: dismiss_recording writes one audit row');
select is(pg_temp.change('dismiss_recording', 'call_inbox', (select id from inbox2), 'reason'),
          'no attendee outside the team -> A team meeting.', 'case 21: with the reason before and after');

create temp table n1 as select count(*) as n from public.audit_log;
select is(pg_temp.call($$ select count(*) from public.find_person('maria', 'claude') $$), '1', 'fixture: find_person');
select is(pg_temp.call(format($$ select count(*) from public.inbox_suggestions(%s) $$, (select id from inbox2))), '0',
          'fixture: inbox_suggestions');
select is((select count(*) from public.audit_log), (select n from n1), 'case 21: the two read only functions write no audit row');
select is((select count(*)::integer from public.audit_log a
           where a.id > (select max(id) from public.audit_log b where b.action = 'add_person' and b.table_name = 'companies')
               and a.action not in ('add_person', 'update_person', 'set_owner', 'set_status', 'log_touch', 'save_interview',
                                    'update_overview', 'submit_recording', 'confirm_recording', 'dismiss_recording')),
          0, 'case 21: every row written by these calls carries the name of a fixed action');
select is((select count(*)::integer from public.audit_log a where a.action = 'log_touch' and a.actor_handle = 'bravo'), 0,
          'case 21: the teammate a touch was logged for is not recorded as its actor');

-- ---------------------------------------------------------- 22 direct writes
select is(pg_temp.call_as('authenticated',
              $$ with u as (update public.contacts set title = 'Rear Admiral' where person_code = 'BB-01' returning 1)
                 select count(*) from u $$), '1', 'fixture: a direct update of a contact as a signed in teammate');
select is(pg_temp.audit('bravo', 'ui', 'update', 'contacts', pg_temp.pid('BB-01')::text), 1,
          'case 22: it is recorded with via ui and action update, and the action that ran before it left no name behind');
select is(pg_temp.change('update', 'contacts', pg_temp.pid('BB-01')::text, 'title'), '(none) -> Rear Admiral',
          'case 22: with the field before and after');
select is(pg_temp.call_as('authenticated', format(
              $$ insert into public.contact_notes (contact_id, text) values (%s, 'A note from the app.') returning id $$,
              pg_temp.pid('BB-01'))) ~ '^[0-9]+$', true, 'fixture: a direct insert of a touch as a signed in teammate');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'contact_notes' and a.action = 'insert' and a.via = 'ui' and a.actor_handle = 'bravo'
               and a.new_row ->> 'text' = 'A note from the app.'),
          1, 'case 22: a direct insert is recorded with via ui and action insert');

select pg_temp.logout();
update public.contacts set title = 'Commodore' where person_code = 'BB-01';
select results_eq(
    $$ select a.actor_user_id, a.actor_handle, a.old_row ->> 'title', a.new_row ->> 'title'
       from public.audit_log a
       where a.table_name = 'contacts' and a.action = 'update' and a.via = 'dashboard' $$,
    $$ values (null::uuid, null::text, 'Rear Admiral', 'Commodore') $$,
    'case 22: a direct update as the owner role with no sign-in is recorded with via dashboard and no actor');
select is(pg_temp.call_as('service_role',
              $$ with u as (update public.contacts set title = 'Captain' where person_code = 'BB-01' returning 1)
                 select count(*) from u $$), '1', 'fixture: a direct update as the service role');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'contacts' and a.action = 'update' and a.via = 'job' and a.actor_user_id is null
               and a.new_row ->> 'title' = 'Captain'),
          1, 'case 22: a direct update as the service role is recorded with via job');
create temp table n2 as select count(*) as n from public.audit_log;
update public.contacts set title = 'Captain' where person_code = 'BB-01';
select is((select count(*) from public.audit_log), (select n from n2), 'an update that changes nothing writes no audit row');
delete from public.interview_hypotheses where hypothesis = 'H3';
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'interview_hypotheses' and a.action = 'delete' and a.via = 'dashboard'
               and a.old_row ->> 'hypothesis' = 'H3' and a.new_row is null),
          1, 'a delete by the owner is recorded, with the row that was there');
insert into public.companies (name) values ('Hand Made Co');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'companies' and a.action = 'insert' and a.via = 'dashboard'
               and a.new_row ->> 'name' = 'Hand Made Co'),
          1, 'an insert by the owner is recorded');
truncate public.interview_hypotheses;
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'interview_hypotheses' and a.action = 'truncate' and a.row_id = '*' and a.via = 'dashboard'),
          1, 'a truncate by the owner of a table that may be truncated is recorded as one line');

-- ------------------------------------------- 23 a transcript is never copied
select is((select count(*)::integer from public.audit_log a
           where a.old_row::text like '%I waited six hours in the lobby before anyone saw me%'
              or a.new_row::text like '%I waited six hours in the lobby before anyone saw me%'
              or a.old_row::text like '%scanner was down again, and nobody told us why%'
              or a.new_row::text like '%scanner was down again, and nobody told us why%'),
          0, 'case 23: no audit row holds a sentence of the transcript');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'interview_transcripts'
               and a.new_row -> 'body' = jsonb_build_object('chars', 1500, 'sha256', public.hub_sha256(pg_temp.transcript()))
               and a.new_row ->> 'chars' = '1500'
               and a.new_row ->> 'sha256' = public.hub_sha256(pg_temp.transcript())),
          3, 'case 23: the audit rows for the three transcripts hold chars and sha256 in place of the text');
select is((select count(*)::integer from public.audit_log a
           where a.table_name = 'call_inbox' and (a.old_row is not null or a.new_row is not null)
               and coalesce(a.new_row, a.old_row) -> 'transcript'
                   = jsonb_build_object('chars', 1500, 'sha256', public.hub_sha256(pg_temp.transcript()))
               and (a.old_row is null or a.old_row -> 'transcript' = a.new_row -> 'transcript')),
          (select count(*)::integer from public.audit_log a where a.table_name = 'call_inbox'),
          'case 23: every audit row for the inbox holds chars and sha256 in place of the transcript, before and after');
select is((select count(*)::integer from public.audit_log a where a.table_name = 'call_inbox'), 4,
          'case 23: and there are four of them: two submits, a confirm and a dismiss');

-- ------------------------------------------- 24 a refused action leaves no row
select pg_temp.login('charlie@hub.test');
create temp table n3 as select count(*) as n from public.audit_log;
select is(pg_temp.refused(v.stmt), v.want, 'case 24: refused and nothing written, ' || v.what)
from (values
    ('add_person', $$ select public.add_person('Maria Okafor') $$,
     'already on file (same name): CC-01, Maria Okafor, owner bravo, status interviewed, last touch ' || current_date || ' by bravo via email'),
    ('update_person', $$ select public.update_person('CC-01', contact => 'alan@bletchley-example.example.org') $$,
     'already on file (same contact): CC-02, Alan Turing, owner charlie, status interviewed, last touch none'),
    ('set_owner', $$ select public.set_owner('CC-01', 'bob') $$, 'owner ''bob'' is not a team handle (see team.json)'),
    ('set_status', $$ select public.set_status('CC-02', 'cold') $$,
     'status ''cold'' is not allowed: use to-contact, contacted, replied, scheduled, interviewed, declined or do-not-contact'),
    ('log_touch', $$ select public.log_touch('CC-01', null, null, 'fax', 'Hello') $$,
     'channel ''fax'' is not allowed: use email, linkedin, phone, text, intro, in-person or other'),
    ('save_interview', $$ select public.save_interview('CC-01', current_date - 2, null, 'paste', null, false, 't', 'o', pg_temp.transcript()) $$,
     'consent to record is not confirmed: an interview is saved only when the person agreed to be recorded'),
    ('update_overview', $$ select public.update_overview(999999, 'o') $$, 'no interview has the id 999999'),
    ('submit_recording', $$ select public.submit_recording('rec-9', 'granola', 't', current_date - 1, array['x@y-example.example.org'], 'o',
                                                           pg_temp.transcript(), true, null, 1501) $$,
     'the transcript is cut short: 1500 of 1501 characters'),
    ('confirm_recording', $$ select public.confirm_recording(999999, 'CC-01', true) $$, 'no inbox item has the id 999999'),
    ('dismiss_recording', $$ select public.dismiss_recording(999999, 'x') $$, 'no inbox item has the id 999999')
) as v(what, stmt, want);
select is((select count(*) from public.audit_log), (select n from n3), 'case 24: ten refused actions left no audit row');

-- --------------------------------------------- 25 the audit log cannot be changed
select pg_temp.logout();
select throws_ok($$ update public.audit_log set via = 'ui' $$, 'P0001', 'the audit log is never changed',
                 'case 25: the owner cannot update audit_log');
select throws_ok($$ update public.audit_log set via = 'ui' where false $$, 'P0001', 'the audit log is never changed',
                 'case 25: not even an update that matches no row');
select throws_ok($$ delete from public.audit_log $$, 'P0001', 'the audit log is never changed',
                 'case 25: the owner cannot delete from audit_log');
select throws_ok($$ delete from public.audit_log where id = (select min(id) from public.audit_log) $$, 'P0001',
                 'the audit log is never changed', 'case 25: not one row');
select throws_ok($$ truncate public.audit_log $$, 'P0001', 'the audit log is never changed',
                 'case 25: the owner cannot truncate audit_log');
select is(pg_temp.call_as('service_role', $$ with d as (delete from public.audit_log returning 1) select count(*) from d $$),
          'ERROR: permission denied for table audit_log', 'case 25: the service role cannot delete from audit_log');

select pg_temp.login('bravo@hub.test');
select is(pg_temp.call_as('authenticated', v.stmt), 'ERROR: permission denied for table audit_log',
          'case 25: a signed in teammate cannot ' || v.what)
from (values
    ('update audit_log', $$ with u as (update public.audit_log set via = 'ui' returning 1) select count(*) from u $$),
    ('delete from audit_log', $$ with d as (delete from public.audit_log returning 1) select count(*) from d $$),
    ('insert into audit_log',
     $$ insert into public.audit_log (via, action, table_name, row_id) values ('ui', 'insert', 'contacts', '1') returning id $$)
) as v(what, stmt);
select is(pg_temp.call_as('authenticated', $$ select (count(*) > 0)::text from public.audit_log $$), 'true',
          'case 25: a signed in teammate can read audit_log');
select pg_temp.logout();
select is(pg_temp.call_as('anon', $$ select count(*) from public.audit_log $$), 'ERROR: permission denied for table audit_log',
          'case 25: anon cannot read audit_log');
select is(pg_temp.call_as('hub_export', $$ select count(*) from public.audit_log $$), 'ERROR: permission denied for table audit_log',
          'case 25: hub_export cannot read audit_log');
select ok(not has_table_privilege('hub_export', 'public.audit_log', 'select, insert, update, delete, truncate'),
          'case 25: hub_export holds nothing on audit_log');
select ok(not has_table_privilege('anon', 'public.audit_log', 'select, insert, update, delete, truncate'),
          'case 25: anon holds nothing on audit_log');
select ok(not has_table_privilege('authenticated', 'public.audit_log', 'insert, update, delete, truncate'),
          'case 25: a signed in teammate holds no write on audit_log');
select is((select string_agg(cmd || ' to ' || array_to_string(roles, ','), '; ') from pg_policies
           where schemaname = 'public' and tablename = 'audit_log'),
          'SELECT to authenticated', 'case 25: audit_log has a read policy for authenticated and no other policy');
select is((select relrowsecurity from pg_class where oid = 'public.audit_log'::regclass), true,
          'case 25: row level security is on for audit_log');
select is((select count(*)::integer from public.audit_log) > 0, true, 'case 25: and every row is still there');

select * from finish();
rollback;
