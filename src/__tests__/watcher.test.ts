import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startWatcher, stopWatcher, isIgnoredPath } from "../watcher";
import { watch } from "node:fs";

vi.mock("node:fs", () => ({
  watch: vi.fn(),
}));

const mockWatch = vi.mocked(watch);

describe("watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopWatcher();
  });

  afterEach(() => {
    stopWatcher();
  });

  describe("startWatcher", () => {
    it("creates a watcher on the given directory", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);

      expect(mockWatch).toHaveBeenCalledWith(
        "/tmp/repo",
        { recursive: true },
        expect.any(Function),
      );
    });

    it("calls onRefresh when a non-ignored file event occurs", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);

      // Access the callback passed as the 3rd argument to watch()
      const calls = mockWatch.mock.calls as Array<Array<unknown>>;
      const callback = calls[0][2] as (event: string, filename: string | null) => void;
      callback("change", "src/index.ts");

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("does not call onRefresh for ignored paths", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);

      const calls = mockWatch.mock.calls as Array<Array<unknown>>;
      const callback = calls[0][2] as (event: string, filename: string | null) => void;
      callback("change", ".git/HEAD");
      callback("change", "node_modules/foo/index.js");

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("registers an error handler on the watcher", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);

      expect(fakeWatcher.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("handles error handler gracefully", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);

      const errorHandler = fakeWatcher.on.mock.calls.find((c) => c[0] === "error")![1];
      // Should not throw
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      errorHandler(new Error("test error"));
      expect(consoleSpy).toHaveBeenCalledWith("[pi-git] watcher error:", "test error");
      consoleSpy.mockRestore();
    });

    it("stops previous watcher before creating a new one", () => {
      const fakeWatcher1 = { on: vi.fn(), close: vi.fn() };
      const fakeWatcher2 = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValueOnce(fakeWatcher1 as never);
      mockWatch.mockReturnValueOnce(fakeWatcher2 as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo1", onRefresh);
      startWatcher("/tmp/repo2", onRefresh);

      expect(fakeWatcher1.close).toHaveBeenCalled();
      expect(mockWatch).toHaveBeenCalledTimes(2);
    });

    it("handles exception from fs.watch gracefully", () => {
      mockWatch.mockImplementation(() => {
        throw new Error("not supported");
      });
      const onRefresh = vi.fn();

      // Should not throw
      expect(() => startWatcher("/nonexistent", onRefresh)).not.toThrow();
    });
  });

  describe("stopWatcher", () => {
    it("closes the watcher if one is active", () => {
      const fakeWatcher = { on: vi.fn(), close: vi.fn() };
      mockWatch.mockReturnValue(fakeWatcher as never);
      const onRefresh = vi.fn();

      startWatcher("/tmp/repo", onRefresh);
      stopWatcher();

      expect(fakeWatcher.close).toHaveBeenCalled();
    });

    it("is safe to call when no watcher is active", () => {
      expect(() => stopWatcher()).not.toThrow();
    });
  });

  describe("isIgnoredPath", () => {
    it("returns true for .git paths", () => {
      expect(isIgnoredPath(".git/HEAD")).toBe(true);
    });

    it("returns true for node_modules paths", () => {
      expect(isIgnoredPath("node_modules/foo/bar")).toBe(true);
    });

    it("returns false for src paths", () => {
      expect(isIgnoredPath("src/index.ts")).toBe(false);
    });

    it("returns true for null input", () => {
      expect(isIgnoredPath(null)).toBe(true);
    });
  });
});
