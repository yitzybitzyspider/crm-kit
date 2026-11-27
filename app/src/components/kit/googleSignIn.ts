// team hub, issue 58: "Sign in with Google", plain words for what comes back.
//
// The button sends the browser to Supabase, which sends it to Google and then
// back to the hub's own address. A refused sign-in comes back with the error
// in the address: Supabase's auth service puts error, error_code and
// error_description both in the query and in the fragment. These are read
// here and turned into one plain sentence; the raw text is never shown.
//
// No account is ever made here. Sign-ups are off on the hub's project and the
// database refuses any address not on the hub's list (issues 40 and 47), so a
// Google account with no hub account is refused before this code sees it.
export const GOOGLE_NOT_ON_LIST =
  "This Google account is not on the team hub's list. Ask your hub administrator to add you.";
export const GOOGLE_OFF =
  "Sign in with Google is not switched on for the hub yet. Sign in with your email and password, or ask your hub administrator.";
export const GOOGLE_CANCELLED =
  "Google sign-in was cancelled. Nothing was changed.";
export const GOOGLE_FAILED =
  "Google sign-in did not work. Try again, or sign in with your email and password.";
export const GOOGLE_UNREACHABLE =
  "The hub's sign-in service did not answer. Check your connection and try again.";

// Where Google sign-in comes back to: the hub's own address.
export const googleReturnAddress = (origin: string) => `${origin}/`;

type Where = { pathname: string; search: string; hash: string };

const ERROR_KEYS = ["error", "error_code", "error_description"];

// The error parameters of an address, from the query and from a fragment
// that is not one of the app's own routes ("#/login").
export function oauthReturnParams(where: Where): URLSearchParams | undefined {
  const found = new URLSearchParams();
  const sources = [where.search.replace(/^\?/, "")];
  const fragment = where.hash.replace(/^#/, "");
  if (fragment && !fragment.startsWith("/")) sources.push(fragment);
  for (const source of sources) {
    const params = new URLSearchParams(source);
    for (const key of ERROR_KEYS) {
      const value = params.get(key);
      if (value && !found.has(key)) found.set(key, value);
    }
  }
  return found.has("error") || found.has("error_code") || found.has("error_description")
    ? found
    : undefined;
}

// Codes and wordings Supabase uses for "this Google account has no way in".
const NOT_ON_LIST_CODES = new Set([
  "signup_disabled",
  "user_not_found",
  "identity_not_found",
  "user_banned",
]);
const NOT_ON_LIST_WORDS = [
  // the database's allow list refusal, as the auth service passes it on
  /^database error (saving|creating) new user\.?$/i,
  /not on the hub's list/i,
  /^sign up is not allowed/i,
  /signups not allowed/i,
];
const PROVIDER_OFF_WORDS = [/provider is not enabled/i, /unsupported provider/i];

export function googleRefusal(params?: URLSearchParams): string | undefined {
  if (!params) return undefined;
  const error = params.get("error") ?? "";
  const code = params.get("error_code") ?? "";
  const description = (params.get("error_description") ?? "").trim();
  if (NOT_ON_LIST_CODES.has(code)) return GOOGLE_NOT_ON_LIST;
  if (NOT_ON_LIST_WORDS.some((words) => words.test(description))) {
    return GOOGLE_NOT_ON_LIST;
  }
  if (PROVIDER_OFF_WORDS.some((words) => words.test(description))) {
    return GOOGLE_OFF;
  }
  if (error === "access_denied" && !code) return GOOGLE_CANCELLED;
  return GOOGLE_FAILED;
}

// The same address with the error taken off, for history.replaceState.
export function withoutOAuthError(where: Where): string {
  const query = new URLSearchParams(where.search.replace(/^\?/, ""));
  for (const key of ERROR_KEYS) query.delete(key);
  const fragment = where.hash.replace(/^#/, "");
  const keepHash = fragment.startsWith("/") ? where.hash : "";
  const search = query.toString();
  return `${where.pathname}${search ? `?${search}` : ""}${keepHash}`;
}

// What the browser came back with when the app was first loaded, read before
// the router moves anything. Read once: a later visit to the sign-in page in
// the same tab does not show it again.
let atLoad: string | undefined =
  typeof window !== "undefined"
    ? googleRefusal(oauthReturnParams(window.location))
    : undefined;

export function takeRefusalAtLoad(): string | undefined {
  const fromNow =
    typeof window !== "undefined"
      ? googleRefusal(oauthReturnParams(window.location))
      : undefined;
  const sentence = fromNow ?? atLoad;
  atLoad = undefined;
  if (fromNow && typeof window !== "undefined") {
    window.history.replaceState(
      window.history.state,
      "",
      withoutOAuthError(window.location),
    );
  }
  return sentence;
}
