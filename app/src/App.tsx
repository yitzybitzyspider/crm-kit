import { CRM } from "@/components/atomic-crm/root/CRM";
// team hub (issue 50): our name and logos, through the documented props.
import { brand } from "@/components/kit/brand";

/**
 * Application entry point
 *
 * Customize the CRM by passing props to the CRM component:
 *  - companySectors
 *  - darkTheme
 *  - dealCategories
 *  - dealPipelineStatuses
 *  - dealStages
 *  - lightTheme
 *  - darkModeLogo / lightModeLogo
 *  - noteStatuses
 *  - taskTypes
 *  - title
 * ... as well as all the props accepted by shadcn-admin-kit's <Admin> component.
 *
 * Logos must be an imported asset, an absolute URL, or a data URI — never a
 * route-relative path like "./img/logo.png", which breaks on nested routes.
 *
 * @example
 * import logoDark from "./logo-dark.svg";
 * import logoLight from "./logo-light.svg";
 *
 * const App = () => (
 *    <CRM
 *       darkModeLogo={logoDark}
 *       lightModeLogo={logoLight}
 *       title="Acme CRM"
 *    />
 * );
 */
const App = () => (
  <CRM
    disableTelemetry
    title={brand.title}
    lightModeLogo={brand.lightModeLogo}
    darkModeLogo={brand.darkModeLogo}
  />
);

export default App;
