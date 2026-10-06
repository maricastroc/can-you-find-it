/** Runtime configuration, read from the environment on the server. */
export const config = {
  /** Where Ollama listens. Keep it on this machine for the privacy claim to hold. */
  ollamaHost: process.env.HUNT_OLLAMA_URL ?? "http://127.0.0.1:11434",
  /** Vision model used for every step. See spike/README.md for why E4B. */
  model: process.env.HUNT_MODEL ?? "gemma4:e4b",
  /** Rounds (photos, crops, logs) are stored here, on this machine only. */
  dataDir: process.env.HUNT_DATA_DIR ?? ".data",
  /** Per-call timeout for the model; a cold start can take a while. */
  callTimeoutMs: Number(process.env.HUNT_CALL_TIMEOUT_MS ?? 180_000),
};
