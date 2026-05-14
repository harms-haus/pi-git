import { describe, it, expect } from "vitest";
import { buildGitStatus } from "../git";
import type { StatusResult, FileStatusResult, DiffResult } from "simple-git";

// ---------------------------------------------------------------------------
// Helpers to construct simple-git StatusResult / DiffResult mocks
// ---------------------------------------------------------------------------

function makeFileStatus(
  path: string,
  index: string,
  working_dir: string,
  from?: string,
): FileStatusResult {
  return { path, index, working_dir, ...(from ? { from } : {}) };
}

function makeStatus(files: FileStatusResult[]): StatusResult {
  return {
    not_added: files
      .filter((f) => f.working_dir === "?")
      .map((f) => f.path),
    conflicted: [],
    created: files
      .filter((f) => f.index === "A" || f.working_dir === "A")
      .map((f) => f.path),
    deleted: files
      .filter((f) => f.index === "D" || f.working_dir === "D")
      .map((f) => f.path),
    modified: files
      .filter((f) => f.index === "M" || f.working_dir === "M")
      .map((f) => f.path),
    renamed: files
      .filter((f) => f.index === "R" || f.working_dir === "R")
      .map((f) => ({ from: f.from ?? f.path, to: f.path })),
    staged: [],
    files,
    ahead: 0,
    behind: 0,
    current: "main",
    tracking: "origin/main",
    detached: false,
    isClean: () => files.length === 0,
  };
}

function makeDiff(
  files: Array<{
    file: string;
    insertions: number;
    deletions: number;
    binary?: boolean;
  }>,
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
    expect(result.addedCount).toBe(0);
    expect(result.deletedCount).toBe(0);
    expect(result.files).toHaveLength(2);
  });

  it("handles untracked files as Added", () => {
    const status = makeStatus([
      makeFileStatus("src/tracked.ts", " ", "M"),
      makeFileStatus("untracked.txt", "?", "?"),
    ]);
    const diff = makeDiff([
      { file: "src/tracked.ts", insertions: 5, deletions: 2 },
    ]);

    const result = buildGitStatus(status, diff);

    expect(result.files).toHaveLength(2);
    const untracked = result.files.find((f) => f.file === "untracked.txt");
    expect(untracked).toEqual({
      file: "untracked.txt",
      status: "A",
      insertions: 0,
      deletions: 0,
    });
    expect(result.addedCount).toBe(1); // ?? counts as added
    expect(result.modifiedCount).toBe(1);
  });

  it("handles added files", () => {
    const status = makeStatus([
      makeFileStatus("src/new.ts", "A", " "),
    ]);
    const diff = makeDiff([
      { file: "src/new.ts", insertions: 20, deletions: 0 },
    ]);

    const result = buildGitStatus(status, diff);

    expect(result.addedCount).toBe(1);
    expect(result.files[0].status).toBe("A");
    expect(result.files[0].insertions).toBe(20);
  });

  it("handles deleted files", () => {
    const status = makeStatus([
      makeFileStatus("src/old.ts", "D", " "),
    ]);

    const result = buildGitStatus(status);

    expect(result.deletedCount).toBe(1);
    expect(result.files[0].status).toBe("D");
  });

  it("handles renamed files as Added (new path)", () => {
    const status = makeStatus([
      makeFileStatus("src/new-name.ts", "R", " ", "src/old-name.ts"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe("src/new-name.ts");
    expect(result.files[0].status).toBe("A");
    expect(result.addedCount).toBe(1);
  });

  it("handles copied files as Added", () => {
    const status = makeStatus([
      makeFileStatus("src/copy.ts", "C", " ", "src/original.ts"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files[0].file).toBe("src/copy.ts");
    expect(result.files[0].status).toBe("A");
  });

  it("handles type-changed files as Modified", () => {
    const status = makeStatus([
      makeFileStatus("src/symlink", "T", " "),
    ]);

    const result = buildGitStatus(status);

    expect(result.files[0].status).toBe("M");
    expect(result.modifiedCount).toBe(1);
  });

  it("handles conflict codes (UU) as Modified", () => {
    const status = makeStatus([
      makeFileStatus("src/conflict.ts", "U", "U"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files[0].status).toBe("M");
    expect(result.modifiedCount).toBe(1);
  });

  it("handles staged modification with unstaged modification (MM)", () => {
    const status = makeStatus([
      makeFileStatus("src/foo.ts", "M", "M"),
    ]);
    const diff = makeDiff([
      { file: "src/foo.ts", insertions: 15, deletions: 8 },
    ]);

    const result = buildGitStatus(status, diff);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].status).toBe("M");
    expect(result.files[0].insertions).toBe(15);
    expect(result.files[0].deletions).toBe(8);
  });

  it("handles added then modified (AM)", () => {
    const status = makeStatus([
      makeFileStatus("src/new.ts", "A", "M"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files[0].status).toBe("A");
    expect(result.addedCount).toBe(1);
  });

  it("handles working-tree delete ( D) as Deleted", () => {
    const status = makeStatus([
      makeFileStatus("src/gone.ts", " ", "D"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files[0].status).toBe("D");
    expect(result.deletedCount).toBe(1);
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
    (status as Record<string, unknown>).current = null;
    (status as Record<string, unknown>).detached = true;

    const result = buildGitStatus(status);

    expect(result.branch).toBe("detached");
  });

  it("handles binary files in diff (insertions=-1)", () => {
    const status = makeStatus([
      makeFileStatus("image.png", "M", " "),
    ]);
    const diff = makeDiff([
      { file: "image.png", insertions: 0, deletions: 0, binary: true },
    ]);

    const result = buildGitStatus(status, diff);

    expect(result.files[0].insertions).toBe(-1);
    expect(result.files[0].deletions).toBe(-1);
    // Binary excluded from totals
    expect(result.totalInsertions).toBe(0);
    expect(result.totalDeletions).toBe(0);
  });

  it("works without diff (no diff argument)", () => {
    const status = makeStatus([
      makeFileStatus("src/foo.ts", "M", " "),
      makeFileStatus("new.txt", "?", "?"),
    ]);

    const result = buildGitStatus(status);

    expect(result.files).toHaveLength(2);
    // No diff means all insertions/deletions are 0
    expect(result.files[0].insertions).toBe(0);
    expect(result.totalInsertions).toBe(0);
  });

  it("counts added (A), modified (M), deleted (D) correctly", () => {
    const status = makeStatus([
      makeFileStatus("src/added.ts", "A", " "),
      makeFileStatus("src/modified.ts", "M", " "),
      makeFileStatus("src/deleted.ts", "D", " "),
      makeFileStatus("untracked.txt", "?", "?"),
    ]);

    const result = buildGitStatus(status);

    expect(result.addedCount).toBe(2); // A + untracked-as-A
    expect(result.modifiedCount).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.files).toHaveLength(4);
  });
});
