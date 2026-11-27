// team hub, issue 47 item 6. The screens themselves are tested against a
// real stack in app/e2e-signin/last-gaps.e2e.ts.
import { NOT_ON_THE_LIST, signupRefusal } from "./signupRefusal";

describe("issue 47 item 6: the sign-up list's refusal in plain words", () => {
  it.each([
    "Database error saving new user",
    "Database error creating new user",
    "Sign up is not allowed: this email is not on the hub's list",
  ])("%s becomes the plain sentence", (message) => {
    expect(signupRefusal(message)).toBe(NOT_ON_THE_LIST);
  });

  it.each([
    "Invalid login credentials",
    "A sales for this email already exists",
    "Database error saving new user because of something else",
  ])("%s is left as it is", (message) => {
    expect(signupRefusal(message)).toBe(message);
  });

  it("no message stays no message", () => {
    expect(signupRefusal(undefined)).toBeUndefined();
    expect(signupRefusal("")).toBe("");
  });
});
