import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import type { GitStatus } from "../types";

// --- Mutable mock state ---
let mockGitStatus: GitStatus | null = null;

// --- Mock: @earendil-works/pi-coding-agent ---
vi.mock("@earendil-works/pi-coding-agent", () => ({
  isBashToolResult: vi.fn(),
  isEditToolResult: vi.fn(),
  isWriteToolResult: vi.fn(),
}));

// --- Mock: @earendil-works/pi-tui ---
vi.mock("@earendil-works/pi-tui", () => ({
  Text: vi.fn((...args: unknown[]) => ({ _args: args })),
}));

// --- Mock: ../state ---
let mockSafeUpdateCtxResult = true;
vi.mock("../state", () => ({
  setApi: vi.fn(),
  safeUpdateCtx: vi.fn(() => mockSafeUpdateCtxResult),
  resetState: vi.fn(),
  getSafeCtx: vi.fn(() => ({ cwd: "/mock" })),
}));

// --- Mock: ../git ---
vi.mock("../git", () => ({
  refreshGitStatus: vi.fn(),
  debouncedRefreshGitStatus: vi.fn(),
  clearGitState: vi.fn(),
  get gitStatus() {
    return mockGitStatus;
  },
}));

// --- Mock: ../watcher ---
vi.mock("../watcher", () => ({
  startWatcher: vi.fn(() => Promise.resolve()),
  stopWatcher: vi.fn(),
}));

// --- Import SUT AFTER all mocks ---
import extension, { resetRegistration } from "../index";
import {
  isBashToolResult,
  isEditToolResult,
  isWriteToolResult,
} from "@earendil-works/pi-coding-agent";
import { setApi, resetState } from "../state";
import { refreshGitStatus, debouncedRefreshGitStatus, clearGitState } from "../git";
import { startWatcher, stopWatcher } from "../watcher";
import { Text } from "@earendil-works/pi-tui";

// --- Helpers ---
function makeMockPi() {
  return {
    on: vi.fn(),
    registerMessageRenderer: vi.fn(),
    sendMessage: vi.fn(),
  };
}

function getHandler(pi: ReturnType<typeof makeMockPi>, event: string): Mock {
  return pi.on.mock.calls.find((c: unknown[]) => c[0] === event)![1] as Mock;
}

function makeTheme() {
  return {
    fg: vi.fn((color: string, text: string) => `<${color}>${text}</${color}>`),
  };
}

