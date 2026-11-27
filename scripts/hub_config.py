#!/usr/bin/env python3
"""hub.json, the one place the hub's public facts live, read and checked.

  python3 scripts/hub_config.py check
  python3 scripts/hub_config.py live
  python3 scripts/hub_config.py config-js <out> [--need-key]

check       exits 0 when hub.json is whole, else 1 with one line.
live        prints true or false.
config-js   writes the app's config.js (the form app/scripts/renderRuntimeConfig.ts
            writes) from hub.json. With --need-key an empty key is refused with
            one line: the deploy job uses this. The test job of the deploy
            workflow sets HUB_CONFIG_TEST_URL and HUB_CONFIG_TEST_KEY to the
            throwaway stack's address and public key instead.

HUB_JSON in the environment names another file (the tests use this).
Standard library only. Nothing here holds or prints a secret: the publishable
key is public by design, it ships inside the app.
"""
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
KEYS = ("url", "publishable_key", "address", "live")
LOCAL = ("127.0.0.1", "localhost")


class Bad(Exception):
    """hub.json cannot be used. The message is the one line to show."""


def path():
    return Path(os.environ.get("HUB_JSON") or ROOT / "hub.json")


def _web(value, field, local_ok):
    if not isinstance(value, str) or not value:
        raise Bad("hub.json: %s is empty" % field)
    try:
        parts = urlsplit(value)
        host = parts.hostname or ""
    except ValueError:
        raise Bad("hub.json: %s is not a web address" % field) from None
    if parts.scheme == "https" and host:
        pass
    elif local_ok and parts.scheme == "http" and host in LOCAL:
        pass
    else:
        raise Bad("hub.json: %s must start with https://" % field)
    if parts.path not in ("", "/") or parts.query or parts.fragment or parts.username:
        raise Bad("hub.json: %s must be a plain address, with nothing after the host" % field)
    return value.rstrip("/")


def _claim(token, name):
    try:
        middle = token.split(".")[1]
        doc = json.loads(base64.urlsafe_b64decode(middle + "=" * (-len(middle) % 4)))
        return doc.get(name) if isinstance(doc, dict) else None
    except (IndexError, ValueError, AttributeError, TypeError):
        return None


def load(local_ok=False):
    """The checked contents of hub.json, as a dict. Raises Bad with one line."""
    p = path()
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise Bad("hub.json is missing (%s)" % p.name) from None
    except (OSError, ValueError):
        raise Bad("hub.json is not valid JSON") from None
    if not isinstance(doc, dict):
        raise Bad("hub.json is not a JSON object")
    missing = [k for k in KEYS if k not in doc]
    if missing:
        raise Bad("hub.json lacks %s" % ", ".join(missing))
    extra = sorted(k for k in doc if k not in KEYS)
    if extra:
        raise Bad("hub.json has fields it should not: %s" % ", ".join(extra))
    if not isinstance(doc["live"], bool):
        raise Bad("hub.json: live must be true or false")
    key = doc["publishable_key"]
    if not isinstance(key, str):
        raise Bad("hub.json: publishable_key must be text")
    if key.startswith("sb_secret_") or _claim(key, "role") == "service_role":
        raise Bad("hub.json: that is a secret key. Only the publishable key may be here")
    return {
        "url": _web(doc["url"], "url", local_ok),
        "publishable_key": key.strip(),
        "address": _web(doc["address"], "address", local_ok),
        "live": doc["live"],
    }


def config_js(url, key):
    body = {"supabaseUrl": url, "supabasePublishableKey": key}
    return "window._atomicCrmConfig = %s;\n" % json.dumps(body, indent=2)


def main(argv):
    if not argv or argv[0] not in ("check", "live", "config-js"):
        print("usage: hub_config.py check | live | config-js <out> [--need-key]")
        return 2
    # Plain http on this machine is accepted only to write a test config.js
    # (the deploy workflow's test job). A real deploy and check stay https.
    test_copy = argv[0] == "config-js" and "--need-key" not in argv
    try:
        doc = load(local_ok=test_copy)
    except Bad as e:
        print(e)
        return 1
    if argv[0] == "check":
        print("hub.json is whole")
        return 0
    if argv[0] == "live":
        print("true" if doc["live"] else "false")
        return 0
    if len(argv) < 2:
        print("config-js: name the file to write")
        return 2
    test_url, test_key = os.environ.get("HUB_CONFIG_TEST_URL"), os.environ.get("HUB_CONFIG_TEST_KEY")
    if test_url or test_key:
        if "--need-key" in argv:
            print("config-js: a test address may not be used for a real deploy")
            return 1
        if not (test_url and test_key):
            print("config-js: set both HUB_CONFIG_TEST_URL and HUB_CONFIG_TEST_KEY, or neither")
            return 1
        url, key = test_url, test_key
    else:
        url, key = doc["url"], doc["publishable_key"]
        if not key and "--need-key" in argv:
            print("hub.json has no publishable_key yet: paste it there first (docs/DEPLOY.md, step 15)")
            return 1
    Path(argv[1]).write_text(config_js(url, key), encoding="utf-8")
    print("wrote %s for %s" % (argv[1], url))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
