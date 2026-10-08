import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it.each([
    [42, "42 s"],
    [240, "4 min 0 s"],
    [3600, "1 h"],
    [5400, "1 h 30 min"],
    [86_400, "1 day"],
    [3 * 86_400 + 500, "3 days"],
  ])("%i s reads as %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
