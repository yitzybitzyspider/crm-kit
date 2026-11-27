-- team hub, issue 95: the library (hypotheses, research, competition,
-- diagrams) as the hub reads it. pgTAP, run by scripts/dbtest.sh against a
-- throwaway stack, as the database owner. Everything here is rolled back.
--
-- Test case 1 of the issue: library_sync upserts, deletes pages whose file is
-- gone, is all or nothing on bad input, and is refused to every API role; row
-- security lets a switched on teammate read and refuses anon, a switched off
-- teammate and a sign-in that is no teammate.
begin;
select no_plan();

-- ---------------------------------------------------------------- helpers
-- What a statement raised: the message, or 'ok' when it raised nothing.
create function pg_temp.raised(stmt text) returns text language plpgsql as $$
begin
    execute stmt;
    return 'ok';
exception when others then
    return sqlerrm;
end $$;

-- Runs one statement as another role and says what happened: the single
-- value it returned, 'ok' when it returned none, or 'ERROR ' and the SQLSTATE.
create function pg_temp.try_as(role_name text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    execute format('set local role %I', role_name);
    begin
        execute stmt into r;
        r := coalesce(r, 'ok');
    exception when others then
        r := 'ERROR ' || sqlstate;
    end;
    execute 'reset role';
    return r;
end $$;

create function pg_temp.login(mail text) returns void language sql as
    $$ select set_config('request.jwt.claims',
           json_build_object('sub', (select user_id from public.sales where email = mail),
                             'role', 'authenticated')::text, true) $$;

create function pg_temp.login_as(uid uuid) returns void language sql as
    $$ select set_config('request.jwt.claims',
           json_build_object('sub', uid, 'role', 'authenticated')::text, true) $$;

-- One page as the sync script sends it.
create function pg_temp.page(path text, body text default 'Body.', title text default null,
                             sha text default repeat('a', 40)) returns jsonb language sql as
    $$ select jsonb_build_object('path', path, 'section', split_part(path, '/', 1),
                                 'title', coalesce(title, path), 'body', body, 'commit', sha) $$;

-- The whole library as one line, to show a refused sync changed nothing.
create function pg_temp.library() returns text language sql as
    $$ select coalesce(string_agg(path || '|' || section || '|' || title || '|' || md5(body) || '|' || commit,
                                  '; ' order by path), '')
       from public.library_pages $$;

-- --------------------------------------------------------------- fixtures
insert into public.user_invitations (user_id) values
    ('00000000-0000-4000-8000-0000000095a1'), ('00000000-0000-4000-8000-0000000095a2');
insert into auth.users (id, email) values
    ('00000000-0000-4000-8000-0000000095a1', 'library-on@example.org'),
    ('00000000-0000-4000-8000-0000000095a2', 'library-off@example.org');
update public.sales set disabled = (email = 'library-off@example.org') where email like 'library-%@example.org';

-- ----------------------------------------------------------- the table
select has_table('public', 'library_pages', 'the table library_pages exists');
select col_type_is('public', 'library_pages', c.col, c.ty, 'library_pages.' || c.col || ' is ' || c.ty)
from (values ('path', 'text'), ('section', 'text'), ('title', 'text'), ('body', 'text'),
             ('commit', 'text'), ('updated_at', 'timestamp with time zone')) c(col, ty);
select col_is_pk('public', 'library_pages', 'path', 'a page is known by its path, once');
select is((select relrowsecurity from pg_class where oid = 'public.library_pages'::regclass), true,
          'row security is on for library_pages');

-- ------------------------------------------------------------- the sync
select is(public.library_sync(jsonb_build_array(
              pg_temp.page('hypotheses/hypotheses.md', '# Hypotheses', 'Hypotheses'),
              pg_temp.page('research/sepsis-ed.md', 'Old words.'),
              pg_temp.page('diagrams/ecosystem.md', 'A diagram.'))),
          '{"pages": 3, "added": 3, "changed": 0, "removed": 0}'::jsonb,
          'a first sync adds every page and says so');
select is((select count(*)::integer from public.library_pages), 3, 'three pages are on file');
select is((select section || ' ' || title from public.library_pages where path = 'hypotheses/hypotheses.md'),
          'hypotheses Hypotheses', 'a page keeps its section and title');

-- a file renamed and another changed: the old path goes, the new one comes
select is(public.library_sync(jsonb_build_array(
              pg_temp.page('hypotheses/hypotheses.md', '# Hypotheses', 'Hypotheses', repeat('b', 40)),
              pg_temp.page('research/sepsis-in-the-ed.md', 'Old words.', sha => repeat('b', 40)),
              pg_temp.page('diagrams/ecosystem.md', 'A new diagram.', sha => repeat('b', 40)))),
          '{"pages": 3, "added": 1, "changed": 1, "removed": 1}'::jsonb,
          'a renamed file is one page added and one removed; a changed body is one page changed');
select is((select string_agg(path, ', ' order by path) from public.library_pages),
          'diagrams/ecosystem.md, hypotheses/hypotheses.md, research/sepsis-in-the-ed.md',
          'the renamed page is under its new path only');
select is((select body from public.library_pages where path = 'diagrams/ecosystem.md'), 'A new diagram.',
          'the changed page holds the new body');
select is((select count(*)::integer from public.library_pages where commit = repeat('b', 40)), 3,
          'every page says the commit of the latest sync');

-- a file deleted
select is(public.library_sync(jsonb_build_array(
              pg_temp.page('hypotheses/hypotheses.md', '# Hypotheses', 'Hypotheses', repeat('c', 40)),
              pg_temp.page('diagrams/ecosystem.md', 'A new diagram.', sha => repeat('c', 40)))),
          '{"pages": 2, "added": 0, "changed": 0, "removed": 1}'::jsonb,
          'a deleted file is one page removed');
select is((select count(*)::integer from public.library_pages where path like 'research/%'), 0,
          'the deleted file''s page is gone');

-- markdown with a script tag is kept exactly as written: the screens decide how to show it
select is(public.library_sync(jsonb_build_array(
              pg_temp.page('hypotheses/hypotheses.md', '# Hypotheses', 'Hypotheses', repeat('d', 40)),
              pg_temp.page('diagrams/ecosystem.md', 'A new diagram.', sha => repeat('d', 40)),
              pg_temp.page('competition/acme.md', E'# Acme\n<script>alert(1)</script>\n$lib$ and $$', 'Acme',
                           repeat('d', 40))))->>'added',
          '1', 'a page with a script tag and dollar signs is taken');
select is((select body from public.library_pages where path = 'competition/acme.md'),
          E'# Acme\n<script>alert(1)</script>\n$lib$ and $$', 'its body is stored unchanged');

-- --------------------------------------------- all or nothing on bad input
create temp table before_bad as select pg_temp.library() as lib;
grant select on before_bad to public;
create temp table bad (name text primary key, stmt text, sentence text);
insert into bad values
    ('not a list', $$select public.library_sync('{"path": "x"}')$$,
     'pages must be a list of pages'),
    ('null', $$select public.library_sync(null)$$,
     'pages must be a list of pages'),
    ('empty', $$select public.library_sync('[]')$$,
     'pages is empty: a sync never empties the whole library'),
    ('not an object', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md'), '"text"'::jsonb))$$,
     'page 2: must be an object with path, section, title, body and commit'),
    ('missing key', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md'), pg_temp.page('research/b.md') - 'body'))$$,
     'page 2: missing body'),
    ('unknown key', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md') || '{"owner": "x"}'))$$,
     'page 1: unknown key owner: use path, section, title, body and commit'),
    ('not text', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md') || '{"body": 7}'))$$,
     'page 1: body must be text'),
    ('section', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md') || '{"section": "people"}'))$$,
     'page 1: section people is not one of hypotheses, research, competition, diagrams'),
    ('path outside', $$select public.library_sync(jsonb_build_array(pg_temp.page('people/a.md') || '{"section": "research"}'))$$,
     'page 1: the path people/a.md is not a .md file under research/'),
    ('path dots', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/../people/a.md')))$$,
     'page 1: the path research/../people/a.md is not a .md file under research/'),
    ('not md', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.pdf')))$$,
     'page 1: the path research/a.pdf is not a .md file under research/'),
    ('commit', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md', sha => 'abc')))$$,
     'page 1: commit must be a full git sha (40 lowercase hex characters)'),
    ('title', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md', title => '  ')))$$,
     'page 1: the title is empty'),
    ('duplicate', $$select public.library_sync(jsonb_build_array(pg_temp.page('research/a.md'), pg_temp.page('research/a.md')))$$,
     'the path research/a.md is given twice');
grant select on bad to public;
select is(pg_temp.raised(stmt), sentence, 'bad input, ' || name || ': refused with its sentence') from bad order by name;
select is(pg_temp.library(), (select lib from before_bad),
          'after every refusal the library is exactly as it was: a refused sync changes nothing');
-- the good page first, the bad one second: the good one is not kept either
select is((select count(*)::integer from public.library_pages where path = 'research/a.md'), 0,
          'a good page sent with a bad one is not kept');

-- ------------------------------------------------- refused to API roles
select ok(not has_function_privilege(r, 'public.library_sync(jsonb)', 'execute'),
          'library_sync: ' || r || ' cannot execute it')
from unnest(array['anon', 'authenticated', 'service_role', 'hub_export']) r;
select pg_temp.login('library-on@example.org');
select is(pg_temp.try_as(r, format('select public.library_sync(%L::jsonb)::text', jsonb_build_array(pg_temp.page('research/x.md')))),
          'ERROR 42501', 'acting as ' || r || ', library_sync is refused')
from unnest(array['anon', 'authenticated']) r;

-- ------------------------------------------------------------ who reads
select pg_temp.login('library-on@example.org');
select is(pg_temp.try_as('authenticated', 'select count(*)::text from public.library_pages'), '3',
          'a switched on teammate reads every page');
select is(pg_temp.try_as('authenticated', $$select body from public.library_pages where path = 'diagrams/ecosystem.md'$$),
          'A new diagram.', 'a switched on teammate reads a page''s body');
select pg_temp.login('library-off@example.org');
select is(pg_temp.try_as('authenticated', 'select count(*)::text from public.library_pages'), '0',
          'a switched off teammate reads nothing');
-- a sign-in with no teammate behind it: no sales row has this user id
select pg_temp.login_as('00000000-0000-4000-8000-0000000095a3');
select is(pg_temp.try_as('authenticated', 'select count(*)::text from public.library_pages'), '0',
          'a sign-in that is no teammate reads nothing');
select is(pg_temp.try_as('anon', 'select count(*)::text from public.library_pages'), 'ERROR 42501',
          'anon is refused a read');
select ok(not has_table_privilege('hub_export', 'public.library_pages', 'select'),
          'the export role cannot read the library (it is in the repo already)');

-- nobody writes it directly
select pg_temp.login('library-on@example.org');
select is(pg_temp.try_as(r, s.stmt), 'ERROR 42501', 'acting as ' || r || ', ' || s.what || ' is refused')
from unnest(array['anon', 'authenticated']) r,
     (values ('an insert', $$insert into public.library_pages (path, section, title, body, commit)
                            values ('research/z.md', 'research', 'z', 'z', repeat('e', 40))$$),
             ('an update', $$update public.library_pages set body = 'changed'$$),
             ('a delete', $$delete from public.library_pages$$)) s(what, stmt);
select is((select body from public.library_pages where path = 'diagrams/ecosystem.md'), 'A new diagram.',
          'after the refused writes the page is unchanged');

select * from finish();
rollback;
