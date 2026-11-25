import { useState } from "react";
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

/** Where each choice leads for an organization (a separately hosted site if one is configured). */
function destinations(org) {
  const germline = orgHref(org);
  return [
    {
      id: "germline",
      title: "Germline",
      sub: "Germline Exome QC Hub",
      blurb: "Sequencing runs, QC approvals and monthly reports.",
      href: germline,
      icon: (
        <>
          <path d="M7 3c0 6 10 6 10 12s-10 6-10 6" />
          <path d="M17 3c0 6-10 6-10 12s10 6 10 6" />
          <path d="M8.5 7h7M8.5 17h7M7.7 12h8.6" />
        </>
      ),
    },
    {
      id: "vswarehouse",
      title: "VSWarehouse",
      sub: "Token Monitor",
      blurb: "Token usage, burn rate, live sheet and CSV/PDF reports.",
      href: `${germline.replace(/\/$/, "")}/vswarehouse`,
      icon: (
        <>
          <ellipse cx="12" cy="6" rx="8" ry="3" />
          <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
          <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
        </>
      ),
    },
  ];
}

function Svg({ children, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export default function Landing() {
  const [selected, setSelected] = useState(null);
  const card = CARDS.find((c) => c.org.id === selected);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="text-center mb-8 sm:mb-10">
        <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-wide uppercase text-brand-900">Anderson Diagnostics &amp; Labs</div>
        <h1 className="text-base sm:text-xl font-bold mt-3 text-slate-700">
          {card ? `${card.org.name} — choose where to go` : "Choose your organization"}
        </h1>
      </div>

      {card ? (
        <div className="w-full max-w-3xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
            {destinations(card.org).map((d) => (
              <a
                key={d.id}
                href={d.href}
                className={`group card p-6 sm:p-8 flex flex-col items-start gap-4 border-2 transition
                  hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 ${card.ring}`}
              >
                <div className={`w-14 h-14 rounded-2xl text-white flex items-center justify-center ${card.badge}`}>
                  <Svg>{d.icon}</Svg>
                </div>
                <div>
                  <div className="text-3xl font-extrabold">{d.title}</div>
                  <div className="text-sm font-semibold text-slate-600 mt-0.5">{d.sub}</div>
                  <p className="text-sm text-slate-500 mt-2">{d.blurb}</p>
                </div>
                <span className={`mt-auto text-sm font-bold ${card.cta} group-hover:underline`}>
                  Open {d.title} →
                </span>
              </a>
            ))}
          </div>
          <div className="text-center mt-6">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline"
            >
              ← Change organization
            </button>
          </div>
        </div>
      ) : (
        <div className="grid w-full max-w-3xl grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
          {CARDS.map(({ org, ring, badge, cta, icon }) => (
            <button
              type="button"
              key={org.id}
              onClick={() => setSelected(org.id)}
              className={`group card p-6 sm:p-8 flex flex-col items-start gap-4 border-2 transition text-left
                hover:-translate-y-0.5 hover:shadow-lg focus:outline-none focus-visible:ring-2 ${ring}`}
            >
              <div className={`w-14 h-14 rounded-2xl text-white flex items-center justify-center ${badge}`}>
                <Svg>{icon}</Svg>
              </div>
              <div>
                <div className="text-3xl font-extrabold">{org.name}</div>
                <div className="text-sm font-semibold text-slate-600 mt-0.5">{org.tagline}</div>
                <p className="text-sm text-slate-500 mt-2">{org.blurb}</p>
              </div>
              <span className={`mt-auto text-sm font-bold ${cta} group-hover:underline`}>
                Continue to {org.name} →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
