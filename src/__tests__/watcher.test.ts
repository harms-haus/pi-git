import { describe, it, expect } from "vitest";
import { isIgnoredPath } from "../watcher";

describe("isIgnoredPath", () => {
  it("returns true for .git paths", () => {
    expect(isIgnoredPath(".git/HEAD")).toBe(true);
    expect(isIgnoredPath(".git/objects/abc")).toBe(true);
  });

  it("returns true for node_modules paths", () => {
    expect(isIgnoredPath("node_modules/foo/bar")).toBe(true);
  });

  it("returns true for .cache paths", () => {
    expect(isIgnoredPath(".cache/something")).toBe(true);
  });

  it("returns true for dist paths", () => {
    expect(isIgnoredPath("dist/bundle.js")).toBe(true);
  });

  it("returns true for coverage paths", () => {
    expect(isIgnoredPath("coverage/lcov.info")).toBe(true);
  });

  it("returns false for src paths", () => {
    expect(isIgnoredPath("src/index.ts")).toBe(false);
  });

  it("returns false for root-level files", () => {
    expect(isIgnoredPath("package.json")).toBe(false);
  });

  it("returns true for null input", () => {
    expect(isIgnoredPath(null)).toBe(true);
  });

  it("returns true for undefined input", () => {
    expect(isIgnoredPath(undefined)).toBe(true);
  });

  it("returns true for empty string", () => {
    expect(isIgnoredPath("")).toBe(true);
  });

  it("returns false for paths that contain but don't start with ignored dirs", () => {
    expect(isIgnoredPath("src/.gitkeep")).toBe(false);
  });
});
