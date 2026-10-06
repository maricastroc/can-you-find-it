export const config = {
  ollamaHost: process.env.HUNT_OLLAMA_URL ?? "http://127.0.0.1:11434",
  model: process.env.HUNT_MODEL ?? "gemma4:e4b",
  dataDir: process.env.HUNT_DATA_DIR ?? ".data",
  callTimeoutMs: Number(process.env.HUNT_CALL_TIMEOUT_MS ?? 180_000),
  maxTokens: { propose: 400, verify: 160, write: 320, compare: 300 },
};
