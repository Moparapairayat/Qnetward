import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/next-path";

// ?next= must never send someone to another site after they sign in.
describe("safeNextPath", () => {
  it("keeps paths on this site, with their query and fragment", () => {
    expect(safeNextPath("/upgrade?period=monthly")).toBe("/upgrade?period=monthly");
    expect(safeNextPath("/monitors#list")).toBe("/monitors#list");
  });

  it.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash host", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "upgrade"],
    ["a tab hidden in the slashes", "/\t/evil.example"],
    ["a newline hidden in the slashes", "/\n/evil.example"],
    ["nothing", ""],
    ["null", null],
  ])("refuses %s", (_, raw) => {
    expect(safeNextPath(raw)).toBeNull();
  });

  it("refuses the sign-in pages themselves, which would loop", () => {
    expect(safeNextPath("/login")).toBeNull();
    expect(safeNextPath("/signup?next=/x")).toBeNull();
  });

  it("refuses anything very long", () => {
    expect(safeNextPath("/" + "a".repeat(600))).toBeNull();
  });
});
