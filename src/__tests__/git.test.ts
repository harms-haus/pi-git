import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGitStatus, refreshGitStatus, debouncedRefreshGitStatus, clearGitState } from "../git";
import type { StatusResult, FileStatusResult, DiffResult } from "simple-git";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockStatus = vi.fn();
const mockDiffSummary = vi.fn();
const mockCheckIsRepo = vi.fn();

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({
    status: mockStatus,
    diffSummary: mockDiffSummary,
    checkIsRepo: mockCheckIsRepo,
  })),
}));

// Mock state module to control currentCwd and currentCtx
const mockState = {
  currentCtx: undefined as unknown,
  currentCwd: undefined as string | undefined,
};

vi.mock("../state", () => ({
  get currentCtx() {
    return mockState.currentCtx;
  },
  get currentCwd() {
    return mockState.currentCwd;
  },
  getSafeCtx: () => mockState.currentCtx,
}));

vi.mock("../format", () => ({
  shortenPath: vi.fn((p: string) => `~${p}`),
}));

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
// buildGitStatus (already well-tested, just verify core behavior)
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
});

// ---------------------------------------------------------------------------
// refreshGitStatus
// ---------------------------------------------------------------------------

describe("refreshGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
    mockState.currentCwd = undefined;
    mockState.currentCtx = undefined;
  });

  it("returns early if no currentCwd", async () => {
    mockState.currentCwd = undefined;

    await refreshGitStatus();

    expect(mockCheckIsRepo).not.toHaveBeenCalled();
  });

  it("clears gitStatus when not a git repo", async () => {
    mockState.currentCwd = "/tmp/not-repo";
    mockState.currentCtx = {
      ui: { setStatus: vi.fn() },
    };

    mockCheckIsRepo.mockResolvedValue(false);

    await refreshGitStatus();

    // Import again to read current gitStatus value
    const mod = await import("../git");
    expect(mod.gitStatus).toBeNull();
  });

  it("sets gitStatus from status + diff", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus: vi.fn() },
    };

    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([makeFileStatus("src/foo.ts", "M", " ")]));
    mockDiffSummary.mockResolvedValue(
      makeDiff([{ file: "src/foo.ts", insertions: 5, deletions: 2 }]),
    );

    await refreshGitStatus();

    // gitStatus should be set
    const mod = await import("../git");
    expect(mod.gitStatus).not.toBeNull();
    expect(mod.gitStatus!.files).toHaveLength(1);
    expect(mod.gitStatus!.branch).toBe("main");
  });

  it("handles diffSummary rejection gracefully", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus: vi.fn() },
    };

    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([makeFileStatus("src/foo.ts", "M", " ")]));
    mockDiffSummary.mockRejectedValue(new Error("diff failed"));

    await refreshGitStatus();

    const mod = await import("../git");
    expect(mod.gitStatus).not.toBeNull();
    expect(mod.gitStatus!.files[0].insertions).toBe(0);
  });

  it("clears gitStatus on unexpected error", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus: vi.fn() },
    };

    mockCheckIsRepo.mockRejectedValue(new Error("unexpected"));

    await refreshGitStatus();

    const mod = await import("../git");
    expect(mod.gitStatus).toBeNull();
  });

  it("handles concurrent refresh (queues pending)", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus: vi.fn() },
    };

    let statusResolve: (val: unknown) => void;
    const statusPromise = new Promise((resolve) => {
      statusResolve = resolve;
    });

    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockReturnValueOnce(statusPromise);
    mockStatus.mockResolvedValue(makeStatus([makeFileStatus("src/foo.ts", "M", " ")]));
    mockDiffSummary.mockResolvedValue(
      makeDiff([{ file: "src/foo.ts", insertions: 5, deletions: 0 }]),
    );

    // First call — will hang
    const firstCall = refreshGitStatus();

    // Second call — should set pending flag
    const secondCall = refreshGitStatus();

    // Resolve the first status call
    statusResolve!(makeStatus([makeFileStatus("src/foo.ts", "M", " ")]));

    await Promise.all([firstCall, secondCall]);

    // Both should complete; checkIsRepo was called at least once
    expect(mockCheckIsRepo).toHaveBeenCalled();
  });

  it("updates footer label with no status when no ctx.ui", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {};

    mockCheckIsRepo.mockResolvedValue(false);

    await refreshGitStatus();

    // No crash — updateFooterLabel handles missing ui
  });

  it("clears footer when gitStatus is null (no files)", async () => {
    const setStatus = vi.fn();
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus },
    };

    mockCheckIsRepo.mockResolvedValue(false);

    await refreshGitStatus();

    expect(setStatus).toHaveBeenCalledWith("pi-git", undefined);
  });

  it("sets footer with JSON when there are files", async () => {
    const setStatus = vi.fn();
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus },
    };

    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([makeFileStatus("src/foo.ts", "M", " ")]));
    mockDiffSummary.mockResolvedValue(
      makeDiff([{ file: "src/foo.ts", insertions: 5, deletions: 2 }]),
    );

    await refreshGitStatus();

    expect(setStatus).toHaveBeenCalledWith("pi-git", expect.any(String));
    const jsonArg = setStatus.mock.calls[0][1];
    const parsed = JSON.parse(jsonArg);
    expect(parsed.branch).toBe("main");
    expect(parsed.insertions).toBe(5);
    expect(parsed.deletions).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// debouncedRefreshGitStatus
// ---------------------------------------------------------------------------

describe("debouncedRefreshGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearGitState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a refresh after 500ms", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {};
    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([]));
    mockDiffSummary.mockResolvedValue(makeDiff([]));

    debouncedRefreshGitStatus();

    // Not called yet — just scheduled
    expect(mockStatus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);

    // After 500ms, the timer fires and refreshGitStatus runs
    // Allow microtasks to settle
    await vi.advanceTimersByTimeAsync(0);
    expect(mockStatus).toHaveBeenCalled();
  });

  it("cancels previous pending refresh when called again", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {};
    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([]));
    mockDiffSummary.mockResolvedValue(makeDiff([]));

    debouncedRefreshGitStatus();
    vi.advanceTimersByTime(300);

    debouncedRefreshGitStatus();
    vi.advanceTimersByTime(300);

    // Only 300ms since last call, not 500ms yet
    expect(mockStatus).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockStatus).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// clearGitState
// ---------------------------------------------------------------------------

describe("clearGitState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels pending debounce timer", async () => {
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {};
    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatus([]));
    mockDiffSummary.mockResolvedValue(makeDiff([]));

    debouncedRefreshGitStatus();
    clearGitState();

    vi.advanceTimersByTime(1000);
    await vi.advanceTimersByTimeAsync(0);

    // Should not have refreshed since timer was cancelled
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it("clears footer label via updateFooterLabel", () => {
    const setStatus = vi.fn();
    mockState.currentCwd = "/tmp/repo";
    mockState.currentCtx = {
      ui: { setStatus },
    };

    clearGitState();

    expect(setStatus).toHaveBeenCalledWith("pi-git", undefined);
  });
});
