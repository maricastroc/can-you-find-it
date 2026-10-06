import { chat } from "../../src/lib/hunt/ollama";
const model = process.argv[2] ?? "gemma4:e4b";
const p = "Write a 250-word description of an autumn park, as JSON {\"text\": string}.";
for (const [name, format] of [["free", undefined], ["json", "json"], ["schema", { type: "object", properties: { text: { type: "string" } }, required: ["text"] }]] as const) {
  const r = await chat({ model, prompt: p, format, options: { temperature: 0.6, num_predict: 300 } });
  console.log(name, r.outputTokens, "tok", r.ms, "ms", (r.outputTokens / (r.ms / 1000)).toFixed(1), "tok/s (incl. prompt)");
}
