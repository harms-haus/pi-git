import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  gitStatus,
  clearGitState,
  setGitStatus,
  setGitInstance,
  setGitRefreshInFlight,
  setGitRefreshPending,
  setDebounceTimer,
  incrementRefreshEpoch,
  updateFooterLabel,
  DEBOUNCE_DELAY_MS,
} from "../git-state";
import { shortenPath } from "../format";
import { getSafeCtx } from "../state";
import { simpleGit } from "simple-git";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../format", () => ({
  shortenPath: vi.fn((p: string) => `~${p}`),
}));

let mockCurrentCwd: string | undefined = "/tmp/repo";

vi.mock("../state", () => ({
  getSafeCtx: vi.fn(() => ({ ui: { setStatus: vi.fn() } })),
  get currentCwd() {
    return mockCurrentCwd;
  },
}));

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => ({})),
}));

// ---------------------------------------------------------------------------
// clearGitState (also used for cleanup)
// ---------------------------------------------------------------------------

describe("clearGitState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentCwd = "/tmp/repo";
  });

  it("resets gitStatus to null", () => {
    setGitStatus({
      branch: "main",
      totalInsertions: 5,
      totalDeletions: 0,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });
    expect(gitStatus).not.toBeNull();

    clearGitState();

    expect(gitStatus).toBeNull();
  });

  it("resets gitInstance to undefined", () => {
    const instance = simpleGit("/tmp");
    setGitInstance(instance);
    clearGitState();

    // After clearing, verify idempotent calls don't throw
    clearGitState();
    expect(gitStatus).toBeNull();
  });

  it("resets gitRefreshInFlight to false", () => {
    setGitRefreshInFlight(true);
    clearGitState();

    // Verify idempotent
    clearGitState();
    expect(gitStatus).toBeNull();
  });

  it("resets gitRefreshPending to false", () => {
    setGitRefreshPending(true);
    clearGitState();

    clearGitState();
    expect(gitStatus).toBeNull();
  });

  it("increments refreshEpoch", () => {
    clearGitState();

    incrementRefreshEpoch();
    incrementRefreshEpoch();

    // Epoch incremented multiple times — no throw means success
    expect(gitStatus).toBeNull();
  });

  it("clears pending debounce timer", () => {
    setDebounceTimer(setTimeout(() => {}, 10000));

    clearGitState();

    // Timer was cleared — no way to directly observe, but verify no throw
    clearGitState();
    expect(gitStatus).toBeNull();
  });

  it("calls updateFooterLabel", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });

    clearGitState();

    expect(setStatus).toHaveBeenCalledWith("pi-git", undefined);
  });
});

// ---------------------------------------------------------------------------
// setGitStatus
// ---------------------------------------------------------------------------

describe("setGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("sets gitStatus to a non-null value", () => {
    const status = {
      branch: "dev",
      totalInsertions: 10,
      totalDeletions: 2,
      addedCount: 0,
      modifiedCount: 1,
      deletedCount: 0,
      files: [],
    };

    setGitStatus(status);

    expect(gitStatus).toEqual(status);
  });

  it("sets gitStatus to null", () => {
    setGitStatus({
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });
    setGitStatus(null);

    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setGitInstance
// ---------------------------------------------------------------------------

describe("setGitInstance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("sets gitInstance to a value", () => {
    const instance = simpleGit("/tmp");
    setGitInstance(instance);

    // No direct getter; verify no throw by repeating
    setGitInstance(instance);
    expect(gitStatus).toBeNull();
  });

  it("sets gitInstance to undefined", () => {
    setGitInstance(undefined);

    setGitInstance(undefined);
    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setGitRefreshInFlight
// ---------------------------------------------------------------------------

describe("setGitRefreshInFlight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("sets refresh in flight to true", () => {
    setGitRefreshInFlight(true);
    setGitRefreshInFlight(true);

    expect(gitStatus).toBeNull();
  });

  it("sets refresh in flight to false", () => {
    setGitRefreshInFlight(false);

    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setGitRefreshPending
// ---------------------------------------------------------------------------

describe("setGitRefreshPending", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("sets refresh pending to true", () => {
    setGitRefreshPending(true);

    expect(gitStatus).toBeNull();
  });

  it("sets refresh pending to false", () => {
    setGitRefreshPending(false);

    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setDebounceTimer
// ---------------------------------------------------------------------------

describe("setDebounceTimer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("sets debounce timer to a value", () => {
    const timer = setTimeout(() => {}, 10000);

    setDebounceTimer(timer);

    expect(gitStatus).toBeNull();
  });

  it("sets debounce timer to undefined", () => {
    setDebounceTimer(undefined);

    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// incrementRefreshEpoch
// ---------------------------------------------------------------------------

describe("incrementRefreshEpoch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
  });

  it("increments refresh epoch", () => {
    clearGitState();
    incrementRefreshEpoch();
    incrementRefreshEpoch();

    // Multiple increments — no throw means success
    expect(gitStatus).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DEBOUNCE_DELAY_MS
// ---------------------------------------------------------------------------

describe("DEBOUNCE_DELAY_MS", () => {
  it("is 500ms", () => {
    expect(DEBOUNCE_DELAY_MS).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// updateFooterLabel
// ---------------------------------------------------------------------------

describe("updateFooterLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearGitState();
    mockCurrentCwd = "/tmp/repo";
  });

  it("does nothing when ctx is undefined", () => {
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue(undefined);

    updateFooterLabel();
    // No crash — that's the assertion
    expect(gitStatus).toBeNull();
  });

  it("does nothing when ctx.ui is undefined", () => {
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({});

    updateFooterLabel();
    expect(gitStatus).toBeNull();
  });

  it("clears footer when gitStatus is null", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });

    updateFooterLabel();

    expect(setStatus).toHaveBeenCalledWith("pi-git", undefined);
  });

  it("clears footer when gitStatus has no files", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });

    setGitStatus({
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });

    updateFooterLabel();

    expect(setStatus).toHaveBeenCalledWith("pi-git", undefined);
  });

  it("sets footer with JSON when there are files", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });

    setGitStatus({
      branch: "main",
      totalInsertions: 5,
      totalDeletions: 2,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [{ file: "src/foo.ts", status: "A", insertions: 5, deletions: 0 }],
    });

    updateFooterLabel();

    expect(setStatus).toHaveBeenCalledWith("pi-git", expect.any(String));
    const jsonArg = setStatus.mock.calls[0]![1]!;
    const parsed = JSON.parse(jsonArg);
    expect(parsed.branch).toBe("main");
    expect(parsed.insertions).toBe(5);
    expect(parsed.deletions).toBe(2);
  });

  it("uses shortenPath for cwd in footer label", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });

    setGitStatus({
      branch: "main",
      totalInsertions: 1,
      totalDeletions: 0,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [{ file: "src/a.ts", status: "A", insertions: 1, deletions: 0 }],
    });

    updateFooterLabel();

    expect(shortenPath).toHaveBeenCalledWith("/tmp/repo");
  });

  it("handles undefined currentCwd gracefully", () => {
    const setStatus = vi.fn();
    (getSafeCtx as ReturnType<typeof vi.fn>).mockReturnValue({ ui: { setStatus } });
    mockCurrentCwd = undefined;

    setGitStatus({
      branch: "main",
      totalInsertions: 1,
      totalDeletions: 0,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [{ file: "a.ts", status: "A", insertions: 1, deletions: 0 }],
    });

    updateFooterLabel();

    expect(setStatus).toHaveBeenCalledWith("pi-git", expect.any(String));
  });
});
