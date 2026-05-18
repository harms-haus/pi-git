import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    watch: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});

vi.mock("node:fs/promises", () => ({
  lstat: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/user"),
}));

vi.mock("node:path", () => ({
  join: (...args: string[]) => args.join("/"),
}));

import { watch, existsSync } from "node:fs";
import { readdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { startWatcher, stopWatcher, isIgnoredPath } from "../watcher";

const mockWatch = vi.mocked(watch);
const mockReaddir = vi.mocked(readdir);
const mockLstat = vi.mocked(lstat);
const mockHomedir = vi.mocked(homedir);
const mockExistsSync = vi.mocked(existsSync);

function makeDirEntry(name: string, isDir: boolean) {
  return {
    name,
    parentPath: "",
    path: "",
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  } as any;
}

function fakeWatcher() {
  return { on: vi.fn(), close: vi.fn() };
}

describe("watcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopWatcher();
    mockReaddir.mockResolvedValue([]);
    mockLstat.mockResolvedValue({ isSymbolicLink: () => false } as never);
    mockExistsSync.mockReturnValue(true);
    mockHomedir.mockReturnValue("/home/user");
  });

  afterEach(() => {
    stopWatcher();
  });

  describe("startWatcher", () => {
    it("creates a watcher on the given directory", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      expect(mockWatch).toHaveBeenCalledWith("/tmp/repo", expect.any(Function));
    });

    it("calls onRefresh when a non-ignored file event occurs", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      // Access the callback passed as the 2nd argument to watch()
      const callback = mockWatch.mock.calls[0][1] as (
        event: string,
        filename: string | null,
      ) => void;
      callback("change", "src/index.ts");

      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it("does not call onRefresh for ignored paths", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      const callback = mockWatch.mock.calls[0][1] as (
        event: string,
        filename: string | null,
      ) => void;
      callback("change", ".git/HEAD");
      callback("change", "node_modules/foo/index.js");

      expect(onRefresh).not.toHaveBeenCalled();
    });

    it("registers an error handler on the watcher", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      expect(fw.on).toHaveBeenCalledWith("error", expect.any(Function));
    });

    it("handles error handler gracefully", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      const errorHandler = fw.on.mock.calls.find((c) => c[0] === "error")![1];
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      errorHandler(new Error("test error"));
      expect(consoleSpy).toHaveBeenCalledWith("[pi-git] watcher error:", "test error");
      consoleSpy.mockRestore();
    });

    it("stops previous watchers before creating new ones", async () => {
      const fw1 = fakeWatcher();
      const fw2 = fakeWatcher();
      mockWatch.mockReturnValueOnce(fw1 as never).mockReturnValueOnce(fw2 as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo1", onRefresh);
      await startWatcher("/tmp/repo2", onRefresh);

      expect(fw1.close).toHaveBeenCalled();
      expect(mockWatch).toHaveBeenCalledTimes(2);
    });

    it("handles exception gracefully", async () => {
      mockReaddir.mockRejectedValue(new Error("not found"));
      const onRefresh = vi.fn();

      // Should not throw
      await expect(startWatcher("/nonexistent", onRefresh)).resolves.toBeUndefined();
    });

    it("creates watchers for subdirectories", async () => {
      const fw1 = fakeWatcher();
      const fw2 = fakeWatcher();
      mockWatch.mockReturnValueOnce(fw1 as never).mockReturnValueOnce(fw2 as never);
      mockReaddir.mockResolvedValueOnce([makeDirEntry("src", true)]).mockResolvedValueOnce([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      expect(mockWatch).toHaveBeenCalledTimes(2);
      expect(mockWatch).toHaveBeenCalledWith("/tmp/repo", expect.any(Function));
      expect(mockWatch).toHaveBeenCalledWith("/tmp/repo/src", expect.any(Function));
    });

    it("skips ignored directories", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValueOnce([
        makeDirEntry("node_modules", true),
        makeDirEntry(".git", true),
        makeDirEntry("src", true),
      ]);
      mockReaddir.mockResolvedValueOnce([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      // root + src only (node_modules and .git skipped)
      expect(mockWatch).toHaveBeenCalledTimes(2);
    });

    it("skips symlinks", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValueOnce([makeDirEntry("link", true)]);
      // lstat is called for the "link" subdir — return true so it's skipped
      mockLstat.mockResolvedValue({ isSymbolicLink: () => true } as never);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);

      // root only (link is symlink, skipped)
      expect(mockWatch).toHaveBeenCalledTimes(1);
    });

    it("rejects cwd when it equals homedir()", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      const onRefresh = vi.fn();

      // homedir() returns "/home/user" by default from our mock
      await startWatcher("/home/user", onRefresh);

      expect(mockWatch).not.toHaveBeenCalled();
    });

    it("rejects cwd when existsSync returns false", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      const onRefresh = vi.fn();

      mockExistsSync.mockReturnValue(false);

      await startWatcher("/tmp/nonexistent", onRefresh);

      expect(mockWatch).not.toHaveBeenCalled();
    });

    it("caps watchers at MAX_WATCHERS (100)", async () => {
      // Generate 150 directory entries in the root to exceed the 100 cap
      const rootEntries = Array.from({ length: 150 }, (_, i) => makeDirEntry(`dir${i}`, true));

      // Each subdir returns empty (no further nesting)
      mockReaddir.mockResolvedValueOnce(rootEntries);
      // Subsequent calls for each subdirectory return empty
      mockReaddir.mockResolvedValue([]);

      // Need enough fake watchers for all calls
      const fakeWatchers = Array.from({ length: 150 }, () => fakeWatcher());
      mockWatch.mockImplementation((() => fakeWatchers.shift()!) as never);

      const onRefresh = vi.fn();

      await startWatcher("/tmp/bigrepo", onRefresh);

      // Should be capped at 100 watchers (root + 99 subdirs)
      expect(mockWatch).toHaveBeenCalledTimes(100);
    });
  });

  describe("stopWatcher", () => {
    it("closes all watchers if active", async () => {
      const fw = fakeWatcher();
      mockWatch.mockReturnValue(fw as never);
      mockReaddir.mockResolvedValue([]);
      const onRefresh = vi.fn();

      await startWatcher("/tmp/repo", onRefresh);
      stopWatcher();

      expect(fw.close).toHaveBeenCalled();
    });

    it("is safe to call when no watcher is active", () => {
      expect(() => {
        stopWatcher();
      }).not.toThrow();
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
