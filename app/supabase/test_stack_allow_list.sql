-- team hub, issue 40 item 11: the sign-up list of a throwaway test stack.
-- Applied by .github/actions/hub-stack, scripts/dbtest.sh and the app
-- workflow right after a stack on this runner starts. Never applied to the
-- cloud project: scripts/migrate.sh applies migrations only.
--
-- The two domains end in .test, a name reserved for tests: no real mailbox
-- can have it, and the list refuses any other domain entry. The two exact
-- addresses are the ones upstream's own end to end tests sign in with.
insert into hub_private.signup_allow_list (entry) values
    ('@hub.test'),
    ('@example.test'),
    ('john@doe-com.example.org'),
    ('marie@curie-com.example.org')
on conflict (entry) do nothing;
