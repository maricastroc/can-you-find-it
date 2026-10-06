import sharp from "sharp";
import { chat as ollamaChat, type ChatInput, type ChatResult } from "./ollama";
import { extractJson } from "./json";
import { config } from "./config";
import { COMPARE2_PROMPT, compare2Schema } from "./prompts";
import { headNoun } from "./filters";

export type Verdict = "found" | "almost" | "not_quite";

export type CheckResult = {
  verdict: Verdict;
  shows: string;
  details: string[];
  ms: number;
};

type Raw = { target_details?: unknown; image2_shows?: unknown; same_kind?: unknown; same_object?: unknown };

const stem = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/(es|s)$/, "");

export function namesKind(shows: string, label: string): boolean {
  const head = stem(headNoun(label));
  if (!head) return true;
  return shows.split(/[\s,.;:()-]+/).some((w) => stem(w) === head);
}

export function verdictFrom(raw: unknown, label?: string): Pick<CheckResult, "verdict" | "shows" | "details"> {
  const r = (raw && typeof raw === "object" ? raw : {}) as Raw;
  const details = Array.isArray(r.target_details) ? r.target_details.filter((d): d is string => typeof d === "string") : [];
  const shows = typeof r.image2_shows === "string" ? r.image2_shows : "";
  let verdict: Verdict = r.same_object === true ? "found" : r.same_kind === true ? "almost" : "not_quite";
  if (verdict === "almost" && label && !namesKind(shows, label)) verdict = "not_quite";
  return { verdict, shows, details };
}

export async function compareWithTarget(
  targetCrop: Buffer,
  foundPhoto: Buffer,
  label: string,
  opts: { model: string; signal?: AbortSignal; chat?: (input: ChatInput) => Promise<ChatResult> },
): Promise<CheckResult> {
  const a = await sharp(targetCrop).resize(768, 768, { fit: "inside", withoutEnlargement: false }).jpeg({ quality: 88 }).toBuffer();
  const b = await sharp(foundPhoto).rotate().resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 88 }).toBuffer();
  const r = await (opts.chat ?? ollamaChat)({
    model: opts.model,
    prompt: COMPARE2_PROMPT(label),
    images: [a, b],
    format: compare2Schema,
    options: { temperature: 0, num_predict: config.maxTokens.compare },
    signal: opts.signal,
  });
  return { ...verdictFrom(extractJson(r.content), label), ms: r.ms };
}
