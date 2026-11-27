/// <reference types="vite/client" />

// team hub (issue 89): put in by the build (scripts/hubVersion.ts); null
// under `npm run dev`, and not defined at all under the unit tests.
declare const __HUB_VERSION__:
  import("./components/kit/VersionLabel").HubVersion | null | undefined;
