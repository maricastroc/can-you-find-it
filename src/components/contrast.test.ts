import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
};

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast of text tokens (WCAG AA)", () => {
  it.each([
    ["ink on paper", "ink", "paper", 7],
    ["ink-2 on paper", "ink-2", "paper", 4.5],
    ["ink-3 (small muted text) on paper", "ink-3", "paper", 4.5],
    ["paper on ink (primary button)", "paper", "ink", 4.5],
    ["moon on night", "moon", "night", 7],
    ["moon-2 on night", "moon-2", "night", 4.5],
    ["night on moon (primary button at night)", "night", "moon", 4.5],
    ["signal-ink on paper (warning text)", "signal-ink", "paper", 4.5],
  ])("%s ≥ %s:1", (_label, fg, bg, min) => {
    expect(contrast(token(fg as string), token(bg as string))).toBeGreaterThanOrEqual(min as number);
  });

  it("the signal mark stands out from the night background (≥ 3:1 for graphics)", () => {
    expect(contrast(token("signal"), token("night"))).toBeGreaterThanOrEqual(3);
  });
});
