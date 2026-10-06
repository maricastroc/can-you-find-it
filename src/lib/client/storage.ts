const KEY = "cyfi:round";

export function savedRoundId(): string | undefined {
  try {
    return window.localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function saveRoundId(id: string | undefined): void {
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    return;
  }
}
