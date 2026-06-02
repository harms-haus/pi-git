import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { shortenPath } from "../format";

describe("shortenPath", () => {
  const home = process.env.HOME || process.env.USERPROFILE || "";

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

describe("shortenPath edge cases", () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it("uses USERPROFILE when HOME is not set", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = "C:\\Users\\test";
    expect(shortenPath("C:\\Users\\test\\projects\\foo")).toBe("~\\projects\\foo");
  });

  it("returns unchanged path when both HOME and USERPROFILE are unset", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(shortenPath("/some/path")).toBe("/some/path");
  });

  it("returns unchanged path when HOME is empty string", () => {
    process.env.HOME = "";
    expect(shortenPath("/some/path")).toBe("/some/path");
  });

  it("shortens path that exactly equals HOME", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/user")).toBe("~");
  });

  it("does not shorten path that contains HOME as substring but not prefix", () => {
    process.env.HOME = "/home/user";
    expect(shortenPath("/home/userXXX/projects")).toBe("/home/userXXX/projects");
  });
});

describe("shortenPath Windows paths", () => {
  let origHome: string | undefined;
  let origUserProfile: string | undefined;

  beforeEach(() => {
    origHome = process.env.HOME;
    origUserProfile = process.env.USERPROFILE;
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (origUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = origUserProfile;
  });

  it("replaces USERPROFILE prefix with ~ for Windows-style paths", () => {
    delete process.env.HOME;
    process.env.USERPROFILE = "C:\\Users\\test";
    expect(shortenPath("C:\\Users\\test\\projects\\foo")).toBe("~\\projects\\foo");
  });

  it("returns path unchanged when no home env matches", () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(shortenPath("D:\\projects\\foo")).toBe("D:\\projects\\foo");
  });
});
