import { useState } from "react";
import { useEffect } from "react";
import { clearPortalSessions, getPortal } from "../api";
import { ORGS, orgHref } from "../orgs";
import Login from "./Login";

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

const CARD_BASE =
  "group relative overflow-hidden card min-h-[220px] sm:min-h-[260px] px-6 py-8 flex flex-col items-center justify-center gap-6 text-center border-2 border-transparent transition duration-200 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-2";

function Arrow({ cta }) {
  return (
    <span className={`absolute right-4 bottom-4 w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-lg font-bold ${cta}
      opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition`} aria-hidden="true">→</span>
  );
}

function Svg({ children, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

function Cards({ org, ring, badge, cta, label }) {
  return (
    <div className="w-full">
      {label && <h2 className="text-center text-base font-bold text-slate-700 mb-3">{label}</h2>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {destinations(org).map((d) => (
          <a key={d.id} href={d.href} className={`${CARD_BASE} ${ring}`}>
            <span className={`absolute inset-x-0 top-0 h-1.5 ${badge}`} />
            <div className={`w-20 h-20 rounded-3xl text-white flex items-center justify-center shadow-md ${badge}`}>
              <Svg size={40}>{d.icon}</Svg>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold leading-tight">{org.id.toUpperCase()} {d.title}</div>
            <Arrow cta={cta} />
          </a>
        ))}
      </div>
    </div>
  );
}

/** "/" is the sign-in page. After signing in the account goes straight to its own
 * Germline (Wet Lab), or sees its organization's Germline + VSWarehouse cards (primary
 * roles), or all four cards across both organizations (admin). */
export default function Landing() {
  const [portal, setPortal] = useState(getPortal);
  const wetlab = portal?.role === "wetlab";

  useEffect(() => {
    if (wetlab && ORGS[portal.org]) window.location.replace(orgHref(ORGS[portal.org]));
  }, [wetlab, portal]);

  if (!portal) return <Login portal onLoggedIn={(data) => setPortal(getPortal() || { org: data.org, role: data.role, orgs: [data.org] })} />;
  if (wetlab) return null;

  const orgs = portal.role === "admin" ? CARDS : CARDS.filter((c) => c.org.id === portal.org);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10">
      <div className="text-center mb-8 sm:mb-10">
        <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-wide uppercase text-brand-900">Anderson Diagnostics &amp; Labs</div>
      </div>
      <div className="w-full max-w-3xl space-y-8">
        {orgs.map((c) => (
          <Cards key={c.org.id} {...c} label={orgs.length > 1 ? c.org.name : ORGS[c.org.id].name} />
        ))}
      </div>
      <button
        type="button"
        onClick={() => { clearPortalSessions(); setPortal(null); }}
        className="mt-8 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:underline"
      >
        Sign out
      </button>
    </div>
  );
}
