export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  if (seconds < 86_400) {
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${Math.floor(seconds / 3600)} h${minutes ? ` ${minutes} min` : ""}`;
  }
  const days = Math.floor(seconds / 86_400);
  return days === 1 ? "1 day" : `${days} days`;
}
