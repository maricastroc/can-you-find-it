export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((s): s is string => !!s);
  for (const c of candidates) {
    const start = c.search(/[[{]/);
    if (start < 0) continue;
    const slice = balanced(c, start);
    if (!slice) continue;
    for (const attempt of [slice, slice.replace(/,\s*([}\]])/g, "$1")]) {
      try {
        return JSON.parse(attempt);
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

function balanced(s: string, start: number): string | undefined {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch === "{" ? "}" : "]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return undefined;
      if (stack.length === 0) return s.slice(start, i + 1);
    }
  }
  return undefined;
}
