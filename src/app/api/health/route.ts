import { config } from "@/lib/hunt/config";
import { warmUp } from "@/lib/hunt/ollama";

/** Is the local model reachable and installed? */
export async function GET() {
  try {
    const res = await fetch(`${config.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(3000), cache: "no-store" });
    const tags = (await res.json()) as { models?: Array<{ name: string }> };
    const installed = (tags.models ?? []).some((m) => m.name === config.model || m.name === `${config.model}:latest`);
    return Response.json({ ok: installed, ollama: true, model: config.model, installed });
  } catch {
    return Response.json({ ok: false, ollama: false, model: config.model, installed: false }, { status: 503 });
  }
}

/** Load the model now, so the first round doesn't wait for it. */
export async function POST() {
  return Response.json({ warmed: await warmUp(config.model) });
}
