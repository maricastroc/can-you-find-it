export function ClueText({ text, as: Tag = "p", className = "headline" }: { text: string; as?: "h1" | "h2" | "p"; className?: string }) {
  const words = text.split(/\s+/);
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true">
          <span className="clue-word" style={{ "--i": i } as React.CSSProperties}>
            {w}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </Tag>
  );
}
