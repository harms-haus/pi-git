import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshGitStatus, debouncedRefreshGitStatus } from "../git-refresh";
import type { StatusResult, DiffResult, simpleGit as SimpleGitFn } from "simple-git";
import type { GitStatus } from "../types";

// ---------------------------------------------------------------------------
// Mutable mock state (shared with mocked modules via closures)
// ---------------------------------------------------------------------------

let mockCurrentCwd: string | undefined = "/tmp/repo";
let mockGitRefreshInFlight = false;
let mockGitRefreshPending = false;
let mockDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let mockRefreshEpoch = 0;
let mockGitInstance: ReturnType<typeof SimpleGitFn> | undefined;
let mockGitStatus: GitStatus | null = null;

// simple-git mock functions
const mockStatus = vi.fn();
const mockDiffSummary = vi.fn();
const mockCheckIsRepo = vi.fn();

// tracked setter calls
const setterCalls = {
  setGitStatus: [] as Array<GitStatus | null>,
  setGitInstance: [] as Array<unknown>,
  setGitRefreshInFlight: [] as boolean[],
  setGitRefreshPending: [] as boolean[],
  setDebounceTimer: [] as Array<ReturnType<typeof setTimeout> | undefined>,
};

// ---------------------------------------------------------------------------
// Mock: simple-git
// ---------------------------------------------------------------------------

const mockGit = {
  status: mockStatus,
  diffSummary: mockDiffSummary,
  checkIsRepo: mockCheckIsRepo,
};

vi.mock("simple-git", () => ({
  simpleGit: vi.fn(() => mockGit),
}));

// ---------------------------------------------------------------------------
// Mock: ../git-operations
// ---------------------------------------------------------------------------

const mockBuildGitStatus = vi.fn();

