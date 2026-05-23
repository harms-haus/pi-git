import { describe, it, expect, vi } from "vitest";
import {
  mapFileStatus,
  buildDiffMap,
  buildGitStatus,
  getUntrackedFileDiffs,
} from "../git-operations";
import type { StatusResult, FileStatusResult, DiffResult, SimpleGit } from "simple-git";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFileStatus(
  path: string,
  index: string,
  working_dir: string,
  from?: string,
): FileStatusResult {
  return { path, index, working_dir, ...(from ? { from } : {}) };
}

function makeStatus(files: FileStatusResult[], branch = "main", detached = false): StatusResult {
  return {
    not_added: [],
    conflicted: [],
    created: [],
    deleted: [],
    modified: [],
    renamed: [],
    staged: [],
    files,
    ahead: 0,
    behind: 0,
    current: branch,
    tracking: "origin/main",
    detached,
    isClean: () => files.length === 0,
  };
}

function makeDiff(
  files: Array<{ file: string; insertions: number; deletions: number; binary?: boolean }>,
): DiffResult {
  return {
    changed: files.length,
    insertions: files.reduce((s, f) => s + f.insertions, 0),
    deletions: files.reduce((s, f) => s + f.deletions, 0),
    files: files.map((f) => ({
      file: f.file,
      changes: f.insertions + f.deletions,
      insertions: f.insertions,
      deletions: f.deletions,
      binary: (f.binary ?? false) as false,
    })),
  };
}

// ---------------------------------------------------------------------------
// mapFileStatus
// ---------------------------------------------------------------------------

describe("mapFileStatus", () => {
  it("maps untracked working_dir '?' to A", () => {
    expect(mapFileStatus(makeFileStatus("new.ts", " ", "?"))).toBe("A");
  });

  it("maps untracked index '?' to A", () => {
    expect(mapFileStatus(makeFileStatus("new.ts", "?", " "))).toBe("A");
  });

  it("maps working_dir D to D", () => {
    expect(mapFileStatus(makeFileStatus("old.ts", " ", "D"))).toBe("D");
  });

  it("maps index D to D", () => {
    expect(mapFileStatus(makeFileStatus("old.ts", "D", " "))).toBe("D");
  });

  it("maps index R (rename) to A", () => {
    expect(mapFileStatus(makeFileStatus("new.ts", "R", " ", "old.ts"))).toBe("A");
  });

  it("maps index C (copy) to A", () => {
    expect(mapFileStatus(makeFileStatus("copy.ts", "C", " "))).toBe("A");
  });

  it("maps working_dir R to A", () => {
    expect(mapFileStatus(makeFileStatus("renamed.ts", " ", "R"))).toBe("A");
  });

  it("maps working_dir C to A", () => {
    expect(mapFileStatus(makeFileStatus("copied.ts", " ", "C"))).toBe("A");
  });

  it("maps index A to A", () => {
    expect(mapFileStatus(makeFileStatus("added.ts", "A", " "))).toBe("A");
  });

  it("maps working_dir A to A", () => {
    expect(mapFileStatus(makeFileStatus("added.ts", " ", "A"))).toBe("A");
  });

  it("maps index M to M", () => {
    expect(mapFileStatus(makeFileStatus("mod.ts", "M", " "))).toBe("M");
  });

  it("maps working_dir M to M", () => {
    expect(mapFileStatus(makeFileStatus("mod.ts", " ", "M"))).toBe("M");
  });

  it("maps T (type change) to M", () => {
    expect(mapFileStatus(makeFileStatus("file.ts", "T", " "))).toBe("M");
  });

  it("maps U (unmerged) to M", () => {
    expect(mapFileStatus(makeFileStatus("conflict.ts", "U", " "))).toBe("M");
  });

  it("maps empty strings to M (default fallback)", () => {
    expect(mapFileStatus(makeFileStatus("file.ts", " ", " "))).toBe("M");
  });
});

// ---------------------------------------------------------------------------
// buildDiffMap
// ---------------------------------------------------------------------------

