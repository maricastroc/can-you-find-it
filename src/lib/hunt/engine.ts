import sharp from "sharp";
import { chat as ollamaChat, type ChatInput, type ChatResult } from "./ollama";
import { extractJson } from "./json";
import { expand, fromBox2d, toPixels, type Box } from "./geometry";
import { rejectTarget } from "./filters";
import {
  GENERIC_DISTRACTORS,
  LENS_MENU,
  lensFor,
  MCQ_PROMPT,
  mcqSchema,
  MENU_WRITER_PROMPT,
  MENU_WRITER_SYSTEM,
  menuWriterSchema,
  type LensId,
} from "./prompts";

export const PICK_SYSTEM = `You are the eye of "Can You Find It?", a real-world game.
A person is standing in a public place and took one wide photo of what is in front of them.
You secretly pick something in the photo. They will put the phone away and look for it with their own eyes.

How to pick a target:
- Only objects you can see with certainty. Never invent or assume details you cannot clearly see.
- ONE specific, distinctive object you could point at with a finger: a sign, a plaque, a number, a lamp, a sculpture, a bin, a gate, a drain cover, a mailbox, a planter, a bike rack, a poster, a flag, a clock, a small statue, something attached to a pole or a wall, a plant growing somewhere unusual...
- Unique in the scene: if there are several similar ones, pick the one that is clearly different, or pick something else.
- Never an area or a mass: trees, foliage, grass, sky, water, a whole building or wall, a row of windows, the path, the ground.
- Reachable on foot and recognisable up close. Not tiny and far away, not across water.
- Not the biggest or most obvious thing in the photo (not the main fountain, not the playground, not the bench right in front of the camera).
- Never a person, an animal, a vehicle, faces, license plates, or the doors and windows of people's homes. Nothing that requires crossing traffic, entering private property, climbing or touching.

For each target:
- label: what it is and what makes it unique, 3-8 words, appearance only, never its position in the photo.
- box_2d: [ymin, xmin, ymax, xmax] on a 0-1000 grid, tightly around the target only.
- similar_count: how many OTHER objects of the same kind are visible in the photo (0 if it is the only one).`;

export const PICK_PROMPT = (n: number) => `Pick the ${n} best different targets in this photo, best first.`;

export const DEFAULT_CANDIDATES = 2;
export const MODEL_SIDE = 1920;
export const VERIFY_SIDE = 768;

export const pickSchema = (n: number) => ({
  type: "object",
  properties: {
    targets: {
      type: "array",
      minItems: n,
      maxItems: n,
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          box_2d: { type: "array", items: { type: "integer" }, minItems: 4, maxItems: 4 },
          similar_count: { type: "integer" },
        },
        required: ["label", "box_2d", "similar_count"],
      },
    },
  },
  required: ["targets"],
});

export type Proposal = {
  label: string;
  box_2d: unknown;
  similar_count?: number;
  difficulty?: "easy" | "medium" | "hard";
};

export type Texts = {
  lens: LensId;
  clue: string;
  evidence: string;
  hint_semantic: string;
  hint_concrete: string;
  detail: string;
};

export type Step = { kind: string; ms: number; promptTokens: number; outputTokens: number; raw: string };

export type Verification = {
  options: string[];
  answer: string;
  what_i_see: string;
  personAtTarget: boolean;
  pass: boolean;
};

export type EngineCandidate = Proposal & {
  idx: number;
  box?: Box;
  boxProblem?: string;
  rejected?: string;
  verify?: Verification;
};

export type ChatFn = (input: ChatInput) => Promise<ChatResult>;

export type EngineOptions = {
  model: string;
  chat?: ChatFn;
  candidates?: number;
  modelSide?: number;
  temperature?: number;
  verifyAll?: boolean;
};

export type EngineResult = {
  candidates: EngineCandidate[];
  chosen?: number;
  lens?: LensId;
  clue?: string;
  steps: Step[];
  waitMs: number;
};

