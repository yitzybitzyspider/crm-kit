// team hub (issue 50): the product's name and logos, in one place.
// The two SVGs in ./brand/ are plain placeholders: replace them with your
// team's own logo (same file names). Imported as assets so Vite resolves their address from the
// script, not the current route (upstream's rule for logos).
import lightModeLogo from "./brand/crm-logo.svg";
// The brand's reversed logo is for seat blue or dark backgrounds: the header
// in dark mode and the dark panel of the sign-in page.
import darkModeLogo from "./brand/crm-logo-reversed.svg";

export const brand = {
  title: "team hub",
  // The logo already says CRM Kit, so the text drawn beside it is only "Hub".
  // The title stays the name everywhere else: the tab,
  // the manifest, and the logo's alt text.
  besideLogo: "Hub",
  lightModeLogo,
  darkModeLogo,
};
