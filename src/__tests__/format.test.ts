import { describe, it, expect } from "vitest";
import { shortenPath } from "../format";

describe("shortenPath", () => {
  const home = process.env.HOME || "";

  it("replaces HOME prefix with ~", () => {
    if (!home) {
      return;
    } // skip if HOME is not set
    expect(shortenPath(`${home}/projects/foo`)).toBe("~/projects/foo");
  });

  it("returns unchanged if no HOME match", () => {
    expect(shortenPath("/some/other/path")).toBe("/some/other/path");
  });

  it("handles empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});
