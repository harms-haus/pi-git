import { describe, it, expect, vi, beforeEach } from "vitest";
import { setApi, safeUpdateCtx, resetState, _api, currentCtx, currentCwd } from "../state";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("state", () => {
  beforeEach(() => {
    resetState();
  });

  describe("setApi", () => {
    it("stores the API reference", () => {
      const mockApi = { on: vi.fn() } as unknown as ExtensionAPI;
      setApi(mockApi);
      expect(_api).toBe(mockApi);
    });

    it("overwrites previous API reference", () => {
      const mockApi1 = { on: vi.fn() } as unknown as ExtensionAPI;
      const mockApi2 = { on: vi.fn() } as unknown as ExtensionAPI;
      setApi(mockApi1);
      expect(_api).toBe(mockApi1);
      setApi(mockApi2);
      expect(_api).toBe(mockApi2);
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
