/** The only thing kept on the device between visits: the id of the round in play. */
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
    // Private mode or blocked storage: resume just won't be available.
  }
}
