// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findInvalidEmail, normalizeSecondaryEmails } from "./secondaryEmails";

describe("normalizeSecondaryEmails", () => {
  it("returns undefined for a non-array, so the caller rejects instead of wiping", () => {
    expect(normalizeSecondaryEmails(undefined)).toBe(undefined);
    expect(normalizeSecondaryEmails(null)).toBe(undefined);
    expect(normalizeSecondaryEmails("john@perso-com.example.org")).toBe(undefined);
    expect(normalizeSecondaryEmails({ 0: "john@perso-com.example.org" })).toBe(undefined);
  });

  it("returns an empty array for an empty array, which clears the addresses", () => {
    expect(normalizeSecondaryEmails([])).toEqual([]);
  });

  it("trims and lowercases every address", () => {
    expect(normalizeSecondaryEmails(["  John@Perso-COM.example.org  "])).toEqual([
      "john@perso-com.example.org",
    ]);
  });

  it("removes addresses that differ only by case or spacing", () => {
    expect(
      normalizeSecondaryEmails(["john@perso-com.example.org", " JOHN@perso-com.example.org "]),
    ).toEqual(["john@perso-com.example.org"]);
  });

  it("drops empty entries and non-string values", () => {
    expect(
      normalizeSecondaryEmails(["john@perso-com.example.org", "", "   ", 42, null]),
    ).toEqual(["john@perso-com.example.org"]);
  });

  it("preserves the order of the remaining addresses", () => {
    expect(
      normalizeSecondaryEmails(["b@perso-com.example.org", "a@perso-com.example.org", "c@perso-com.example.org"]),
    ).toEqual(["b@perso-com.example.org", "a@perso-com.example.org", "c@perso-com.example.org"]);
  });
});

describe("findInvalidEmail", () => {
  it("returns undefined when every address is well formed", () => {
    expect(
      findInvalidEmail(["john@perso-com.example.org", "j.doe+tag@sub-domain-co-uk.example.org"]),
    ).toBe(undefined);
  });

  it("returns undefined for an empty list", () => {
    expect(findInvalidEmail([])).toBe(undefined);
  });

  it("reports an address with no domain", () => {
    expect(findInvalidEmail(["john@perso-com.example.org", "not-an-email"])).toBe(
      "not-an-email",
    );
  });

  it("reports an address with no top level domain", () => {
    expect(findInvalidEmail(["john@localhost"])).toBe("john@localhost");
  });

  it("reports an address containing a space", () => {
    expect(findInvalidEmail(["john doe@perso-com.example.org"])).toBe("john doe@perso-com.example.org");
  });

  it("reports the first offending address so the caller can name it", () => {
    expect(findInvalidEmail(["bad-one", "bad-two"])).toBe("bad-one");
  });

  it("rejects a comma, which would split the PostgREST or() filter", () => {
    expect(findInvalidEmail(["john,doe@perso-com.example.org"])).toBe("john,doe@perso-com.example.org");
  });
});