const toStep = (kind: string, r: ChatResult): Step => ({
  kind, ms: r.ms, promptTokens: r.promptTokens, outputTokens: r.outputTokens, raw: r.content,
});

export function screen(p: Proposal): Pick<EngineCandidate, "box" | "boxProblem" | "rejected"> {
  const parsed = fromBox2d(p.box_2d);
  if (!parsed.ok) return { boxProblem: parsed.problem };
  const rejected = rejectTarget(p.label, parsed.box) ?? ((p.similar_count ?? 0) >= 3 ? "not_unique" : undefined);
  return { box: parsed.box, rejected };
}

export function rank(cands: EngineCandidate[]): EngineCandidate[] {
  const ok = cands.filter((c) => c.box && !c.rejected);
  const penalty = (c: EngineCandidate) => ((c.similar_count ?? 0) >= 1 ? 1 : 0);
  return [...ok].sort((a, b) => penalty(a) - penalty(b) || a.idx - b.idx);
}

export async function cropFor(
  image: Buffer,
  box: Box,
  kind: "verify" | "context",
  side = 1024,
): Promise<{ buffer: Buffer; region: Box }> {
  const meta = await sharp(image).metadata();
  const W = meta.width!, H = meta.height!;
  const region =
    kind === "verify"
      ? expand(box, { pad: 0.2, minSide: 0.08, aspect: W / H })
      : expand(box, { pad: 0.6, minSide: 0.18, aspect: W / H });
  const buffer = await sharp(image)
    .extract(toPixels(region, W, H))
    .resize(side, side, { fit: "inside", withoutEnlargement: false })
    .jpeg({ quality: 88 })
    .toBuffer();
  return { buffer, region };
}

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;

