import { ORGS, orgHref } from "../orgs";

const CARDS = [
  {
    org: ORGS.cmc,
    ring: "hover:border-teal-500 focus-visible:ring-teal-500",
    badge: "bg-teal-600",
    cta: "text-teal-700",
    icon: (
      <path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10Z" />
    ),
  },
  {
    org: ORGS.ngs,
    ring: "hover:border-brand-600 focus-visible:ring-brand-600",
    badge: "bg-brand-700",
    cta: "text-brand-700",
    icon: (
      <>
        <path d="M7 3c0 6 10 6 10 12s-10 6-10 6" />
        <path d="M17 3c0 6-10 6-10 12s10 6 10 6" />
        <path d="M8.5 7h7M8.5 17h7M7.7 12h8.6" />
      </>
    ),
  },
];

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="text-center mb-8 sm:mb-10">
        <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-wide uppercase text-brand-900">Anderson Diagnostics &amp; Labs</div>
        <h1 className="text-base sm:text-xl font-bold mt-3 text-slate-700">Choose your organization</h1>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {CARDS.map(({ org, ring, badge, cta, icon }) => (
          <a
            key={org.id}
            href={orgHref(org)}
            className={`group card p-6 sm:p-8 flex flex-col items-start gap-4 border-2 transition
              hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 ${ring}`}
          >
            <div className={`w-14 h-14 rounded-2xl text-white flex items-center justify-center ${badge}`}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {icon}
              </svg>
            </div>
            <div>
              <div className="text-3xl font-extrabold">{org.name}</div>
              <div className="text-sm font-semibold text-slate-600 mt-0.5">{org.tagline}</div>
              <p className="text-sm text-slate-500 mt-2">{org.blurb}</p>
            </div>
            <span className={`mt-auto text-sm font-bold ${cta} group-hover:underline`}>
              Continue to {org.name} →
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
