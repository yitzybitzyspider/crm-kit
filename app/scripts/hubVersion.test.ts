import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { hubVersion, versionFromGit } from "./hubVersion.ts";

// Issue 89: the version under the logo is made at build time from git.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHA = "0123456789abcdef0123456789abcdef01234567";
// 2026-11-25 03:30 UTC is still the 24th in California.
const NOW = new Date("2026-11-25T03:30:00Z");

describe("versionFromGit", () => {
  it("takes the pull request from a squash commit's (#NN)", () => {
    expect(
      versionFromGit({ sha: SHA, subject: "Issue 89: a label (#89)" }, NOW),
    ).toEqual({
      sha: SHA,
      short: "0123456",
      built_at: "2026-11-24T19:30:00-08:00",
      pr: 89,
    });
  });

  it("takes it from a merge commit too", () => {
    expect(
      versionFromGit(
        { sha: SHA, subject: "Merge pull request #12 from x/y" },
        NOW,
      ).pr,
    ).toBe(12);
  });

  it("has no pull request when the commit names none", () => {
    expect(
      versionFromGit({ sha: SHA, subject: "a direct push (see #7 later)" }, NOW)
        .pr,
    ).toBeNull();
  });

  it("says unknown when there is no commit", () => {
    expect(versionFromGit({ sha: null, subject: null }, NOW)).toEqual({
      sha: "unknown",
      short: "unknown",
      built_at: "2026-11-24T19:30:00-08:00",
      pr: null,
    });
  });

  it("uses the summer offset in summer", () => {
    expect(
      versionFromGit(
        { sha: SHA, subject: "" },
        new Date("2026-07-01T12:00:00Z"),
      ).built_at,
    ).toBe("2026-07-01T05:00:00-07:00");
  });
});

// Test case 3: a real Vite build with the plugin writes dist/version.json.
const buildIn = async (gitRoot: string) => {
  const site = mkdtempSync(path.join(tmpdir(), "hubversion-"));
  writeFileSync(
    path.join(site, "index.html"),
    '<!doctype html><script type="module" src="./main.js"></script>',
  );
  writeFileSync(
    path.join(site, "main.js"),
    "document.title = JSON.stringify(__HUB_VERSION__);",
  );
  await build({
    configFile: false,
    root: site,
    logLevel: "silent",
    plugins: [hubVersion({ gitRoot })],
  });
  return JSON.parse(
    readFileSync(path.join(site, "dist", "version.json"), "utf8"),
  );
};

describe("the build", () => {
  it("writes dist/version.json with the four keys, from this checkout's git", async () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: HERE,
      encoding: "utf8",
    }).trim();
    const doc = await buildIn(HERE);
    expect(Object.keys(doc).sort()).toEqual(["built_at", "pr", "sha", "short"]);
    expect(doc.sha).toBe(head);
    expect(doc.short).toBe(head.slice(0, 7));
    expect(doc.built_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00$/,
    );
  });

  it("says unknown when it is built outside git", async () => {
    const doc = await buildIn(mkdtempSync(path.join(tmpdir(), "nogit-")));
    expect(doc.sha).toBe("unknown");
    expect(doc.short).toBe("unknown");
    expect(doc.pr).toBeNull();
  });
});
