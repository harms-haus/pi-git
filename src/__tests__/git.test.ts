import { describe, it, expect } from "vitest";
import {
  parseGitNumstat,
  parseGitNameStatus,
  parseGitStatusPorcelain,
  buildGitStatus,
} from "../git";

// ---------------------------------------------------------------------------
// parseGitNumstat
// ---------------------------------------------------------------------------

describe("parseGitNumstat", () => {
  it("parses standard output with multiple lines", () => {
    const output = "42\t8\tsrc/foo.ts\n0\t0\tsrc/bar.ts";
    const result = parseGitNumstat(output);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get("src/foo.ts")).toEqual({ insertions: 42, deletions: 8 });
    expect(result.get("src/bar.ts")).toEqual({ insertions: 0, deletions: 0 });
  });

  it("handles binary files with -\\t-", () => {
    const output = "-\t-\timage.png";
    const result = parseGitNumstat(output);

    expect(result.size).toBe(1);
    expect(result.get("image.png")).toEqual({ insertions: -1, deletions: -1 });
  });

  it("returns empty map for empty string", () => {
    const result = parseGitNumstat("");
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("handles single line", () => {
    const output = "10\t5\tsrc/single.ts";
    const result = parseGitNumstat(output);

    expect(result.size).toBe(1);
    expect(result.get("src/single.ts")).toEqual({
      insertions: 10,
      deletions: 5,
    });
  });

  it("handles mixed binary and regular files", () => {
    const output = "7\t3\tsrc/code.ts\n-\t-\tassets/logo.png\n1\t0\tsrc/util.ts";
    const result = parseGitNumstat(output);

    expect(result.size).toBe(3);
    expect(result.get("src/code.ts")).toEqual({ insertions: 7, deletions: 3 });
    expect(result.get("assets/logo.png")).toEqual({
      insertions: -1,
      deletions: -1,
    });
    expect(result.get("src/util.ts")).toEqual({ insertions: 1, deletions: 0 });
  });

  it("ignores lines with fewer than 3 tab-separated parts", () => {
    const output = "onlyonepart\n42\tsrc/two-parts.ts\n\n10\t5\tsrc/valid.ts";
    const result = parseGitNumstat(output);

    expect(result.size).toBe(1);
    expect(result.get("src/valid.ts")).toEqual({
      insertions: 10,
      deletions: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// parseGitNameStatus
// ---------------------------------------------------------------------------

describe("parseGitNameStatus", () => {
  it("parses A/M/D statuses", () => {
    const output = "M\tsrc/foo.ts\nA\tsrc/new.ts\nD\tsrc/old.ts";
    const result = parseGitNameStatus(output);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(3);
    expect(result.get("src/foo.ts")).toBe("M");
    expect(result.get("src/new.ts")).toBe("A");
    expect(result.get("src/old.ts")).toBe("D");
  });

  it("returns empty map for empty string", () => {
    const result = parseGitNameStatus("");
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("ignores unknown status letters (not A/M/D)", () => {
    const output = "M\tsrc/foo.ts\nR\tsrc/renamed.ts\nC\tsrc/copied.ts\nA\tsrc/new.ts";
    const result = parseGitNameStatus(output);

    expect(result.size).toBe(2);
    expect(result.get("src/foo.ts")).toBe("M");
    expect(result.get("src/new.ts")).toBe("A");
    expect(result.has("src/renamed.ts")).toBe(false);
    expect(result.has("src/copied.ts")).toBe(false);
  });

  it("ignores lines with fewer than 2 tab-separated parts", () => {
    const output = "M\tsrc/good.ts\njust_a_word\n\nA\tsrc/another.ts";
    const result = parseGitNameStatus(output);

    expect(result.size).toBe(2);
    expect(result.get("src/good.ts")).toBe("M");
    expect(result.get("src/another.ts")).toBe("A");
  });
});

// ---------------------------------------------------------------------------
// parseGitStatusPorcelain
// ---------------------------------------------------------------------------

describe("parseGitStatusPorcelain", () => {
  it("parses tracked files", () => {
    // Real porcelain format: XY + space + filename (2-char status code)
    const output = "M  src/foo.ts\nA  src/new.ts\nD  src/old.ts";
    const result = parseGitStatusPorcelain(output);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ file: "src/foo.ts", status: "M" });
    expect(result[1]).toEqual({ file: "src/new.ts", status: "A" });
    expect(result[2]).toEqual({ file: "src/old.ts", status: "D" });
  });

  it("parses untracked files", () => {
    const output = "?? untracked.txt";
    const result = parseGitStatusPorcelain(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ file: "untracked.txt", status: "??" });
  });

  it("returns empty array for empty string", () => {
    const result = parseGitStatusPorcelain("");
    expect(result).toEqual([]);
  });

  it("handles mixed tracked and untracked", () => {
    // Real porcelain format: XY + space + filename
    const output = "M  src/foo.ts\n?? newfile.txt\nA  src/added.ts\nD  src/removed.ts\n?? other.txt";
    const result = parseGitStatusPorcelain(output);

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ file: "src/foo.ts", status: "M" });
    expect(result[1]).toEqual({ file: "newfile.txt", status: "??" });
    expect(result[2]).toEqual({ file: "src/added.ts", status: "A" });
    expect(result[3]).toEqual({ file: "src/removed.ts", status: "D" });
    expect(result[4]).toEqual({ file: "other.txt", status: "??" });
  });

  it("ignores lines shorter than 4 chars", () => {
    const output = "M \nAB\n?? valid.txt";
    const result = parseGitStatusPorcelain(output);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ file: "valid.txt", status: "??" });
  });
});

// ---------------------------------------------------------------------------
// buildGitStatus
// ---------------------------------------------------------------------------

describe("buildGitStatus", () => {
  it("merges all three data sources correctly", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    numstat.set("src/foo.ts", { insertions: 42, deletions: 8 });
    numstat.set("src/bar.ts", { insertions: 10, deletions: 5 });

    const nameStatus = new Map<string, "A" | "M" | "D">();
    nameStatus.set("src/foo.ts", "M");
    nameStatus.set("src/bar.ts", "A");

    const porcelain = [
      { file: "src/foo.ts", status: "M" },
      { file: "src/bar.ts", status: "A" },
    ];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "main");

    expect(result.branch).toBe("main");
    expect(result.totalInsertions).toBe(52);
    expect(result.totalDeletions).toBe(13);
    expect(result.addedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect(result.files).toHaveLength(2);
  });

  it("handles untracked files from porcelain only (not in numstat/nameStatus)", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    numstat.set("src/tracked.ts", { insertions: 5, deletions: 2 });

    const nameStatus = new Map<string, "A" | "M" | "D">();
    nameStatus.set("src/tracked.ts", "M");

    const porcelain = [
      { file: "src/tracked.ts", status: "M" },
      { file: "untracked.txt", status: "??" },
    ];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "develop");

    expect(result.files).toHaveLength(2);
    const untracked = result.files.find((f) => f.file === "untracked.txt");
    expect(untracked).toEqual({
      file: "untracked.txt",
      status: "??",
      insertions: 0,
      deletions: 0,
    });
    expect(result.totalInsertions).toBe(5);
    expect(result.totalDeletions).toBe(2);
    expect(result.addedCount).toBe(1); // ?? counts as added
    expect(result.modifiedCount).toBe(1);
  });

  it("excludes binary files from totals but includes them in files array", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    numstat.set("src/code.ts", { insertions: 10, deletions: 3 });
    numstat.set("assets/image.png", { insertions: -1, deletions: -1 });

    const nameStatus = new Map<string, "A" | "M" | "D">();
    nameStatus.set("src/code.ts", "M");
    nameStatus.set("assets/image.png", "M");

    const porcelain: Array<{ file: string; status: string }> = [];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "main");

    expect(result.files).toHaveLength(2);
    // Binary file should be in the files array
    const binary = result.files.find((f) => f.file === "assets/image.png");
    expect(binary).toEqual({
      file: "assets/image.png",
      status: "M",
      insertions: -1,
      deletions: -1,
    });
    // Totals should only count the non-binary file
    expect(result.totalInsertions).toBe(10);
    expect(result.totalDeletions).toBe(3);
  });

  it("defaults status to M for files in numstat but not in nameStatus", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    numstat.set("src/orphan.ts", { insertions: 7, deletions: 1 });

    const nameStatus = new Map<string, "A" | "M" | "D">();

    const porcelain: Array<{ file: string; status: string }> = [];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "feature");

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      file: "src/orphan.ts",
      status: "M",
      insertions: 7,
      deletions: 1,
    });
    expect(result.modifiedCount).toBe(1);
  });

  it("counts added (A or ??), modified (M), deleted (D) correctly", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    numstat.set("src/added.ts", { insertions: 20, deletions: 0 });
    numstat.set("src/modified.ts", { insertions: 5, deletions: 3 });
    numstat.set("src/deleted.ts", { insertions: 0, deletions: 10 });

    const nameStatus = new Map<string, "A" | "M" | "D">();
    nameStatus.set("src/added.ts", "A");
    nameStatus.set("src/modified.ts", "M");
    nameStatus.set("src/deleted.ts", "D");

    const porcelain = [
      { file: "src/added.ts", status: "A" },
      { file: "src/modified.ts", status: "M" },
      { file: "src/deleted.ts", status: "D" },
      { file: "untracked.txt", status: "??" },
    ];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "main");

    expect(result.addedCount).toBe(2); // A + ??
    expect(result.modifiedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.files).toHaveLength(4);
  });

  it("handles empty inputs (all empty maps/arrays)", () => {
    const numstat = new Map<string, { insertions: number; deletions: number }>();
    const nameStatus = new Map<string, "A" | "M" | "D">();
    const porcelain: Array<{ file: string; status: string }> = [];

    const result = buildGitStatus(numstat, nameStatus, porcelain, "main");

    expect(result).toEqual({
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });
  });
});
