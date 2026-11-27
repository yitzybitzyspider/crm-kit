#!/usr/bin/env python3
"""Sets up the copy of the Supabase config a throwaway stack is started from.

    python3 stack_config.py <path to the copy's config.toml> off|on [stand-in url]

Used only by .github/workflows/signin.yml, on the copy under
app/.supabase-e2e. It never touches app/supabase/config.toml or
config.e2e.toml: it refuses a path inside app/supabase.

off  sets enable_signup = false in the [auth] section, and nowhere else.
on   leaves sign-ups as upstream has them.
Both raise the stack's own limits on mails per hour (2 when nothing is set),
on sign-ins and on link checks: these tests send more mails to the stack's
mail catcher and sign in more often than the limits allow. This is a setting
of the throwaway stack only; it says nothing about the cloud project, where
the limits are Supabase's. The stack of the workflow's second job is left
alone, limits included.

off  also writes [auth.external.google] with enabled = false (issue 58): the
     Google provider of the throwaway stack is switched off, in so many words.
     And sets enable_confirmations = true in [auth.email], as the cloud project
     has it ("Confirm email" on): with it off, Supabase joins an OAuth sign-in
     to an account by an email the provider did not vouch for.
stand-in url (issue 58), given only with the address of fake_idp.mjs on this
     runner (http://127.0.0.1, localhost or Docker's 172.16/12 bridge):
     switches on Supabase's keycloak provider pointed at it, so the tests can
     sign in through an OAuth provider without Google. Its client id and
     secret are made up here and open nothing.
"""
import re
import sys
from pathlib import Path


def main():
    if len(sys.argv) not in (3, 4) or sys.argv[2] not in ("off", "on"):
        print(__doc__)
        return 2
    path, mode = Path(sys.argv[1]).resolve(), sys.argv[2]
    stand_in = sys.argv[3].rstrip("/") if len(sys.argv) == 4 else ""
    if stand_in and not re.match(
            r"^http://(127\.0\.0\.1|localhost|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?(/[A-Za-z0-9/_-]*)?$",
            stand_in):
        print("refusing: the stand-in provider must be on this runner, not %s" % stand_in)
        return 2
    kept = Path(__file__).resolve().parent.parent / "supabase"
    if kept in path.parents:
        print("refusing: %s is the config kept in git, not a copy" % path)
        return 2
    lines = path.read_text(encoding="utf-8").split("\n")
    section, changed, confirmed = "", 0, 0
    for i, line in enumerate(lines):
        m = re.match(r"^\s*\[([^\]]+)\]\s*$", line)
        if m:
            section = m.group(1).strip()
            continue
        if mode == "off" and section == "auth" and re.match(r"^\s*enable_signup\s*=", line):
            lines[i] = "enable_signup = false"
            changed += 1
        if mode == "off" and section == "auth.email" and re.match(r"^\s*enable_confirmations\s*=", line):
            lines[i] = "enable_confirmations = true"
            confirmed += 1
    if mode == "off" and changed != 1:
        print("expected one enable_signup line in [auth], found %d" % changed)
        return 1
    if mode == "off" and confirmed != 1:
        print("expected one enable_confirmations line in [auth.email], found %d" % confirmed)
        return 1
    if any(re.match(r"^\s*\[auth\.rate_limit\]", line) for line in lines):
        print("the config already has an [auth.rate_limit] section; not written for that")
        return 1
    for name in ("google", "keycloak"):
        if any(re.match(r"^\s*\[auth\.external\.%s\]" % name, line) for line in lines):
            print("the config already has an [auth.external.%s] section; not written for that" % name)
            return 1
    lines += ["", "[auth.rate_limit]", "email_sent = 1000", "sign_in_sign_ups = 1000",
              "token_verifications = 1000", ""]
    if mode == "off":
        lines += ["[auth.external.google]", "enabled = false", 'client_id = ""', 'secret = ""', ""]
    if stand_in:
        lines += ["[auth.external.keycloak]", "enabled = true", 'client_id = "hub-stand-in"',
                  'secret = "stand-in-opens-nothing"', 'url = "%s"' % stand_in,
                  'redirect_uri = "http://127.0.0.1:54341/auth/v1/callback"', ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    print("sign-ups %s in [auth]; limits raised for the throwaway stack%s%s" % (
        mode, "; email confirmations on; Google off" if mode == "off" else "",
        "; stand-in provider at %s" % stand_in if stand_in else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
