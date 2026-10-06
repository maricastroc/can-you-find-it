import { useCallback, useEffect } from "react";

export function useBackToClose(open: boolean, close: () => void, key: string): () => void {
  useEffect(() => {
    if (!open) return;
    if (window.history.state?.[key] !== true) window.history.pushState({ ...window.history.state, [key]: true }, "");
    window.addEventListener("popstate", close);
    return () => window.removeEventListener("popstate", close);
  }, [open, close, key]);

  return useCallback(() => {
    close();
    if (window.history.state?.[key] === true) window.history.back();
  }, [close, key]);
}
