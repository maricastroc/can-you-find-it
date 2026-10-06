import sharp from "sharp";
import { chat as ollamaChat, type ChatInput, type ChatResult } from "./ollama";
import { extractJson } from "./json";
import { config } from "./config";
import { COMPARE2_PROMPT, compare2Schema, GENERIC_DISTRACTORS, MATCH_PROMPT, matchSchema, SPOT_PROMPT, spotSchema } from "./prompts";
import { headNoun, withoutLocation } from "./filters";
import { shuffle } from "./engine";

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

type ChatOpts = { model: string; signal?: AbortSignal; chat?: (input: ChatInput) => Promise<ChatResult> };

const seedOf = (text: string) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

const objectOnly = (label: string) => withoutLocation(label).trim() || label;

export function spotOptions(label: string, others: string[]): string[] {
  const target = objectOnly(label);
  const head = stem(headNoun(label));
  const pool = [...new Set([...others.map(objectOnly), ...GENERIC_DISTRACTORS])]
    .filter((o) => o !== target && (!head || stem(headNoun(o)) !== head))
    .slice(0, 4);
  return shuffle([target, ...pool], seedOf(label));
}

export async function judgeFound(
  targetCrop: Buffer,
  foundPhoto: Buffer,
  label: string,
  others: string[],
  opts: ChatOpts,
): Promise<CheckResult> {
  const chat = opts.chat ?? ollamaChat;
  const photo = await sharp(foundPhoto).rotate().resize(768, 768, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  const spot = await chat({
    model: opts.model,
    prompt: SPOT_PROMPT,
    images: [photo],
    format: spotSchema,
    options: { temperature: 0, num_predict: config.maxTokens.verify },
    signal: opts.signal,
  });
  const seen = extractJson(spot.content) as { main_thing?: unknown } | undefined;
  const shows = typeof seen?.main_thing === "string" ? seen.main_thing.trim() : "";
  if (!shows) return { verdict: "not_quite", shows, details: [], ms: spot.ms };
  const options = spotOptions(label, others);
  const match = await chat({
    model: opts.model,
    prompt: MATCH_PROMPT(shows, options),
    format: matchSchema(options),
    options: { temperature: 0, num_predict: config.maxTokens.verify },
    signal: opts.signal,
  });
  const picked = (extractJson(match.content) as { answer?: unknown } | undefined)?.answer;
  if (picked !== objectOnly(label)) return { verdict: "not_quite", shows, details: [], ms: spot.ms + match.ms };
  const compared = await compareWithTarget(targetCrop, foundPhoto, label, opts);
  return { ...compared, shows, ms: spot.ms + match.ms + compared.ms };
}