export function shuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export async function proposeTargets(image: Buffer, opts: EngineOptions): Promise<{ candidates: EngineCandidate[]; step: Step }> {
  const n = opts.candidates ?? DEFAULT_CANDIDATES;
  const side = opts.modelSide ?? MODEL_SIDE;
  const wide = await sharp(image).resize(side, side, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  const r = await (opts.chat ?? ollamaChat)({
    model: opts.model,
    system: PICK_SYSTEM,
    prompt: PICK_PROMPT(n),
    images: [wide],
    format: pickSchema(n),
    options: { temperature: opts.temperature ?? 0.6 },
  });
  const parsed = extractJson(r.content) as { targets?: Proposal[] } | undefined;
  const proposals = (parsed?.targets ?? []).filter((t) => t && typeof t.label === "string");
  return { candidates: proposals.map((p, idx) => ({ ...p, idx, ...screen(p) })), step: toStep("propose", r) };
}

export async function verifyCandidate(
  image: Buffer,
  c: EngineCandidate,
  all: EngineCandidate[],
  opts: EngineOptions,
): Promise<{ verify: Verification; step: Step }> {
  const { buffer, region } = await cropFor(image, c.box!, "verify", VERIFY_SIDE);
  const others = all.filter((o) => o !== c && o.box && !inside(center(o.box), region)).map((o) => o.label);
  const pool = [...new Set([...others, ...GENERIC_DISTRACTORS])].filter((l) => l !== c.label).slice(0, 3);
  const options = shuffle([c.label, ...pool], c.idx + 7);
  const r = await (opts.chat ?? ollamaChat)({
    model: opts.model,
    prompt: MCQ_PROMPT(options),
    images: [buffer],
    format: mcqSchema(options),
    options: { temperature: 0 },
  });
  const out = extractJson(r.content) as { what_i_see?: string; answer?: string; person_at_target?: boolean } | undefined;
  const answer = String(out?.answer ?? "none");
  const personAtTarget = out?.person_at_target === true;
  return {
    verify: { options, answer, what_i_see: String(out?.what_i_see ?? ""), personAtTarget, pass: answer === c.label && !personAtTarget },
    step: toStep(`verify:${c.idx}`, r),
  };
}

const PERCEPTUAL: ReadonlySet<LensId> = new Set<LensId>([
  "nature_taking_back", "someone_was_here", "repaired", "doesnt_belong", "plain_sight", "look_up", "underfoot", "handmade", "only_color",
]);

export function chooseLens(label: string, modelChoice: string | undefined, box: Box): LensId {
  const byRule = lensFor(label);
  if (byRule) return byRule;
  if (modelChoice && PERCEPTUAL.has(modelChoice as LensId)) return modelChoice as LensId;
  if (box.y + box.h < 0.45) return "look_up";
  if (box.y > 0.75) return "underfoot";
  return "plain_sight";
}

export const lineFor = (lens: LensId) => LENS_MENU.find((l) => l.id === lens)!.line;

export async function writeTexts(
  image: Buffer,
  c: Pick<EngineCandidate, "label" | "box">,
  opts: EngineOptions,
  lens?: LensId,
): Promise<{ texts?: Texts; step: Step }> {
  const { buffer } = await cropFor(image, c.box!, "verify", VERIFY_SIDE);
  const scene = await sharp(image).resize(768, 768, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  const r = await (opts.chat ?? ollamaChat)({
    model: opts.model,
    system: MENU_WRITER_SYSTEM,
    prompt: MENU_WRITER_PROMPT(c.label),
    images: [buffer, scene],
    format: menuWriterSchema,
    options: { temperature: 0.3 },
  });
  const out = extractJson(r.content) as (Omit<Texts, "clue" | "lens"> & { lens?: string }) | undefined;
  if (!out || typeof out.hint_semantic !== "string" || typeof out.hint_concrete !== "string") return { step: toStep("write", r) };
  const chosen = lens ?? chooseLens(c.label, out.lens, c.box!);
  return {
    texts: {
      lens: chosen,
      clue: lineFor(chosen),
      evidence: String(out.evidence ?? ""),
      hint_semantic: out.hint_semantic,
      hint_concrete: out.hint_concrete,
      detail: String(out.detail ?? ""),
    },
    step: toStep("write", r),
  };
}

export type Progress =
  | { stage: "proposed"; candidates: number }
  | { stage: "verifying"; attempt: number }
  | { stage: "chosen"; idx: number }
  | { stage: "none" };

export async function findTarget(image: Buffer, opts: EngineOptions, onProgress?: (p: Progress) => void): Promise<EngineResult> {
  const steps: Step[] = [];
  const { candidates, step } = await proposeTargets(image, opts);
  steps.push(step);
  onProgress?.({ stage: "proposed", candidates: candidates.length });
  let waitMs = step.ms;
  let chosen: EngineCandidate | undefined;
  let attempt = 0;
  for (const c of rank(candidates)) {
    onProgress?.({ stage: "verifying", attempt: ++attempt });
    const v = await verifyCandidate(image, c, candidates, opts);
    c.verify = v.verify;
    steps.push(v.step);
    if (!chosen) waitMs += v.step.ms;
    if (v.verify.pass && !chosen) {
      chosen = c;
      onProgress?.({ stage: "chosen", idx: c.idx });
      if (!opts.verifyAll) break;
    }
  }
  if (!chosen) {
    onProgress?.({ stage: "none" });
    return { candidates, steps, waitMs };
  }
  const lens = chooseLens(chosen.label, undefined, chosen.box!);
  return { candidates, chosen: chosen.idx, lens, clue: lineFor(lens), steps, waitMs };
}

export function spatialHint(box: Box): string {
  const cx = box.x + box.w / 2;
  const top = box.y;
  const bottom = box.y + box.h;
  const side = cx < 0.33 ? "toward the left of where you took the photo" : cx > 0.67 ? "toward the right of where you took the photo" : "roughly straight ahead from where you took the photo";
  const height = bottom < 0.45 ? "Look up." : top > 0.7 ? "Look down, close to the ground." : "";
  const near = box.h > 0.25 || bottom > 0.85 ? "It is quite close to where you stood." : box.h < 0.06 && bottom < 0.7 ? "It is further away than you might think." : "";
  return [`Look ${side}.`, height, near].filter(Boolean).join(" ");
}
