// team hub, issue 58: the "Sign in with Google" button of the sign-in page.
//
// Plain Google sign-in through Supabase's free OAuth provider, not upstream's
// "Sign in with Google Workplace" button, which is SAML single sign-on and
// needs Supabase's paid plan (that one stays hidden). It first asks Supabase
// whether Google is switched on, so a project where it is not says so in a
// sentence instead of sending the browser to a raw error. The whole page is
// sent to Google and back (no pop-up, so nothing for a pop-up blocker to stop).
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { config } from "@/components/atomic-crm/root/config";
import { getSupabaseClient } from "@/components/atomic-crm/providers/supabase/supabase";
import {
  GOOGLE_FAILED,
  GOOGLE_OFF,
  GOOGLE_UNREACHABLE,
  googleReturnAddress,
  takeRefusalAtLoad,
} from "./googleSignIn";

// Whether the hub's Supabase project has Google switched on. Undefined when
// it could not be asked.
async function googleIsOn(): Promise<boolean | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: config.supabasePublishableKey ?? "" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const settings = await response.json();
    return settings?.external?.google === true;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export const GoogleSignInButton = () => {
  const [pending, setPending] = useState(false);
  const [sentence, setSentence] = useState<string | undefined>(() =>
    takeRefusalAtLoad(),
  );

  // Back from Google's page with the browser's Back button: the page may come
  // back from the browser's cache with the button still waiting.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const signIn = async () => {
    setPending(true);
    setSentence(undefined);
    const on = await googleIsOn();
    if (on !== true) {
      setPending(false);
      setSentence(on === false ? GOOGLE_OFF : GOOGLE_UNREACHABLE);
      return;
    }
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: googleReturnAddress(window.location.origin) },
    });
    if (error) {
      setPending(false);
      setSentence(GOOGLE_FAILED);
    }
    // Otherwise the browser is on its way to Google.
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full cursor-pointer"
        onClick={signIn}
        disabled={pending}
      >
        Sign in with Google
        {pending ? <Spinner className="size-4" data-icon="inline-start" /> : null}
      </Button>
      {sentence ? (
        <p role="status" className="text-sm text-center text-muted-foreground">
          {sentence}
        </p>
      ) : null}
    </div>
  );
};
