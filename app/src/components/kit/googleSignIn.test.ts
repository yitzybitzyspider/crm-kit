// team hub, issue 58: what a teammate reads when Google sign-in comes back
// refused. The return addresses below are shaped the way Supabase's auth
// service builds them: the error in the query and again in the fragment.
// The screens themselves are tested against a real stack in
// app/e2e-signin/google.e2e.ts and google-linking.e2e.ts.
import {
  GOOGLE_CANCELLED,
  GOOGLE_FAILED,
  GOOGLE_NOT_ON_LIST,
  GOOGLE_OFF,
  googleRefusal,
  googleReturnAddress,
  oauthReturnParams,
  withoutOAuthError,
} from "./googleSignIn";

const returned = (query: string) => ({
  pathname: "/",
  search: `?${query}`,
  hash: `#${query}`,
});

const refusalOf = (query: string) =>
  googleRefusal(oauthReturnParams(returned(query)));

describe("issue 58: Google sign-in's refusals in plain words", () => {
  it.each([
    "error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance",
    "error=server_error&error_code=unexpected_failure&error_description=Database+error+saving+new+user",
    "error=server_error&error_description=Database+error+saving+new+user",
    "error=invalid_request&error_code=user_not_found&error_description=User+not+found",
    "error=invalid_request&error_code=identity_not_found&error_description=Identity+not+found",
    "error=access_denied&error_code=user_banned&error_description=User+is+banned",
  ])("%s says the account is not on the list", (query) => {
    expect(refusalOf(query)).toBe(GOOGLE_NOT_ON_LIST);
  });

  it("the provider switched off says so", () => {
    expect(
      refusalOf(
        "error=invalid_request&error_code=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled",
      ),
    ).toBe(GOOGLE_OFF);
  });

  it("Cancel on Google's screen is a cancel, not an error", () => {
    expect(
      refusalOf("error=access_denied&error_description=The+user+cancelled"),
    ).toBe(GOOGLE_CANCELLED);
  });

  it("anything else is one plain sentence, never the raw text", () => {
    const sentence = refusalOf(
      "error=server_error&error_code=unexpected_failure&error_description=Something+odd+at+line+42",
    );
    expect(sentence).toBe(GOOGLE_FAILED);
    expect(sentence).not.toContain("line 42");
  });

  it("the error is found when only the query or only the fragment holds it", () => {
    const query =
      "error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+this+instance";
    expect(
      googleRefusal(
        oauthReturnParams({ pathname: "/", search: `?${query}`, hash: "#/login" }),
      ),
    ).toBe(GOOGLE_NOT_ON_LIST);
    expect(
      googleRefusal(
        oauthReturnParams({ pathname: "/", search: "", hash: `#${query}` }),
      ),
    ).toBe(GOOGLE_NOT_ON_LIST);
  });

  it("an address with no error says nothing", () => {
    expect(
      googleRefusal(oauthReturnParams({ pathname: "/", search: "", hash: "" })),
    ).toBeUndefined();
    expect(
      googleRefusal(
        oauthReturnParams({ pathname: "/", search: "", hash: "#/login" }),
      ),
    ).toBeUndefined();
    expect(
      googleRefusal(
        oauthReturnParams({
          pathname: "/",
          search: "?passwordRecoveryEmailSent=1",
          hash: "#/login",
        }),
      ),
    ).toBeUndefined();
  });

  it("a successful return is not read as an error", () => {
    expect(
      googleRefusal(
        oauthReturnParams({
          pathname: "/",
          search: "",
          hash: "#access_token=a&refresh_token=b&expires_in=3600&token_type=bearer",
        }),
      ),
    ).toBeUndefined();
  });

  it("the error is taken off the address, and nothing else is", () => {
    expect(
      withoutOAuthError({
        pathname: "/",
        search: "?error=access_denied&error_code=signup_disabled&error_description=x&keep=1",
        hash: "#/login",
      }),
    ).toBe("/?keep=1#/login");
    expect(
      withoutOAuthError({
        pathname: "/",
        search: "",
        hash: "#error=access_denied&error_description=x",
      }),
    ).toBe("/");
  });

  it("the return address is the hub's own address", () => {
    expect(googleReturnAddress("https://hub.example.org")).toBe(
      "https://hub.example.org/",
    );
  });
});
