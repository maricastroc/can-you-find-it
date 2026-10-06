import type { Box } from "@/lib/hunt/geometry";

/** Viewfinder brackets around a box (0–1 units of the parent frame). */
export function Mark({ box, label }: { box: Box; label?: string }) {
  return (
    <span
      className="mark"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        left: `${box.x * 100}%`,
        top: `${box.y * 100}%`,
        width: `${box.w * 100}%`,
        height: `${box.h * 100}%`,
        // Tiny targets still get a visible mark.
        minWidth: 28,
        minHeight: 28,
      }}
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 24V8h16M40 8h16v16M56 40v16H40M24 56H8V40" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="square" />
      <circle cx="32" cy="32" r="5" fill="var(--signal)" />
    </svg>
  );
}
