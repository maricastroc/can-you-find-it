const KEY = "cyfi:rounds";
const OLD_KEY = "cyfi:round";
const MAX = 20;

function read(): string[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown;
    const ids = Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
    const old = window.localStorage.getItem(OLD_KEY);
    return old && !ids.includes(old) ? [old, ...ids] : ids;
  } catch {
    return [];
  }
}

function write(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)));
    window.localStorage.removeItem(OLD_KEY);
  } catch {
    return;
  }
}

export const savedRoundIds = (): string[] => read();

export function rememberRound(id: string): void {
  write([id, ...read().filter((x) => x !== id)]);
}

export function forgetRoundId(id: string): void {
  write(read().filter((x) => x !== id));
}
