import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setApi,
  safeUpdateCtx,
  resetState,
  currentCtx,
  currentCwd,
  isCtxStale,
  getSafeCtx,
} from "../state";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("state", () => {
  beforeEach(() => {
    resetState();
  });

  describe("setApi", () => {
    it("does not throw", () => {
      const mockApi = { on: vi.fn() } as unknown as ExtensionAPI;
      expect(() => {
        setApi(mockApi);
      }).not.toThrow();
    });
  });

  describe("safeUpdateCtx", () => {
    it("sets currentCtx and currentCwd from ctx", () => {
      const ctx = { cwd: "/tmp/repo" } as ExtensionContext;
      const result = safeUpdateCtx(ctx);
      expect(result).toBe(true);
      expect(currentCtx).toBe(ctx);
      expect(currentCwd).toBe("/tmp/repo");
    });

    it("returns false on stale error", () => {
      const ctx = {
        get cwd() {
          throw new Error("stale context");
        },
      } as unknown as ExtensionContext;
      const result = safeUpdateCtx(ctx);
      expect(result).toBe(false);
    });

    it("re-throws non-stale errors", () => {
      const ctx = {
        get cwd() {
          throw new Error("something else");
        },
      } as unknown as ExtensionContext;
      expect(() => safeUpdateCtx(ctx)).toThrow("something else");
    });

    it("updates cwd when called multiple times", () => {
      const ctx1 = { cwd: "/tmp/repo1" } as ExtensionContext;
      const ctx2 = { cwd: "/tmp/repo2" } as ExtensionContext;
      safeUpdateCtx(ctx1);
      expect(currentCwd).toBe("/tmp/repo1");
      safeUpdateCtx(ctx2);
      expect(currentCwd).toBe("/tmp/repo2");
    });
  });

  describe("isCtxStale", () => {
    it("returns false for valid context", () => {
      const ctx = { cwd: "/valid/path" } as unknown as ExtensionContext;
      expect(isCtxStale(ctx)).toBe(false);
    });

    it("returns true for stale context (cwd throws stale error)", () => {
      const ctx = {
        get cwd() {
          throw new Error("stale context");
        },
      } as unknown as ExtensionContext;
      expect(isCtxStale(ctx)).toBe(true);
    });

    it("re-throws non-stale errors", () => {
      const ctx = {
        get cwd() {
          throw new Error("something else");
        },
      } as unknown as ExtensionContext;
      expect(() => isCtxStale(ctx)).toThrow("something else");
    });
  });

  describe("getSafeCtx", () => {
    it("returns undefined when no currentCtx", () => {
      resetState();
      expect(getSafeCtx()).toBeUndefined();
    });

    it("returns context when valid", () => {
      const ctx = { cwd: "/valid" } as unknown as ExtensionContext;
      safeUpdateCtx(ctx);
      expect(getSafeCtx()).toBe(ctx);
    });

    it("returns undefined and clears state for stale context", () => {
      // Create a context that is valid when set but becomes stale
      let shouldThrow = false;
      const ctx = {
        get cwd() {
          if (shouldThrow) throw new Error("stale context");
          return "/valid";
        },
      } as unknown as ExtensionContext;
      safeUpdateCtx(ctx);
      // Now make it stale
      shouldThrow = true;
      expect(getSafeCtx()).toBeUndefined();
      // Verify state was cleared
      expect(currentCtx).toBeUndefined();
      expect(currentCwd).toBeUndefined();
    });
  });

  describe("resetState", () => {
    it("clears currentCtx and currentCwd", () => {
      const ctx = { cwd: "/tmp/repo" } as ExtensionContext;
      safeUpdateCtx(ctx);
      expect(currentCtx).toBeDefined();
      expect(currentCwd).toBeDefined();

      resetState();

      expect(currentCtx).toBeUndefined();
      expect(currentCwd).toBeUndefined();
    });

    it("is safe to call when state is already cleared", () => {
      resetState();
      expect(currentCtx).toBeUndefined();
      expect(currentCwd).toBeUndefined();
    });
  });
});
