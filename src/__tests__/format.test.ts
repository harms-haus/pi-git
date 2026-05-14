import { describe, it, expect } from "vitest";
import { shortenPath, formatAgentEndSummary } from "../format";
import type { GitStatus } from "../types";

function makeStatus(
  files: Array<{
    file: string;
    status: "A" | "M" | "D" | "??";
    insertions: number;
    deletions: number;
  }>
): GitStatus {
  return {
    branch: "main",
    totalInsertions: 0,
    totalDeletions: 0,
    addedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    files,
  };
}

describe("shortenPath", () => {
  const home = process.env.HOME || "";

  it("replaces HOME prefix with ~", () => {
    if (!home) return; // skip if HOME is not set
    expect(shortenPath(home + "/projects/foo")).toBe("~/projects/foo");
  });

  it("returns unchanged if no HOME match", () => {
    expect(shortenPath("/some/other/path")).toBe("/some/other/path");
  });

  it("handles empty string", () => {
    expect(shortenPath("")).toBe("");
  });
});

describe("formatAgentEndSummary", () => {
  it("returns empty string for empty files array", () => {
    expect(formatAgentEndSummary(makeStatus([]))).toBe("");
  });

  it("formats added file with + icon and insertions", () => {
    const status = makeStatus([
      { file: "src/new.ts", status: "A", insertions: 42, deletions: 0 },
    ]);
    expect(formatAgentEndSummary(status)).toBe("+ src/new.ts  +42");
  });

  it("formats modified file with ~ icon and both counts", () => {
    const status = makeStatus([
      { file: "src/changed.ts", status: "M", insertions: 15, deletions: 8 },
    ]);
    expect(formatAgentEndSummary(status)).toBe("~ src/changed.ts  +15 -8");
  });

  it("formats deleted file with - icon and deletions", () => {
    const status = makeStatus([
      { file: "src/old.ts", status: "D", insertions: 0, deletions: 30 },
    ]);
    expect(formatAgentEndSummary(status)).toBe("- src/old.ts  -30");
  });

  it("formats untracked file with ? icon, no counts", () => {
    const status = makeStatus([
      { file: "untracked.txt", status: "??", insertions: 0, deletions: 0 },
    ]);
    expect(formatAgentEndSummary(status)).toBe("? untracked.txt");
  });

  it("formats multiple files on separate lines", () => {
    const status = makeStatus([
      { file: "src/a.ts", status: "A", insertions: 10, deletions: 0 },
      { file: "src/b.ts", status: "M", insertions: 3, deletions: 5 },
      { file: "src/c.ts", status: "D", insertions: 0, deletions: 20 },
    ]);
    expect(formatAgentEndSummary(status)).toBe(
      "+ src/a.ts  +10\n~ src/b.ts  +3 -5\n- src/c.ts  -20"
    );
  });

  it("omits count parts when both are 0", () => {
    const status = makeStatus([
      { file: "src/mod.ts", status: "M", insertions: 0, deletions: 0 },
    ]);
    expect(formatAgentEndSummary(status)).toBe("~ src/mod.ts");
  });

  it("omits count parts when insertions is 0 but shows deletions, and vice versa", () => {
    // Only deletions
    const onlyDel = makeStatus([
      { file: "src/a.ts", status: "M", insertions: 0, deletions: 7 },
    ]);
    expect(formatAgentEndSummary(onlyDel)).toBe("~ src/a.ts  -7");

    // Only insertions
    const onlyIns = makeStatus([
      { file: "src/b.ts", status: "M", insertions: 12, deletions: 0 },
    ]);
    expect(formatAgentEndSummary(onlyIns)).toBe("~ src/b.ts  +12");
  });
});