describe("buildDiffMap", () => {
  it("builds map from normal files", () => {
    const diff = makeDiff([
      { file: "src/foo.ts", insertions: 10, deletions: 5 },
      { file: "src/bar.ts", insertions: 3, deletions: 1 },
    ]);

    const map = buildDiffMap(diff);

    expect(map.get("src/foo.ts")).toEqual({ insertions: 10, deletions: 5 });
    expect(map.get("src/bar.ts")).toEqual({ insertions: 3, deletions: 1 });
    expect(map.size).toBe(2);
  });

  it("marks binary files with -1 insertions and deletions", () => {
    const diff = makeDiff([{ file: "image.png", insertions: 0, deletions: 0, binary: true }]);

    const map = buildDiffMap(diff);

    expect(map.get("image.png")).toEqual({ insertions: -1, deletions: -1 });
  });

  it("returns empty map for empty diff", () => {
    const diff = makeDiff([]);

    const map = buildDiffMap(diff);

    expect(map.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildGitStatus
// ---------------------------------------------------------------------------

describe("buildGitStatus", () => {
  it("handles modified files from status + diff", () => {
    const status = makeStatus([
      makeFileStatus("src/foo.ts", "M", " "),
      makeFileStatus("src/bar.ts", " ", "M"),
    ]);
    const diff = makeDiff([
      { file: "src/foo.ts", insertions: 42, deletions: 8 },
      { file: "src/bar.ts", insertions: 10, deletions: 5 },
    ]);

    const result = buildGitStatus(status, diff);

    expect(result.branch).toBe("main");
    expect(result.totalInsertions).toBe(52);
    expect(result.totalDeletions).toBe(13);
    expect(result.modifiedCount).toBe(2);
    expect(result.files).toHaveLength(2);
  });

  it("handles empty status (clean repo)", () => {
    const status = makeStatus([]);

    const result = buildGitStatus(status);

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

  it("handles detached HEAD", () => {
    const status = makeStatus([]);
    (status as any).current = undefined;
    (status as any).detached = true;

    const result = buildGitStatus(status);

    expect(result.branch).toBe("detached");
  });

  it("handles unknown branch (no current, not detached)", () => {
    const status = makeStatus([]);
    (status as any).current = undefined;
    (status as any).detached = false;

    const result = buildGitStatus(status);

    expect(result.branch).toBe("unknown");
  });

  it("counts added, modified, deleted correctly", () => {
    const status = makeStatus([
      makeFileStatus("added.ts", "A", " "),
      makeFileStatus("modified.ts", "M", " "),
      makeFileStatus("deleted.ts", "D", " "),
    ]);

    const result = buildGitStatus(status);

    expect(result.addedCount).toBe(1);
    expect(result.modifiedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
  });

  it("defaults insertions and deletions to 0 when no diff provided", () => {
    const status = makeStatus([makeFileStatus("new.ts", "A", " ")]);

    const result = buildGitStatus(status);

    expect(result.files[0].insertions).toBe(0);
    expect(result.files[0].deletions).toBe(0);
    expect(result.totalInsertions).toBe(0);
    expect(result.totalDeletions).toBe(0);
  });

  it("sets insertions/deletions to -1 for binary files in diff", () => {
    const status = makeStatus([makeFileStatus("image.png", "M", " ")]);
    const diff = makeDiff([{ file: "image.png", insertions: 0, deletions: 0, binary: true }]);

    const result = buildGitStatus(status, diff);

    expect(result.files[0].insertions).toBe(-1);
    expect(result.files[0].deletions).toBe(-1);
    // Binary files should not contribute to totals
    expect(result.totalInsertions).toBe(0);
    expect(result.totalDeletions).toBe(0);
  });

  it("maps untracked files (?) to added count", () => {
    const status = makeStatus([makeFileStatus("untracked.ts", "?", "?")]);

    const result = buildGitStatus(status);

    expect(result.addedCount).toBe(1);
    expect(result.modifiedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
  });

  it("maps renamed files (R) to added count", () => {
    const status = makeStatus([makeFileStatus("new-name.ts", "R", " ", "old-name.ts")]);

    const result = buildGitStatus(status);

    expect(result.addedCount).toBe(1);
  });

  it("merges untracked diffs into diffMap for files not already present", () => {
    const status = makeStatus([
      makeFileStatus("tracked.ts", "M", " "),
      makeFileStatus("untracked.ts", "?", "?"),
    ]);
    const diff = makeDiff([{ file: "tracked.ts", insertions: 5, deletions: 2 }]);
    const untrackedDiffs = new Map<string, { insertions: number; deletions: number }>();
    untrackedDiffs.set("untracked.ts", { insertions: 100, deletions: 0 });

    const result = buildGitStatus(status, diff, untrackedDiffs);

    expect(result.files).toHaveLength(2);
    const tracked = result.files.find((f) => f.file === "tracked.ts");
    const untracked = result.files.find((f) => f.file === "untracked.ts");
    expect(tracked?.insertions).toBe(5);
    expect(tracked?.deletions).toBe(2);
    expect(untracked?.insertions).toBe(100);
    expect(untracked?.deletions).toBe(0);
    expect(result.totalInsertions).toBe(105);
    expect(result.totalDeletions).toBe(2);
  });

  it("sets insertions:-1 and deletions:-1 for binary files alongside text files", () => {
    const status = makeStatus([
      makeFileStatus("test.ts", "M", " "),
      makeFileStatus("image.png", "M", " "),
    ]);
    const diff = makeDiff([
      { file: "test.ts", insertions: 3, deletions: 2, binary: false },
      { file: "image.png", insertions: 0, deletions: 0, binary: true },
    ]);

    const result = buildGitStatus(status, diff);
    const binaryFile = result.files.find((f) => f.file === "image.png");
    expect(binaryFile?.insertions).toBe(-1);
    expect(binaryFile?.deletions).toBe(-1);
  });

  it("excludes binary files from totalInsertions/totalDeletions", () => {
    const status = makeStatus([
      makeFileStatus("test.ts", "M", " "),
      makeFileStatus("image.png", "M", " "),
    ]);
    const diff = makeDiff([
      { file: "test.ts", insertions: 3, deletions: 2, binary: false },
      { file: "image.png", insertions: 0, deletions: 0, binary: true },
    ]);

    const result = buildGitStatus(status, diff);
    expect(result.totalInsertions).toBe(3);
    expect(result.totalDeletions).toBe(2);
  });

  it("does not override existing diffMap entries with untracked diffs", () => {
    const status = makeStatus([makeFileStatus("both.ts", "M", " ")]);
    const diff = makeDiff([{ file: "both.ts", insertions: 10, deletions: 5 }]);
    const untrackedDiffs = new Map<string, { insertions: number; deletions: number }>();
    untrackedDiffs.set("both.ts", { insertions: 999, deletions: 999 });

    const result = buildGitStatus(status, diff, untrackedDiffs);

    expect(result.files[0].insertions).toBe(10);
    expect(result.files[0].deletions).toBe(5);
    expect(result.totalInsertions).toBe(10);
    expect(result.totalDeletions).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// getUntrackedFileDiffs
// ---------------------------------------------------------------------------

describe("getUntrackedFileDiffs", () => {
  it("returns empty map for empty file list", async () => {
    const mockGit = { diffSummary: vi.fn() } as unknown as SimpleGit;
    const result = await getUntrackedFileDiffs(mockGit, []);
    expect(result.size).toBe(0);
  });

  it("computes diffs for untracked files", async () => {
    const mockDiffSummary = vi
      .fn()
      .mockResolvedValueOnce({ insertions: 100, deletions: 0 })
      .mockResolvedValueOnce({ insertions: 50, deletions: 5 });
    const mockGit = { diffSummary: mockDiffSummary } as unknown as SimpleGit;

    const result = await getUntrackedFileDiffs(mockGit, ["file1.ts", "file2.ts"]);
    expect(result.get("file1.ts")).toEqual({ insertions: 100, deletions: 0 });
    expect(result.get("file2.ts")).toEqual({ insertions: 50, deletions: 5 });
    expect(mockDiffSummary).toHaveBeenCalledWith(["--no-index", "--", "/dev/null", "file1.ts"]);
    expect(mockDiffSummary).toHaveBeenCalledWith(["--no-index", "--", "/dev/null", "file2.ts"]);
  });

  it("defaults to 0/0 on diff failure", async () => {
    const mockDiffSummary = vi.fn().mockRejectedValue(new Error("binary file"));
    const mockGit = { diffSummary: mockDiffSummary } as unknown as SimpleGit;

    const result = await getUntrackedFileDiffs(mockGit, ["binary.png"]);
    expect(result.get("binary.png")).toEqual({ insertions: 0, deletions: 0 });
  });

  it("caps at 20 files", async () => {
    const mockDiffSummary = vi.fn().mockResolvedValue({ insertions: 10, deletions: 0 });
    const mockGit = { diffSummary: mockDiffSummary } as unknown as SimpleGit;

    const files = Array.from({ length: 30 }, (_, i) => `file${i}.ts`);
    const result = await getUntrackedFileDiffs(mockGit, files);
    expect(result.size).toBe(20);
    expect(mockDiffSummary).toHaveBeenCalledTimes(20);
  });
});