vi.mock("../git-operations", () => ({
  buildGitStatus: (...args: unknown[]) => mockBuildGitStatus(...args),
  mapFileStatus: vi.fn(),
  buildDiffMap: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock: ../git-state
// ---------------------------------------------------------------------------

vi.mock("../git-state", () => ({
  // Getters — return mutable mock state
  get gitStatus() {
    return mockGitStatus;
  },
  get gitInstance() {
    return mockGitInstance;
  },
  get gitRefreshInFlight() {
    return mockGitRefreshInFlight;
  },
  get gitRefreshPending() {
    return mockGitRefreshPending;
  },
  get debounceTimer() {
    return mockDebounceTimer;
  },
  get refreshEpoch() {
    return mockRefreshEpoch;
  },
  get DEBOUNCE_DELAY_MS() {
    return 500;
  },
  // Setters — track calls and update mock state
  setGitStatus: (v: GitStatus | null) => {
    setterCalls.setGitStatus.push(v);
    mockGitStatus = v;
  },
  setGitInstance: (v: unknown) => {
    setterCalls.setGitInstance.push(v);
    mockGitInstance = v as ReturnType<typeof SimpleGitFn>;
  },
  setGitRefreshInFlight: (v: boolean) => {
    setterCalls.setGitRefreshInFlight.push(v);
    mockGitRefreshInFlight = v;
  },
  setGitRefreshPending: (v: boolean) => {
    setterCalls.setGitRefreshPending.push(v);
    mockGitRefreshPending = v;
  },
  setDebounceTimer: (v: ReturnType<typeof setTimeout> | undefined) => {
    setterCalls.setDebounceTimer.push(v);
    mockDebounceTimer = v;
  },
  incrementRefreshEpoch: () => {
    mockRefreshEpoch++;
  },
  updateFooterLabel: vi.fn(),
  clearGitState: vi.fn(() => {
    mockGitStatus = null;
    mockGitInstance = undefined;
    mockGitRefreshInFlight = false;
    mockGitRefreshPending = false;
    mockRefreshEpoch++;
  }),
}));

// ---------------------------------------------------------------------------
// Mock: ../state
// ---------------------------------------------------------------------------

let mockSafeCtx: unknown = { ui: { setStatus: vi.fn() } };

vi.mock("../state", () => ({
  get currentCwd() {
    return mockCurrentCwd;
  },
  getSafeCtx: () => {
    return mockSafeCtx;
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatusResult(files: StatusResult["files"] = [], branch = "main"): StatusResult {
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
    detached: false,
    isClean: () => files.length === 0,
  };
}

function makeDiffResult(): DiffResult {
  return {
    changed: 0,
    insertions: 0,
    deletions: 0,
    files: [],
  };
}

// ---------------------------------------------------------------------------
// Tests: refreshGitStatus
// ---------------------------------------------------------------------------

describe("refreshGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mutable mock state
    mockCurrentCwd = "/tmp/repo";
    mockGitRefreshInFlight = false;
    mockGitRefreshPending = false;
    mockDebounceTimer = undefined;
    mockRefreshEpoch = 0;
    mockGitInstance = undefined;
    mockGitStatus = null;
    mockSafeCtx = { ui: { setStatus: vi.fn() } };

    // Reset tracked setter calls
    setterCalls.setGitStatus = [];
    setterCalls.setGitInstance = [];
    setterCalls.setGitRefreshInFlight = [];
    setterCalls.setGitRefreshPending = [];
    setterCalls.setDebounceTimer = [];

    // Default mock implementations
    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatusResult());
    mockDiffSummary.mockResolvedValue(makeDiffResult());
    mockBuildGitStatus.mockReturnValue({
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });
  });

  // --- Basic refresh ---

  it("calls buildGitStatus with status and diff results", async () => {
    const statusResult = makeStatusResult();
    const diffResult = makeDiffResult();
    mockStatus.mockResolvedValue(statusResult);
    mockDiffSummary.mockResolvedValue(diffResult);

    await refreshGitStatus();

    expect(mockBuildGitStatus).toHaveBeenCalledWith(statusResult, diffResult, undefined);
  });

  it("sets gitStatus with the result from buildGitStatus", async () => {
    const builtStatus: GitStatus = {
      branch: "feature",
      totalInsertions: 10,
      totalDeletions: 5,
      addedCount: 1,
      modifiedCount: 1,
      deletedCount: 0,
      files: [{ file: "a.ts", status: "M", insertions: 10, deletions: 5 }],
    };
    mockBuildGitStatus.mockReturnValue(builtStatus);

    await refreshGitStatus();

    expect(setterCalls.setGitStatus).toContainEqual(builtStatus);
  });

  it("calls updateFooterLabel after successful refresh", async () => {
    await refreshGitStatus();

    const { updateFooterLabel } = await import("../git-state");
    expect(updateFooterLabel).toHaveBeenCalled();
  });

  it("creates gitInstance via simpleGit when not set", async () => {
    mockGitInstance = undefined;

    await refreshGitStatus();

    expect(setterCalls.setGitInstance.length).toBeGreaterThanOrEqual(1);
  });

  // --- Early returns ---

  it("returns early when currentCwd is undefined", async () => {
    mockCurrentCwd = undefined;

    await refreshGitStatus();

    expect(mockCheckIsRepo).not.toHaveBeenCalled();
  });

  it("returns early when currentCwd is not absolute", async () => {
    mockCurrentCwd = "relative/path";

    await refreshGitStatus();

    expect(mockCheckIsRepo).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  // --- Not a repo ---

  it("sets null status when not a git repo", async () => {
    mockCheckIsRepo.mockResolvedValue(false);

    await refreshGitStatus();

    expect(setterCalls.setGitStatus).toContainEqual(null);
  });

  it("updates footer when not a git repo", async () => {
    mockCheckIsRepo.mockResolvedValue(false);

    await refreshGitStatus();

    const { updateFooterLabel } = await import("../git-state");
    expect(updateFooterLabel).toHaveBeenCalled();
  });

  // --- Diff failure handled gracefully ---

  it("passes undefined diff when diffSummary rejects", async () => {
    mockDiffSummary.mockRejectedValue(new Error("no HEAD"));

    await refreshGitStatus();

    expect(mockBuildGitStatus).toHaveBeenCalledWith(expect.anything(), undefined, undefined);
  });

  // --- Stale ctx ---

  it("returns early when ctx becomes stale after async work", async () => {
    mockSafeCtx = undefined;

    await refreshGitStatus();

    // Should NOT have stored the built status
    expect(setterCalls.setGitStatus).not.toContainEqual(
      expect.objectContaining({ branch: "main" }),
    );
  });

  // --- Stale epoch ---

  it("returns early when epoch changed during async work", async () => {
    let statusResolve: ((v: StatusResult) => void) | undefined;
    mockStatus.mockImplementation(
      () =>
        new Promise<StatusResult>((resolve) => {
          statusResolve = resolve;
        }),
    );

    const refreshPromise = refreshGitStatus();

    // Flush microtasks so checkIsRepo resolves and status() gets called
    await vi.advanceTimersByTimeAsync(0);

    // Now statusResolve should be assigned
    expect(statusResolve).toBeDefined();

    // Advance epoch while status() is pending
    mockRefreshEpoch = 99;

    statusResolve!(makeStatusResult());

    await refreshPromise;

    expect(mockBuildGitStatus).not.toHaveBeenCalled();
  });

  it("discards results if epoch changes during refresh via clearGitState", async () => {
    let statusResolve: ((v: StatusResult) => void) | undefined;
    mockStatus.mockImplementation(
      () =>
        new Promise<StatusResult>((resolve) => {
          statusResolve = resolve;
        }),
    );
    mockDiffSummary.mockResolvedValue(makeDiffResult());
    mockCheckIsRepo.mockResolvedValue(true);

    // Start refresh
    const refreshPromise = refreshGitStatus();

    // Flush microtasks so checkIsRepo resolves and status() gets called
    await vi.advanceTimersByTimeAsync(0);
    expect(statusResolve).toBeDefined();

    // Simulate clearGitState being called while refresh is in-flight
    const { clearGitState } = await import("../git-state");
    clearGitState();

    // Now resolve the status promise
    statusResolve!(makeStatusResult());

    await refreshPromise;

    // buildGitStatus should NOT have been called (stale results discarded)
    expect(mockBuildGitStatus).not.toHaveBeenCalled();
    // gitStatus should be null (cleared by clearGitState)
    expect(mockGitStatus).toBeNull();
  });

  // --- Error handling ---

  it("clears status on unexpected error", async () => {
    mockCheckIsRepo.mockRejectedValue(new Error("catastrophic failure"));

    await refreshGitStatus();

    expect(setterCalls.setGitStatus).toContainEqual(null);
  });

  it("updates footer on unexpected error", async () => {
    mockCheckIsRepo.mockRejectedValue(new Error("catastrophic failure"));

    await refreshGitStatus();

    const { updateFooterLabel } = await import("../git-state");
    expect(updateFooterLabel).toHaveBeenCalled();
  });

  // --- In-flight guard ---

  it("sets pending when refresh is already in flight", async () => {
    mockGitRefreshInFlight = true;

    await refreshGitStatus();

    expect(setterCalls.setGitRefreshPending).toContain(true);
    expect(mockCheckIsRepo).not.toHaveBeenCalled();
  });

  // --- Finally block: resets in-flight and triggers pending ---

  it("resets gitRefreshInFlight to false in finally block", async () => {
    await refreshGitStatus();

    const flightCalls = setterCalls.setGitRefreshInFlight;
    expect(flightCalls[flightCalls.length - 1]).toBe(false);
  });

  it("triggers pending refresh via microtask when pending was set", async () => {
    let firstResolve: () => void;
    mockCheckIsRepo.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          firstResolve = () => {
            resolve(true);
          };
        }),
    );

    const firstRefresh = refreshGitStatus();

    // While first is in-flight, trigger second (sets pending)
    mockGitRefreshInFlight = true;
    const secondRefresh = refreshGitStatus();

    // Resolve the first checkIsRepo
    mockGitRefreshInFlight = false;
    firstResolve!();

    await firstRefresh;
    await secondRefresh;

    expect(setterCalls.setGitRefreshPending).toContain(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: debouncedRefreshGitStatus
// ---------------------------------------------------------------------------

describe("debouncedRefreshGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset mutable mock state
    mockGitRefreshInFlight = false;
    mockGitRefreshPending = false;
    mockDebounceTimer = undefined;
    mockRefreshEpoch = 0;
    mockGitInstance = undefined;
    mockGitStatus = null;
    mockCurrentCwd = "/tmp/repo";
    mockSafeCtx = { ui: { setStatus: vi.fn() } };

    // Reset tracked setter calls
    setterCalls.setDebounceTimer = [];
    setterCalls.setGitStatus = [];
    setterCalls.setGitInstance = [];
    setterCalls.setGitRefreshInFlight = [];
    setterCalls.setGitRefreshPending = [];

    // Default mock implementations for refreshGitStatus
    mockCheckIsRepo.mockResolvedValue(true);
    mockStatus.mockResolvedValue(makeStatusResult());
    mockDiffSummary.mockResolvedValue(makeDiffResult());
    mockBuildGitStatus.mockReturnValue({
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    });
  });

  it("sets a debounce timer", () => {
    debouncedRefreshGitStatus();

    const timerCalls = setterCalls.setDebounceTimer;
    expect(timerCalls.length).toBeGreaterThanOrEqual(1);
    expect(timerCalls[0]).not.toBeUndefined();
  });

  it("calls refreshGitStatus after debounce delay", async () => {
    debouncedRefreshGitStatus();

    expect(mockCheckIsRepo).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(mockCheckIsRepo).toHaveBeenCalled();
  });

  it("clears previous timer when called again", () => {
    debouncedRefreshGitStatus();
    debouncedRefreshGitStatus();

    expect(setterCalls.setDebounceTimer.length).toBeGreaterThanOrEqual(2);
  });

  it("clears timer in the timeout callback", async () => {
    debouncedRefreshGitStatus();

    await vi.advanceTimersByTimeAsync(500);

    expect(setterCalls.setDebounceTimer).toContain(undefined);
  });
});
