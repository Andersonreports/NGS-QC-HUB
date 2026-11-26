/**
 * Small two-tone illustrations for the big dashboard cards. Each is drawn in
 * `currentColor` only (a soft fill layer plus a solid detail layer), so it picks up
 * the card's accent colour automatically.
 */
const ART = {
  samples: (
    <>
      {[6, 25, 44].map((x) => (
        <g key={x}>
          <rect x={x} y="10" width="14" height="44" rx="7" fill="currentColor" fillOpacity="0.14" />
          <path d={`M${x} 34h14v13a7 7 0 0 1-14 0z`} fill="currentColor" fillOpacity="0.55" />
          <rect x={x - 1} y="6" width="16" height="6" rx="3" fill="currentColor" />
        </g>
      ))}
    </>
  ),
  pass: (
    <>
      <path d="M32 6l22 8v16c0 14-9.5 24-22 28C19.5 54 10 44 10 30V14z" fill="currentColor" fillOpacity="0.16" />
      <path d="M32 6l22 8v16c0 14-9.5 24-22 28C19.5 54 10 44 10 30V14z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 32l7 7 13-15" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  fail: (
    <>
      <path d="M32 6l22 8v16c0 14-9.5 24-22 28C19.5 54 10 44 10 30V14z" fill="currentColor" fillOpacity="0.16" />
      <path d="M32 6l22 8v16c0 14-9.5 24-22 28C19.5 54 10 44 10 30V14z" fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
      <path d="M24 24l16 16M40 24L24 40" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
    </>
  ),
  repeat: (
    <>
      <circle cx="32" cy="32" r="22" fill="currentColor" fillOpacity="0.14" />
      <path d="M14 30a18 18 0 0 1 32-9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M47 9v13H34" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M50 34a18 18 0 0 1-32 9" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M17 55V42h13" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
};

ART.runs = (
  <>
    <rect x="8" y="12" width="48" height="40" rx="7" fill="currentColor" fillOpacity="0.14" />
    <path d="M8 24h48" stroke="currentColor" strokeWidth="4" />
    <path d="M18 34h28M18 43h18" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    <path d="M20 8v8M44 8v8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </>
);

export default function DashArt({ name, size = 64, className = "" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      {ART[name]}
    </svg>
  );
}
