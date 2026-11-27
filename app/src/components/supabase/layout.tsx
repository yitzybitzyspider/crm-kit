import * as React from "react";
import { Notification } from "@/components/admin/notification";
import { useConfigurationContext } from "@/components/atomic-crm/root/ConfigurationContext";
// team hub (issue 50): beside the logo, "Hub" only; the logo says CRM Kit.
import { brand } from "@/components/kit/brand";
// team hub (issue 89): the running version, under the logo.
import { VersionLabel } from "@/components/kit/VersionLabel";

export const Layout = ({ children }: React.PropsWithChildren) => {
  const { darkModeLogo, title } = useConfigurationContext();

  return (
    <div className="min-h-screen flex">
      <div className="container relative grid flex-col items-center justify-center sm:max-w-none lg:grid-cols-2 lg:px-0">
        <div className="relative hidden h-full flex-col bg-muted p-10 text-white dark:border-r lg:flex">
          <div className="absolute inset-0 bg-zinc-900" />
          <div className="relative z-20 flex flex-col">
            <div className="flex items-center text-lg font-medium">
              <img className="h-6 mr-2" src={darkModeLogo} alt={title} />
              {brand.besideLogo}
            </div>
            <VersionLabel className="text-zinc-400" />
          </div>
        </div>
        <div className="lg:p-8">
          <div className="mx-auto flex w-full flex-col justify-center space-y-6 sm:w-[350px]">
            {children}
          </div>
        </div>
      </div>
      <Notification />
    </div>
  );
};