// ---------------------------------------------------------------------------
describe("pi-git extension", () => {
  let mockPi: ReturnType<typeof makeMockPi>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRegistration();
    mockGitStatus = null;
    mockSafeUpdateCtxResult = true;
    mockPi = makeMockPi();
    extension(mockPi as unknown as Parameters<typeof extension>[0]);
  });

  // ---- Registration tests ------------------------------------------------

  it("registers event handlers for all required events", () => {
    const events = mockPi.on.mock.calls.map((c: unknown[]) => c[0]);
    expect(events).toContain("session_start");
    expect(events).toContain("session_tree");
    expect(events).toContain("session_shutdown");
    expect(events).toContain("tool_result");
    expect(events).toContain("turn_end");
    expect(events).toContain("agent_end");
  });

  it("registers message renderer for pi-git-summary", () => {
    expect(mockPi.registerMessageRenderer).toHaveBeenCalledWith(
      "pi-git-summary",
      expect.any(Function),
    );
  });

  it("calls setApi with pi", () => {
    expect(setApi).toHaveBeenCalledWith(mockPi);
  });

  // ---- session_start / session_tree handler (shared handleSessionChange) ---

  it.each(["session_start", "session_tree"])("%s starts watcher and triggers refresh", (event) => {
    const handler = getHandler(mockPi, event);
    const ctx = { cwd: "/tmp/repo" };
    handler({}, ctx);

    expect(stopWatcher).toHaveBeenCalled();
    expect(startWatcher).toHaveBeenCalledWith("/tmp/repo", expect.any(Function));
    expect(refreshGitStatus).toHaveBeenCalled();
  });

  it.each(["session_start", "session_tree"])(
    "%s does nothing when safeUpdateCtx returns false",
    (event) => {
      mockSafeUpdateCtxResult = false;
      const handler = getHandler(mockPi, event);
      const ctx = { cwd: "/tmp/repo" };
      handler({}, ctx);

      expect(clearGitState).not.toHaveBeenCalled();
      expect(startWatcher).not.toHaveBeenCalled();
    },
  );

  it("logs warning when startWatcher rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    (startWatcher as unknown as Mock).mockRejectedValue(new Error("watcher boom"));

    const handler = getHandler(mockPi, "session_start");
    const ctx = { cwd: "/tmp/repo" };
    handler({}, ctx);

    // Allow the rejected promise to settle
    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("[pi-git] watcher failed to start:", expect.any(Error));
    });

    warnSpy.mockRestore();
  });

  // ---- session_shutdown handler ------------------------------------------

  it("session_shutdown stops watcher and resets state", () => {
    const handler = getHandler(mockPi, "session_shutdown");
    handler();

    expect(stopWatcher).toHaveBeenCalled();
    expect(clearGitState).toHaveBeenCalled();
    expect(resetState).toHaveBeenCalled();
  });

  // ---- tool_result handler -----------------------------------------------

  it("tool_result triggers debounced refresh for write tool", () => {
    (isWriteToolResult as unknown as Mock).mockReturnValue(true);
    (isEditToolResult as unknown as Mock).mockReturnValue(false);
    (isBashToolResult as unknown as Mock).mockReturnValue(false);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "write" }, ctx);

    expect(debouncedRefreshGitStatus).toHaveBeenCalled();
  });

  it("tool_result triggers debounced refresh for edit tool", () => {
    (isWriteToolResult as unknown as Mock).mockReturnValue(false);
    (isEditToolResult as unknown as Mock).mockReturnValue(true);
    (isBashToolResult as unknown as Mock).mockReturnValue(false);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "edit" }, ctx);

    expect(debouncedRefreshGitStatus).toHaveBeenCalled();
  });

  it("tool_result triggers debounced refresh for bash tool", () => {
    (isWriteToolResult as unknown as Mock).mockReturnValue(false);
    (isEditToolResult as unknown as Mock).mockReturnValue(false);
    (isBashToolResult as unknown as Mock).mockReturnValue(true);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "bash" }, ctx);

    expect(debouncedRefreshGitStatus).toHaveBeenCalled();
  });

  it("tool_result triggers debounced refresh for delegate_to_subagents", () => {
    (isWriteToolResult as unknown as Mock).mockReturnValue(false);
    (isEditToolResult as unknown as Mock).mockReturnValue(false);
    (isBashToolResult as unknown as Mock).mockReturnValue(false);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "delegate_to_subagents" }, ctx);

    expect(debouncedRefreshGitStatus).toHaveBeenCalled();
  });

  it("tool_result does not refresh for other tools", () => {
    (isWriteToolResult as unknown as Mock).mockReturnValue(false);
    (isEditToolResult as unknown as Mock).mockReturnValue(false);
    (isBashToolResult as unknown as Mock).mockReturnValue(false);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "read_file" }, ctx);

    expect(debouncedRefreshGitStatus).not.toHaveBeenCalled();
  });

  it("tool_result does nothing when safeUpdateCtx returns false", () => {
    mockSafeUpdateCtxResult = false;
    (isWriteToolResult as unknown as Mock).mockReturnValue(true);

    const handler = getHandler(mockPi, "tool_result");
    const ctx = { cwd: "/tmp/repo" };
    handler({ toolName: "write" }, ctx);

    expect(debouncedRefreshGitStatus).not.toHaveBeenCalled();
  });

  // ---- turn_end handler --------------------------------------------------

  it("turn_end triggers debounced refresh", () => {
    const handler = getHandler(mockPi, "turn_end");
    const ctx = { cwd: "/tmp/repo" };
    handler({}, ctx);

    expect(debouncedRefreshGitStatus).toHaveBeenCalled();
  });

  it("turn_end does nothing when safeUpdateCtx returns false", () => {
    mockSafeUpdateCtxResult = false;
    const handler = getHandler(mockPi, "turn_end");
    const ctx = { cwd: "/tmp/repo" };
    handler({}, ctx);

    expect(debouncedRefreshGitStatus).not.toHaveBeenCalled();
  });

  // ---- agent_end handler -------------------------------------------------

  it("agent_end sends message when gitStatus has files", async () => {
    mockGitStatus = {
      branch: "main",
      totalInsertions: 5,
      totalDeletions: 2,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [{ file: "src/foo.ts", status: "A", insertions: 5, deletions: 0 }],
    };

    const handler = getHandler(mockPi, "agent_end");
    await handler();

    expect(mockPi.sendMessage).toHaveBeenCalledWith(
      {
        customType: "pi-git-summary",
        content: expect.any(String),
        display: true,
      },
      { triggerTurn: false },
    );

    const sentContent = JSON.parse(
      (mockPi.sendMessage.mock.calls[0][0] as { content: string }).content,
    );
    expect(sentContent.totalFiles).toBe(1);
    expect(sentContent.totalInsertions).toBe(5);
  });

  it("agent_end does nothing when gitStatus is null", async () => {
    mockGitStatus = null;

    const handler = getHandler(mockPi, "agent_end");
    await handler();

    expect(mockPi.sendMessage).not.toHaveBeenCalled();
    expect(refreshGitStatus).toHaveBeenCalled();
  });

  it("agent_end does nothing when gitStatus has no files", async () => {
    mockGitStatus = {
      branch: "main",
      totalInsertions: 0,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      files: [],
    };

    const handler = getHandler(mockPi, "agent_end");
    await handler();

    expect(mockPi.sendMessage).not.toHaveBeenCalled();
  });

  it("agent_end truncates files to 20", async () => {
    mockGitStatus = {
      branch: "main",
      totalInsertions: 60,
      totalDeletions: 0,
      addedCount: 0,
      modifiedCount: 60,
      deletedCount: 0,
      files: Array.from({ length: 60 }, (_, i) => ({
        file: `src/file${i}.ts`,
        status: "M" as const,
        insertions: 1,
        deletions: 0,
      })),
    };

    const handler = getHandler(mockPi, "agent_end");
    await handler();

    const sentContent = JSON.parse(
      (mockPi.sendMessage.mock.calls[0][0] as { content: string }).content,
    );
    expect(sentContent.files).toHaveLength(20);
    expect(sentContent.totalFiles).toBe(60);
  });

  it("agent_end swallows sendMessage errors without rejecting", async () => {
    mockGitStatus = {
      branch: "main",
      totalInsertions: 5,
      totalDeletions: 0,
      addedCount: 1,
      modifiedCount: 0,
      deletedCount: 0,
      files: [{ file: "src/foo.ts", status: "A", insertions: 5, deletions: 0 }],
    };
    mockPi.sendMessage.mockImplementation(() => {
      throw new Error("session closed");
    });

    const handler = getHandler(mockPi, "agent_end");

    // Should resolve without throwing
    await expect(handler()).resolves.toBeUndefined();
    expect(mockPi.sendMessage).toHaveBeenCalled();
  });

  // ---- Message renderer --------------------------------------------------

  describe("pi-git-summary message renderer", () => {
    let renderer: Mock;
    const theme = makeTheme();

    beforeEach(() => {
      renderer = mockPi.registerMessageRenderer.mock.calls.find(
        (c: unknown[]) => c[0] === "pi-git-summary",
      )![1] as Mock;
    });

    it("renders a simple git summary with one file", () => {
      const content = JSON.stringify({
        files: [{ file: "src/foo.ts", status: "A", insertions: 5, deletions: 0 }],
        totalFiles: 1,
        totalInsertions: 5,
        totalDeletions: 0,
        addedCount: 1,
        modifiedCount: 0,
        deletedCount: 0,
      });

      const result = renderer({ content }, {}, theme);

      expect(Text).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("renders modified files with warning icon", () => {
      const content = JSON.stringify({
        files: [{ file: "src/bar.ts", status: "M", insertions: 3, deletions: 1 }],
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("warning", "~");
    });

    it("renders deleted files with error icon", () => {
      const content = JSON.stringify({
        files: [{ file: "src/old.ts", status: "D", insertions: 0, deletions: 10 }],
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("error", "-");
    });

    it("renders added files with success icon", () => {
      const content = JSON.stringify({
        files: [{ file: "src/new.ts", status: "A", insertions: 20, deletions: 0 }],
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("success", "+");
    });

    it("renders header with plural 'files' when more than 1", () => {
      const content = JSON.stringify({
        files: [
          { file: "src/a.ts", status: "M", insertions: 1, deletions: 0 },
          { file: "src/b.ts", status: "M", insertions: 1, deletions: 0 },
        ],
        totalFiles: 2,
        totalInsertions: 2,
        totalDeletions: 0,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("muted", "2 files changed");
    });

    it("renders header with singular 'file' when exactly 1", () => {
      const content = JSON.stringify({
        files: [{ file: "src/a.ts", status: "M", insertions: 1, deletions: 0 }],
        totalFiles: 1,
        totalInsertions: 1,
        totalDeletions: 0,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("muted", "1 file changed");
    });

    it("renders header with insertions and deletions counts", () => {
      const content = JSON.stringify({
        files: [{ file: "src/a.ts", status: "M", insertions: 5, deletions: 3 }],
        totalFiles: 1,
        totalInsertions: 5,
        totalDeletions: 3,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("success", "+5");
      expect(theme.fg).toHaveBeenCalledWith("error", "-3");
    });

    it("shows truncation message when more than 20 files", () => {
      const files = Array.from({ length: 25 }, (_, i) => ({
        file: `src/file${i}.ts`,
        status: "M",
        insertions: 1,
        deletions: 0,
      }));

      const content = JSON.stringify({
        files,
        totalFiles: 25,
        totalInsertions: 25,
        totalDeletions: 0,
        addedCount: 0,
        modifiedCount: 25,
        deletedCount: 0,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("dim", expect.stringContaining("... and 5 more"));
    });

    it("shows remaining counts in truncation message", () => {
      // 25 files: first 20 = 5 A, 5 D, 10 M
      // remaining 5 = 3 A, 0 M, 2 D
      const files = Array.from({ length: 25 }, (_, i) => ({
        file: `src/file${i}.ts`,
        status: i < 5 ? "A" : i < 10 ? "D" : "M",
        insertions: 1,
        deletions: 0,
      }));

      const content = JSON.stringify({
        files,
        totalFiles: 25,
        totalInsertions: 25,
        totalDeletions: 0,
        addedCount: 8,
        modifiedCount: 10,
        deletedCount: 7,
      });

      renderer({ content }, {}, theme);

      // First 20: 5 A, 5 D, 10 M. Remaining: 3 A, 0 M, 2 D
      expect(theme.fg).toHaveBeenCalledWith("dim", expect.stringContaining("3 new"));
      expect(theme.fg).toHaveBeenCalledWith("dim", expect.stringContaining("2 deleted"));
    });

    it("handles invalid JSON gracefully", () => {
      const result = renderer({ content: "not valid json" }, {}, theme);

      expect(Text).toHaveBeenCalledWith(
        expect.stringContaining("Git summary could not be rendered"),
        0,
        0,
      );
      expect(result).toBeDefined();
    });

    it("handles unknown status by using default icon ~", () => {
      const content = JSON.stringify({
        files: [{ file: "src/foo.ts", status: "X", insertions: 0, deletions: 0 }],
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("warning", "~");
    });

    it("computes totals from files when not provided", () => {
      const content = JSON.stringify({
        files: [
          { file: "src/a.ts", status: "M", insertions: 5, deletions: 3 },
          { file: "src/b.ts", status: "A", insertions: 10, deletions: 0 },
        ],
        // No totalInsertions, totalDeletions, totalFiles
      });

      renderer({ content }, {}, theme);

      // 5 + 10 = 15 insertions, 3 deletions
      expect(theme.fg).toHaveBeenCalledWith("success", "+15");
      expect(theme.fg).toHaveBeenCalledWith("error", "-3");
      // 2 files
      expect(theme.fg).toHaveBeenCalledWith("muted", "2 files changed");
    });

    it("renders file with no insertions or deletions (no count parts)", () => {
      const content = JSON.stringify({
        files: [{ file: "src/foo.ts", status: "M", insertions: 0, deletions: 0 }],
        totalFiles: 1,
        totalInsertions: 0,
        totalDeletions: 0,
      });

      renderer({ content }, {}, theme);

      // Icon should be rendered
      expect(theme.fg).toHaveBeenCalledWith("warning", "~");
      // File name should be rendered
      expect(theme.fg).toHaveBeenCalledWith("dim", "src/foo.ts");
    });

    it("renders file with only insertions", () => {
      const content = JSON.stringify({
        files: [{ file: "src/foo.ts", status: "A", insertions: 10, deletions: 0 }],
        totalFiles: 1,
        totalInsertions: 10,
        totalDeletions: 0,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("success", "+10");
    });

    it("renders file with only deletions", () => {
      const content = JSON.stringify({
        files: [{ file: "src/foo.ts", status: "D", insertions: 0, deletions: 7 }],
        totalFiles: 1,
        totalInsertions: 0,
        totalDeletions: 7,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("error", "-7");
    });

    it("handles empty files array", () => {
      const content = JSON.stringify({
        files: [],
        totalFiles: 0,
        totalInsertions: 0,
        totalDeletions: 0,
      });

      const result = renderer({ content }, {}, theme);

      expect(Text).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(theme.fg).toHaveBeenCalledWith("muted", "0 files changed");
    });

    it("truncation with empty remaining description when no added/modified/deleted counts", () => {
      // 25 files but no added/modified/deleted counts (all undefined)
      const files = Array.from({ length: 25 }, (_, i) => ({
        file: `src/file${i}.ts`,
        status: "M",
        insertions: 1,
        deletions: 0,
      }));

      const content = JSON.stringify({
        files,
        totalFiles: 25,
        totalInsertions: 25,
        totalDeletions: 0,
        // No addedCount, modifiedCount, deletedCount
      });

      renderer({ content }, {}, theme);

      // All displayed 20 files are M, so remaining = 0
      expect(theme.fg).toHaveBeenCalledWith("dim", "... and 5 more");
    });

    it("renders (binary) for files with insertions:-1 and deletions:-1", () => {
      const content = JSON.stringify({
        files: [{ file: "image.png", status: "A", insertions: -1, deletions: -1 }],
        totalFiles: 1,
        totalInsertions: 0,
        totalDeletions: 0,
      });

      renderer({ content }, {}, theme);

      expect(theme.fg).toHaveBeenCalledWith("dim", "(binary)");
    });

    it("returns warning text for payload without files array", () => {
      const content = JSON.stringify({ totalFiles: 0 });

      const result = renderer({ content }, {}, theme);

      expect(Text).toHaveBeenCalledWith(
        expect.stringContaining("Invalid git summary payload"),
        0,
        0,
      );
      expect(result).toBeDefined();
    });
  });
});
