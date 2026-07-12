// Grimoire logomark — "The Open Tome": an open spellbook with a spell-spark
// rising from the gutter. Inline SVG (crisp at any size, uses currentColor).
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M24 15c-5-3.4-12-3.4-17-1.4v20.8c5-2 12-2 17 1.4" />
      <path d="M24 15c5-3.4 12-3.4 17-1.4v20.8c-5-2-12-2-17 1.4" />
      <path d="M24 15v20.8" />
      <path
        d="M24 4.6c0 3.1 1.4 4.5 4.5 4.5-3.1 0-4.5 1.4-4.5 4.5 0-3.1-1.4-4.5-4.5-4.5 3.1 0 4.5-1.4 4.5-4.5z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
