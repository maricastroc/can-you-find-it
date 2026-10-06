import { describe, expect, it } from "vitest";
import { extractJson } from "./json";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson("[1,2]")).toEqual([1, 2]);
  });

  it("parses a ```json fenced block (Gemma's native detection format)", () => {
    const reply = '```json\n[\n  {"box_2d": [764, 414, 912, 533], "label": "bench"}\n]\n```';
    expect(extractJson(reply)).toEqual([{ box_2d: [764, 414, 912, 533], label: "bench" }]);
  });

  it("ignores prose around the JSON", () => {
    expect(extractJson('Sure! Here it is: {"ok": true} Hope that helps.')).toEqual({ ok: true });
  });

  it("repairs trailing commas", () => {
    expect(extractJson('{"a": [1, 2,], "b": 2,}')).toEqual({ a: [1, 2], b: 2 });
  });

  it("handles braces inside strings", () => {
    expect(extractJson('{"clue": "it looks like a } or a ]"}')).toEqual({ clue: "it looks like a } or a ]" });
  });

  it("handles escaped quotes", () => {
    expect(extractJson('{"label": "the \\"PRIVATE\\" sign"}')).toEqual({ label: 'the "PRIVATE" sign' });
  });

  it("returns undefined for truncated or missing JSON", () => {
    expect(extractJson('{"targets": [{"label": "bench"')).toBeUndefined();
    expect(extractJson("no json here")).toBeUndefined();
    expect(extractJson("")).toBeUndefined();
  });

  it("returns undefined for mismatched brackets", () => {
    expect(extractJson('{"a": [1, 2}')).toBeUndefined();
  });
});
