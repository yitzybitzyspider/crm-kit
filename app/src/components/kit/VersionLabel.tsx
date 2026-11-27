// team hub (issue 89): which version is running, in small muted text right
// under the logo, so a teammate can tell an update went through. The values
// come from the build (app/scripts/hubVersion.ts), never from a person.
import { cn } from "@/lib/utils";

export type HubVersion = {
  sha: string;
  short: string;
  built_at: string;
  pr: number | null;
};

const COMMIT_URL = "https://github.com/your-org/crm-kit/commit/";

// What this build put in: null under `npm run dev` and in the unit tests.
export const builtVersion: HubVersion | null =
  typeof __HUB_VERSION__ !== "undefined" && __HUB_VERSION__
    ? __HUB_VERSION__
    : null;

export const versionText = (version: HubVersion) =>
  `v${version.built_at.slice(0, 10).replaceAll("-", ".")}.${version.short}`;

const Line = ({ children }: { children: string }) => (
  <span data-version-line className="block whitespace-nowrap">
    {children}
  </span>
);

export const VersionLabel = ({
  version = builtVersion,
  className,
}: {
  version?: HubVersion | null;
  className?: string;
}) => {
  const classes = cn(
    "block w-max text-[10px] leading-tight text-muted-foreground opacity-80 no-underline",
    className,
  );
  if (!version) {
    return (
      <span data-testid="hub-version" className={classes}>
        <Line>dev</Line>
      </span>
    );
  }
  const lines = (
    <>
      <Line>{versionText(version)}</Line>
      {version.pr ? <Line>{`#${version.pr}`}</Line> : null}
    </>
  );
  const title = `Built ${version.built_at} (California time)`;
  if (version.sha === "unknown") {
    return (
      <span data-testid="hub-version" className={classes} title={title}>
        {lines}
      </span>
    );
  }
  return (
    <a
      data-testid="hub-version"
      className={cn(classes, "hover:underline")}
      href={COMMIT_URL + version.sha}
      target="_blank"
      rel="noreferrer"
      title={title}
    >
      {lines}
    </a>
  );
};
