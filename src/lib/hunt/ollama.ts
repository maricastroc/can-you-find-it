/** Minimal Ollama /api/chat client (no streaming). */
import { config } from "./config";

export type ChatResult = {
  content: string;
  thinking?: string;
  ms: number;
  promptTokens: number;
  outputTokens: number;
};

export type ChatInput = {
  model: string;
  system?: string;
  prompt: string;
  images?: Buffer[];
  format?: unknown;
  think?: boolean;
  options?: Record<string, unknown>;
  signal?: AbortSignal;
};

export class ModelUnavailableError extends Error {
  constructor(cause: unknown) {
    super(`The local model is not reachable at ${config.ollamaHost}. Is Ollama running?`, { cause });
    this.name = "ModelUnavailableError";
  }
}

export async function chat(input: ChatInput): Promise<ChatResult> {
  const t0 = performance.now();
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(config.callTimeoutMs)])
    : AbortSignal.timeout(config.callTimeoutMs);
  let res: Response;
  try {
    res = await fetch(`${config.ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal,
      body: JSON.stringify({
        model: input.model,
        stream: false,
        think: input.think ?? false,
        keep_alive: "30m",
        format: input.format,
        options: input.options,
        messages: [
          ...(input.system ? [{ role: "system", content: input.system }] : []),
          { role: "user", content: input.prompt, images: input.images?.map((b) => b.toString("base64")) },
        ],
      }),
    });
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw e;
    throw new ModelUnavailableError(e);
  }
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    message: { content: string; thinking?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  return {
    content: json.message.content,
    thinking: json.message.thinking,
    ms: Math.round(performance.now() - t0),
    promptTokens: json.prompt_eval_count ?? 0,
    outputTokens: json.eval_count ?? 0,
  };
}

/** Load the model into memory so the first round doesn't pay for it. */
export async function warmUp(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${config.ollamaHost}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt: "", keep_alive: "30m" }),
      signal: AbortSignal.timeout(60_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
