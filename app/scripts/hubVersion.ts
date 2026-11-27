// team hub (issue 89): which version of the app is running, made at build
// time from git, never typed by hand. A build defines __HUB_VERSION__ for the
// label under the logo (src/components/kit/VersionLabel.tsx) and writes
// dist/version.json, which `python3 scripts/hub.py version` reads from the live
// site. `npm run dev` defines it as null, and the label shows "dev".
//
//   sha       the full commit, or "unknown" for a build outside git
//   short     its first 7 characters, or "unknown"
//   built_at  the build time in California, ISO 8601 with its offset
//   pr        the pull request from the squash commit's "(#NN)", or null

import { execFileSync } from "node:child_process";
import type { Plugin } from "vite";

export type HubVersion = {
  sha: string;
  short: string;
  built_at: string;
  pr: number | null;
};

type Commit = { sha: string | null; subject: string | null };

const ZONE = "America/Los_Angeles";
const SQUASH_PR = /\(#(\d+)\)\s*$/;
const MERGE_PR = /^Merge pull request #(\d+)\b/;

const pad = (n: number) => String(n).padStart(2, "0");

// The time in California as 2026-11-24T19:30:00-08:00.
export const pacificTime = (now: Date): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offset = Math.round(
    (wall - Math.floor(now.getTime() / 1000) * 1000) / 60000,
  );
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
};

export const versionFromGit = (commit: Commit, now: Date): HubVersion => {
  const sha =
    commit.sha && /^[0-9a-f]{40}$/.test(commit.sha) ? commit.sha : null;
  const subject = commit.subject ?? "";
  const match = sha
    ? (SQUASH_PR.exec(subject) ?? MERGE_PR.exec(subject))
    : null;
  return {
    sha: sha ?? "unknown",
    short: sha ? sha.slice(0, 7) : "unknown",
    built_at: pacificTime(now),
    pr: match ? Number(match[1]) : null,
  };
};

// HEAD and its subject line, or nothing when this is not a git checkout.
export const readGit = (cwd: string): Commit => {
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  try {
    return {
      sha: git("rev-parse", "HEAD"),
      subject: git("log", "-1", "--format=%s"),
    };
  } catch {
    return { sha: null, subject: null };
  }
};

export const hubVersion = (
  options: { gitRoot?: string; now?: () => Date } = {},
): Plugin => {
  let version: HubVersion | null = null;
  return {
    name: "hub-version",
    config: (_config, { command }) => {
      version =
        command === "build"
          ? versionFromGit(
              readGit(options.gitRoot ?? process.cwd()),
              (options.now ?? (() => new Date()))(),
            )
          : null;
      return { define: { __HUB_VERSION__: JSON.stringify(version) } };
    },
    generateBundle() {
      if (!version) return;
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify(version, null, 2) + "\n",
      });
    },
  };
};
