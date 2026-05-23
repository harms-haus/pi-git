import { describe, it, expect } from "vitest";
import { formatCounts, STATUS_ICONS } from "../constants";
import type { FileChange } from "../types";

describe("formatCounts", () => {
  it("returns both insertions and deletions when both are positive", () => {
    expect(formatCounts(5, 3)).toEqual(["+5", "-3"]);
  });

  it("returns only insertions when deletions are zero", () => {
    expect(formatCounts(10, 0)).toEqual(["+10"]);
  });

  it("returns only deletions when insertions are zero", () => {
    expect(formatCounts(0, 7)).toEqual(["-7"]);
  });

  it("returns empty array when both are zero", () => {
    expect(formatCounts(0, 0)).toEqual([]);
  });

  it("returns empty array for negative counts", () => {
    expect(formatCounts(-1, -1)).toEqual([]);
  });

  it("returns only insertions when deletions are negative", () => {
    expect(formatCounts(5, -1)).toEqual(["+5"]);
  });

  it("returns only deletions when insertions are negative", () => {
    expect(formatCounts(-1, 5)).toEqual(["-5"]);
  });

  it("handles large numbers", () => {
    expect(formatCounts(1000, 500)).toEqual(["+1000", "-500"]);
  });

  it("handles 1 insertion and 0 deletions", () => {
    expect(formatCounts(1, 0)).toEqual(["+1"]);
  });

  it("handles 0 insertions and 1 deletion", () => {
    expect(formatCounts(0, 1)).toEqual(["-1"]);
  });
});

describe("STATUS_ICONS", () => {
  it("has entries for all valid FileChange status values", () => {
    const validStatuses: Array<FileChange["status"]> = ["A", "M", "D"];
    for (const status of validStatuses) {
      expect(STATUS_ICONS[status]).toBeDefined();
      expect(typeof STATUS_ICONS[status]).toBe("string");
    }
  });

  it("maps each status to a single-character icon", () => {
    for (const icon of Object.values(STATUS_ICONS)) {
      expect(icon).toHaveLength(1);
    }
  });

  it("uses distinct icons for each status", () => {
    const icons = Object.values(STATUS_ICONS);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("covers the same number of statuses as the FileChange union", () => {
    expect(Object.keys(STATUS_ICONS)).toHaveLength(3);
  });
});
