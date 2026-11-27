import { Notification } from "@/components/admin/notification";
import { useTranslate } from "ra-core";
import { useConfigurationContext } from "../root/ConfigurationContext";
// team hub (issue 50): beside the logo, "Hub" only; the logo says CRM Kit.
import { brand } from "@/components/kit/brand";
// team hub (issue 89): the running version, under the logo.
import { VersionLabel } from "@/components/kit/VersionLabel";

export const ConfirmationRequired = () => {
  const translate = useTranslate();
  const { darkModeLogo: logo, title } = useConfigurationContext();

  return (
    <div className="h-screen p-8">
      <div className="flex items-center gap-4">
        <img
          src={logo}
          alt={title}
          width={24}
          className="filter brightness-0 dark:invert"
        />
        <h1 className="text-xl font-semibold">{brand.besideLogo}</h1>
      </div>
      <VersionLabel />
      <div className="h-full text-center">
        <div className="max-w-sm mx-auto h-full flex flex-col justify-center gap-4">
          <h1 className="text-2xl font-bold mb-4">
            {translate("crm.auth.welcome_title", {
              _: "Welcome to team hub",
            })}
          </h1>
          <p className="text-base mb-4">
            {translate("crm.auth.confirmation_required", {
              _: "Please follow the link we just sent you by email to confirm your account.",
            })}
          </p>
        </div>
      </div>
      <Notification />
    </div>
  );
};

ConfirmationRequired.path = "/sign-up/confirm";
