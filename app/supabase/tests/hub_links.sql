-- team hub, issue 25 (B6), from the router's note: the link columns of
-- contacts and companies hold nothing or a web address.
-- pgTAP. Run by scripts/dbtest.sh in the db workflow, against a throwaway
-- stack, as the database owner. Everything here is rolled back at the end.
begin;
select no_plan();

create function pg_temp.sid(h text) returns bigint language sql as
    $$ select id from public.sales where handle = h $$;

-- Runs one statement as a signed in teammate and says what happened: the
-- single value it returned, 'ok' when none, or 'ERROR ' and the SQLSTATE.
create function pg_temp.as_teammate(mail text, stmt text) returns text language plpgsql as $$
declare
    r text;
begin
    perform set_config('request.jwt.claims',
        json_build_object('sub', (select user_id from public.sales where email = mail),
                          'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
        execute stmt into r;
        r := coalesce(r, 'ok');
    exception when others then
        r := 'ERROR ' || sqlstate;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);
    return r;
end $$;

insert into public.user_invitations (user_id) values ('00000000-0000-4000-8000-0000000000d1');
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'alpha@example.org');
select public.set_teammate_handle('alpha@example.org', 'alpha');

insert into public.companies (name, sales_id) values ('Link Clinic', pg_temp.sid('alpha'));
insert into public.contacts (first_name, last_name, sales_id) values ('Lin', 'Ked', pg_temp.sid('alpha'));
create temp table person as select id from public.contacts where first_name = 'Lin';
create temp table company as select id from public.companies where name = 'Link Clinic';
grant select on person, company to public;

-- ------------------------------------------------ refused: other schemes
select throws_ok(format($$ insert into public.contacts (first_name, last_name, sales_id, linkedin_url)
                           values ('Bad', 'Link', %s, %L) $$, pg_temp.sid('alpha'), v),
                 '23514', null, 'contacts.linkedin_url refuses on insert: ' || v)
from unnest(array['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)',
                  'data:text/html,<script>alert(1)</script>', 'javascript:alert(1)//linkedin.com/in/x',
                  'mailto:x@example-test.example.org', '//evil.example', 'https://', 'https:// space.example']) v;
select throws_ok(format($$ update public.contacts set linkedin_url = %L where id = (select id from person) $$, v),
                 '23514', null, 'contacts.linkedin_url refuses on update: ' || v)
from unnest(array['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=']) v;
select throws_ok(format($$ insert into public.companies (name, sales_id, %I) values ('Bad Co', %s, %L) $$,
                        col, pg_temp.sid('alpha'), v),
                 '23514', null, 'companies.' || col || ' refuses on insert: ' || v)
