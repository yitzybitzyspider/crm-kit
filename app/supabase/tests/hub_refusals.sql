-- team hub, issue 40 items 1 and 14: refusal sentences that had no test,
-- and the refusal of a new attachment on a deal note. pgTAP, run by
-- scripts/dbtest.sh in the db workflow against a throwaway stack, as the
-- database owner. Everything here is rolled back at the end.
--
-- Each sentence is proven twice: once that the check refuses with its words,
-- and once, at the end of the file, that the same call goes through when the
-- check is broken on purpose (the function is made again from its own
-- definition with the check's condition replaced by false). The second half
-- shows the first would fail on a real fault. Both are rolled back.
begin;
select no_plan();

-- What a statement raised: the message, or 'ok' when it raised nothing.
create function pg_temp.raised(stmt text) returns text language plpgsql as $$
begin
    execute stmt;
    return 'ok';
exception when others then
    return sqlerrm;
end $$;

-- Makes a function again with one piece of its text replaced. Stops if the
-- piece is not in it, so a broken check can never pass by changing nothing.
create function pg_temp.break_check(fn regprocedure, piece text, replacement text) returns void
    language plpgsql as $$
declare
    def text := pg_get_functiondef(fn);
begin
    if position(piece in def) = 0 then
        raise exception 'the check "%" is not in %', piece, fn;
    end if;
    execute replace(def, piece, replacement);
end $$;

create function pg_temp.login(mail text) returns void language sql as
    $$ select set_config('request.jwt.claims',
           json_build_object('sub', (select user_id from public.sales where email = mail),
                             'role', 'authenticated')::text, true) $$;

-- ------------------------------------------------------------- fixtures
insert into public.user_invitations (user_id) values ('00000000-0000-4000-8000-0000000040b1');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000040b1', 'refusals@example.org');
select public.set_teammate_handle('refusals@example.org', 'alpha');

create temp table calls (name text primary key, stmt text, sentence text);
insert into calls values
    ('reported_chars', $$select public.hub_check_transcript('paste', repeat('a', 1000), -1)$$,
     'reported_chars cannot be negative'),
    ('source', $$select public.hub_check_transcript('  ', repeat('a', 1000), 1000)$$,
     'the source is empty: use granola, paste or other'),
    ('confirm inbox id', $$select public.confirm_recording(null, 'AA-01', true, 'claude')$$,
     'the inbox id is empty'),
    ('dismiss inbox id', $$select public.dismiss_recording(null, 'not ours', 'claude')$$,
     'the inbox id is empty'),
    ('hypotheses', $$select public.hub_check_hypotheses((select jsonb_agg(jsonb_build_object('hypothesis', 'H' || i, 'stance', 'supports', 'why', 'w')) from generate_series(1, 51) i))$$,
     'hypotheses is too long: 51 links, the limit is 50'),
    ('attendees', $$select public.hub_addresses((select array_agg('a' || i || '@x.example') from generate_series(1, 201) i))$$,
     'the attendee list is too long: 201 addresses, the limit is 200'),
    ('find_person', $$select public.find_person(repeat('q', 301), 'claude')$$,
     'the query is too long: 301 characters, the limit is 300'),
    ('no handle', $$select public.hub_teammate('bravo', 'owner', null)$$,
     'owner ''bravo'' has no handle on file yet: an administrator sets it after their first sign-in');
grant select on calls to public;

-- ------------------------------------------------------- the sentences
select pg_temp.login('refusals@example.org');
select is(pg_temp.raised(stmt), sentence, 'issue 40 item 1: ' || name || ' is refused with its sentence')
from calls order by name;

-- the edge of each limit is still taken
select is(pg_temp.raised($$select public.hub_check_hypotheses((select jsonb_agg(jsonb_build_object('hypothesis', 'H' || i, 'stance', 'supports', 'why', 'w')) from generate_series(1, 50) i))$$),
    'ok', 'issue 40 item 1: 50 hypothesis links are taken');
select is(pg_temp.raised($$select public.hub_addresses((select array_agg('a' || i || '@x.example') from generate_series(1, 200) i))$$),
    'ok', 'issue 40 item 1: 200 attendees are taken');
select is(pg_temp.raised($$select public.find_person(repeat('q', 300), 'claude')$$),
    'ok', 'issue 40 item 1: a query of 300 characters is taken');
select is(pg_temp.raised($$select public.hub_check_transcript('paste', repeat('a', 1000), 0)$$),
    'ok', 'issue 40 item 1: reported_chars of 0 is taken');

-- ------------------------------------- item 14: a deal note, too
select set_config('request.jwt.claims', '', true);
insert into public.deals (name, stage, sales_id) values ('Refusals deal', 'opportunity', (select id from public.sales where handle = 'alpha'));
select is(pg_temp.raised($$insert into public.deal_notes (deal_id, text, attachments)
        values ((select id from public.deals where name = 'Refusals deal'), 'note', array['{"src": "https://x.example/a.pdf"}'::jsonb])$$),
    'files are not attached to a note in the hub: write what the file says in the note',
    'issue 40 item 14: a deal note with an attachment is refused');
select is(pg_temp.raised($$insert into public.deal_notes (deal_id, text)
        values ((select id from public.deals where name = 'Refusals deal'), 'note')$$),
    'ok', 'issue 40 item 14: a deal note without one is saved');
select is((select public from storage.buckets where id = 'attachments'), false,
    'issue 40 item 14: the attachments bucket is private');

-- ------------------------------------------ each check broken on purpose
select pg_temp.break_check('public.hub_check_transcript(text, text, integer)', 'if $3 is not null and $3 < 0 then', 'if false then');
select pg_temp.break_check('public.hub_check_transcript(text, text, integer)', 'if v_source = '''' then', 'if false then');
select pg_temp.break_check('public.confirm_recording(bigint, text, boolean, text, text)', 'if $1 is null then', 'if false then');
select pg_temp.break_check('public.dismiss_recording(bigint, text, text)', 'if $1 is null then', 'if false then');
select pg_temp.break_check('public.hub_check_hypotheses(jsonb)', 'if jsonb_array_length($1) > 50 then', 'if false then');
select pg_temp.break_check('public.hub_addresses(text[])', 'if coalesce(cardinality($1), 0) > 200 then', 'if false then');
select pg_temp.break_check('public.find_person(text, text)', 'if char_length(v_q) > 300 then', 'if false then');
select pg_temp.break_check('public.hub_teammate(text, text, public.sales)', 'if not found then', 'if false then');

select pg_temp.login('refusals@example.org');
select isnt(pg_temp.raised(stmt), sentence, 'issue 40 item 1: with its check broken, ' || name || ' is no longer refused with its sentence')
from calls order by name;

select * from finish();
rollback;
