/** A pencil leaving a smile-shaped trace. Kept as SVG so it stays crisp at icon size. */
export function Logo() {
  return <svg className="brand-logo" viewBox="0 0 48 48" aria-hidden="true" fill="none">
    <rect x="1" y="1" width="46" height="46" rx="15" fill="#FFBC86" />
    <path d="m15 29 2-8L30 8a3 3 0 0 1 4 0l6 6a3 3 0 0 1 0 4L27 31l-8 2-4-4Z" fill="#FFF9EF" stroke="#38334E" strokeWidth="2.3" strokeLinejoin="round" />
    <path d="m28 10 10 10M18 22l8 8M16 28l5 5" stroke="#38334E" strokeWidth="2.3" strokeLinecap="round" />
    <path d="M11 37c5 3 12 3 17 0" stroke="#38334E" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M10 9v6M7 12h6" stroke="#7A468E" strokeWidth="2" strokeLinecap="round" />
    <circle cx="36" cy="35" r="2" fill="#7A468E" />
  </svg>;
}