from unnest(array['linkedin_url', 'website']) col,
     unnest(array['javascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) v;
select throws_ok(format($$ update public.companies set %I = %L where id = (select id from company) $$, col, v),
                 '23514', null, 'companies.' || col || ' refuses on update: ' || v)
from unnest(array['linkedin_url', 'website']) col,
     unnest(array['javascript:alert(1)', 'data:text/html,<b>x</b>']) v;
select throws_ok(format($$ update public.companies set context_links = %L::json where id = (select id from company) $$, v),
                 '23514', null, 'companies.context_links refuses: ' || v)
from unnest(array['["https://ok.example", "javascript:alert(1)"]', '["data:text/html,x"]',
                  '"https://not-a-list.example"', '[1]', '[{"href": "https://x.example"}]']) v;
select throws_ok(format($$ insert into public.companies (name, sales_id, context_links)
                    values ('Bad Co', %s, '["javascript:alert(1)"]') $$, pg_temp.sid('alpha')),
                 '23514', null, 'companies.context_links refuses on insert');

-- --------------------------------------------- accepted: links and empty
update public.contacts set linkedin_url = 'https://www.linkedin.com/in/lin' where id = (select id from person);
select is((select linkedin_url from public.contacts where id = (select id from person)),
          'https://www.linkedin.com/in/lin', 'an ordinary https link is kept as written');
update public.contacts set linkedin_url = 'HTTP://Example.test/x?y=1#z' where id = (select id from person);
select is((select linkedin_url from public.contacts where id = (select id from person)),
          'HTTP://Example.test/x?y=1#z', 'http in capitals is a web address');
update public.contacts set linkedin_url = '' where id = (select id from person);
select is((select linkedin_url from public.contacts where id = (select id from person)), '', 'empty is accepted');
update public.contacts set linkedin_url = null where id = (select id from person);
select is((select linkedin_url from public.contacts where id = (select id from person)), null, 'null is accepted');

update public.companies set website = 'https://clinic.example', linkedin_url = 'https://linkedin.com/company/c',
                            context_links = '["https://a.example", "", null]'
    where id = (select id from company);
select is((select website::text || ' ' || linkedin_url || ' ' || context_links::text
           from public.companies where id = (select id from company)),
          'https://clinic.example https://linkedin.com/company/c ["https://a.example","",null]',
          'ordinary links on a company are kept');
update public.companies set website = '', linkedin_url = '', context_links = null where id = (select id from company);
select is((select coalesce(website::text, 'null') || '|' || linkedin_url from public.companies where id = (select id from company)),
          '|', 'empty website and linkedin_url are accepted');

-- ----------------------------------------- a bare address gets https://
update public.companies set website = 'clinic.example', linkedin_url = 'linkedin.com/company/c',
                            context_links = '["a.example/x", "https://b.example"]'
    where id = (select id from company);
select is((select website::text || ' ' || linkedin_url || ' ' || context_links::text
           from public.companies where id = (select id from company)),
          'https://clinic.example https://linkedin.com/company/c ["https://a.example/x","https://b.example"]',
          'a bare address on a company is given https://, as upstream''s form allows it');
insert into public.contacts (first_name, last_name, sales_id, contact_key)
    values ('Bare', 'Key', pg_temp.sid('alpha'), 'linkedin.com/in/bare');
select is((select linkedin_url from public.contacts where first_name = 'Bare'), 'https://linkedin.com/in/bare',
          'a LinkedIn address given as the contact detail is filed with https://');

-- ------------------------------------------ as a signed in teammate
select is(pg_temp.as_teammate('alpha@example.org',
              $$ with i as (insert into public.companies (name, website) values ('Team Co', 'team.example')
                            returning website) select website::text from i $$),
          'https://team.example', 'a teammate saving a company with a bare website gets https://');
select is(pg_temp.as_teammate('alpha@example.org',
              $$ insert into public.companies (name, website) values ('Bad Team Co', 'javascript:alert(1)') $$),
          'ERROR 23514', 'a teammate saving javascript: as a website is refused');
select is(pg_temp.as_teammate('alpha@example.org',
              $$ select (public.add_person('Ada Link', contact => 'linkedin.com/in/ada-link')->>'person_code') like 'SK-%' $$),
          'true', 'add_person with a bare LinkedIn address works for a teammate');
select is((select linkedin_url from public.contacts where first_name = 'Ada'), 'https://linkedin.com/in/ada-link',
          'and the address is filed with https://');
select is(pg_temp.as_teammate('alpha@example.org',
              $$ select public.add_person('Eve Link', contact => 'javascript:alert(1)//linkedin.com')->>'person_code' $$),
          'ERROR 23514', 'add_person with a javascript: address that names linkedin.com is refused');

-- ------------------------------------------ issue 64: contacts.links
select throws_ok(format($$ update public.contacts set links = %L::text[] where id = (select id from person) $$, v),
                 '23514', null, '64 case 14: contacts.links refuses on update: ' || v)
from unnest(array['{javascript:alert(1)}', '{https://ok.example,javascript:alert(1)}', '{data:text/html;base64,PHNjcmlwdD4=}',
                  '{""}', '{NULL}', '{"https://a.example https://b.example"}', '{https://}', '{ok.example/path}']) v;
select throws_ok(format($$ insert into public.contacts (first_name, last_name, sales_id, links)
                           values ('Bad', 'Links', %s, array['javascript:alert(1)']) $$, pg_temp.sid('alpha')),
                 '23514', null, '64 case 14: contacts.links refuses javascript: on insert');
select is(pg_temp.as_teammate('alpha@example.org',
              $$ update public.contacts set links = array['javascript:alert(1)'] where first_name = 'Lin' $$),
          'ERROR 23514', '64 case 14: a teammate writing javascript: into links is refused');
update public.contacts set links = array['https://ok.example/a', 'HTTP://ok.example/b'] where id = (select id from person);
select is((select links from public.contacts where id = (select id from person)),
          array['https://ok.example/a', 'HTTP://ok.example/b'], '64 case 14: web addresses are accepted in links');
select is((select links from public.contacts where first_name = 'Bare'), '{}'::text[],
          '64: a person saved with no links has an empty list, not null');

-- ---------------------------------------------- the rule in the catalog
select is((select count(*)::integer from pg_constraint
           where conname in ('contacts_linkedin_url_is_web', 'companies_linkedin_url_is_web', 'companies_website_is_web',
                             'contacts_links_are_web')
               and contype = 'c' and convalidated),
          4, 'the four checks exist and hold for every row');

select * from finish();
rollback;
