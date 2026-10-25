/** A fine pencil and its curved trace, drawn in the shared brand accent. */
export function Logo() {
  return <svg className="brand-logo" viewBox="0 0 48 48" aria-hidden="true" fill="none">
    <rect x="1" y="1" width="46" height="46" rx="13" fill="var(--accent)" />
    <g stroke="var(--on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15.8 31.8 2.1-8.1 13.3-13.3a2.6 2.6 0 0 1 3.7 0l2.7 2.7a2.6 2.6 0 0 1 0 3.7L24.3 30.1l-8.5 1.7Z" />
      <path d="m17.9 23.7 6.4 6.4m4.8-17.6 6.4 6.4M20.7 24.3l9.8-9.8M12 37c5.5 2.4 13.5 1.4 18.5-2.2" />
    </g>
  </svg>;
}
