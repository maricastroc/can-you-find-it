/**
 * Test helper: a fake model client that answers each kind of call (propose,
 * verify, write, compare) from recorded real replies, in order.
 */
import type { ChatInput, ChatResult } from "./ollama";

export type RecordedCall = { kind: string; content: string; ms?: number };

export function kindOf(input: ChatInput): "propose" | "verify" | "write" | "compare" {
  if (input.system?.includes("eye of")) return "propose";
  if (input.system?.includes("prepare a secret target")) return "write";
  if (input.prompt.startsWith("Image 1 is a crop")) return "compare";
  return "verify";
}

export function replayChat(calls: RecordedCall[]) {
  const queues = new Map<string, RecordedCall[]>();
  for (const c of calls) queues.set(c.kind, [...(queues.get(c.kind) ?? []), c]);
  const log: Array<{ kind: string; input: ChatInput }> = [];
  const chat = async (input: ChatInput): Promise<ChatResult> => {
    const kind = kindOf(input);
    log.push({ kind, input });
    const next = queues.get(kind)?.shift();
    if (!next) throw new Error(`replay: no recorded reply left for a ${kind} call`);
    return { content: next.content, ms: next.ms ?? 1, promptTokens: 0, outputTokens: 0 };
  };
  return { chat, log };
}
