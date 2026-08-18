// Grimoire logomark — an arcane eye burning above an open tome. Inline SVG so
// it stays crisp at any size and the flame can inherit currentColor.
//
// The flame, the eye and the pupil are a single evenodd path: the flame fills,
// the eye punches a hole straight through it, and the pupil fills again inside
// that hole. That keeps the eye reading as negative space on any background
// rather than being painted on top of it, and it survives down to ~28px, which
// is the size the nav renders at.
//
// The pages are deliberately not currentColor — the mark is two-tone (gold
// flame, cream pages), and tinting them with the flame would flatten it. Nav
// hover therefore shifts the flame only, which is the intended read.
export default function Logo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M24 40.5C18.5 35.5 11 31 11 23.8c0-4.8 2.8-8.2 5.8-11.4.4 2.4 1.4 4 2.6 5.2 0-4.8 1.8-9.8 4.6-14.1 2.8 4.3 4.6 9.3 4.6 14.1 1.2-1.2 2.2-2.8 2.6-5.2 3 3.2 5.8 6.6 5.8 11.4 0 7.2-7.5 11.7-13 16.7zM24 20.8c4 0 7.2 2.3 7.2 4s-3.2 4-7.2 4-7.2-2.3-7.2-4 3.2-4 7.2-4zm0 1.2c.8 0 1.45 1.25 1.45 2.8s-.65 2.8-1.45 2.8-1.45-1.25-1.45-2.8.65-2.8 1.45-2.8z"
      />
      <g fill="#f0e3c2">
        <path d="M23 40.6c-3.9-2.7-10.6-3.2-18-1.9v5.9c7.4-1.3 14.1-.8 18 1.9z" />
        <path d="M25 40.6c3.9-2.7 10.6-3.2 18-1.9v5.9c-7.4-1.3-14.1-.8-18 1.9z" />
      </g>
    </svg>
  );
}
