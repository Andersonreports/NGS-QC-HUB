import { useEffect, useRef, useState } from "react";
import { clearPortalSessions, getPortal } from "../api";
import { ORGS, orgHref } from "../orgs";
import Login from "./Login";

const DNA_ICON = (
  <>
    <path d="M7 3c0 6 10 6 10 12s-10 6-10 6" />
    <path d="M17 3c0 6-10 6-10 12s10 6 10 6" />
    <path d="M8.5 7h7M8.5 17h7M7.7 12h8.6" />
  </>
);

const CARDS = [
  {
    org: ORGS.cmc,
    glow: "from-teal-400/40",
    badge: "from-teal-400 to-teal-600",
    tint: "text-teal-300",
    line: "via-teal-300",
    icon: <path d="M12 21s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.4-7 10-7 10Z" />,
  },
  {
    org: ORGS.ngs,
    glow: "from-accent-400/40",
    badge: "from-accent-400 to-accent-600",
    tint: "text-accent-300",
    line: "via-accent-300",
    icon: DNA_ICON,
  },
];

/** Where each choice leads for an organization (a separately hosted site if one is configured). */
function destinations(org) {
  const germline = orgHref(org);
  return [
    {
      id: "germline",
      title: "Germline",
      titles: { cmc: "CMC Germline QC Hub", ngs: "Anderson Germline QC Hub" },
      sub: "Germline Exome QC Hub",
      blurb: "Sequencing runs, QC approvals and monthly reports.",
      href: germline,
      icon: DNA_ICON,
    },
    {
      id: "vswarehouse",
      title: "VSWarehouse",
      titles: { cmc: "CMC VSWarehouse Token Monitor", ngs: "Anderson VSWarehouse Token Monitor" },
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

function Cards({ org, glow, badge, tint, line, label, icon, delay = 0 }) {
  return (
    <div className="w-full lg-rise" style={{ animationDelay: `${delay}s` }}>
      {label && (
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${badge} flex items-center justify-center shadow-lg text-white`}>
            <Svg size={18}>{icon}</Svg>
          </span>
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-white">{label}</h2>
          <span className="flex-1 h-px bg-gradient-to-r from-white/25 to-transparent" />
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
        {destinations(org).map((d) => (
          <a
            key={d.id}
            href={d.href}
            className="group relative overflow-hidden rounded-3xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/15 hover:border-white/35 backdrop-blur-xl p-7 min-h-[230px] flex flex-col justify-between shadow-xl shadow-black/20 transition duration-300 hover:-translate-y-1.5 hover:shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <span className={`absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent ${line} to-transparent opacity-70 group-hover:opacity-100`} />
            <span className={`pointer-events-none absolute -right-16 -top-16 w-56 h-56 rounded-full bg-gradient-to-br ${glow} to-transparent blur-2xl opacity-60 group-hover:opacity-100 group-hover:scale-125 transition duration-500`} />
            <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-white/10 -translate-x-[150%] -skew-x-12 group-hover:translate-x-[420%] transition-transform duration-1000" />

            <div className={`relative w-16 h-16 rounded-2xl bg-gradient-to-br ${badge} text-white flex items-center justify-center shadow-lg ring-1 ring-white/30 group-hover:scale-110 group-hover:-rotate-3 transition duration-300`}>
              <Svg size={32}>{d.icon}</Svg>
            </div>

            <div className="relative mt-8">
              <div className={`text-xs font-bold uppercase tracking-[0.18em] ${tint}`}>{d.sub}</div>
              <div className="mt-1.5 text-2xl sm:text-3xl font-extrabold leading-tight text-white">
                {d.titles[org.id] || `${org.id.toUpperCase()} ${d.title}`}
              </div>
              <p className="mt-2 text-sm text-brand-100/75 leading-relaxed max-w-[16rem]">{d.blurb}</p>
            </div>

            <span className="absolute right-5 bottom-5 w-10 h-10 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-lg font-bold text-white opacity-70 group-hover:opacity-100 group-hover:bg-white group-hover:text-brand-900 group-hover:translate-x-1 transition duration-300" aria-hidden="true">→</span>
          </a>
        ))}
      </div>
    </div>
  );
}

/** "/" is the sign-in page. After signing in the account goes straight to its own
 * Germline (Wet Lab), or sees its organization's Germline + VSWarehouse cards (primary
 * roles), or all four cards across both organizations (admin / Bioinfo Head). */
export default function Landing() {
  const [portal, setPortal] = useState(getPortal);
  const rootRef = useRef(null);
  const wetlab = portal?.role === "wetlab";

  useEffect(() => {
    if (wetlab && ORGS[portal.org]) window.location.replace(orgHref(ORGS[portal.org]));
  }, [wetlab, portal]);

  if (!portal) return <Login portal onLoggedIn={(data) => setPortal(getPortal() || { org: data.org, role: data.role, orgs: [data.org] })} />;
  if (wetlab) return null;

  function spotlight(e) {
    const el = rootRef.current;
    if (el) {
      el.style.setProperty("--mx", `${e.clientX}px`);
      el.style.setProperty("--my", `${e.clientY}px`);
    }
  }

  const orgs = ["admin", "bioinfo_head"].includes(portal.role) ? CARDS : CARDS.filter((c) => c.org.id === portal.org);
  const first = (portal.name || "").trim().split(/\s+/)[0];

  return (
    <div ref={rootRef} onMouseMove={spotlight} className="relative min-h-screen overflow-hidden text-white bg-brand-950" style={{ "--mx": "50vw", "--my": "30vh" }}>
      <style>{`
        @keyframes lg-drift1 { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(80px,50px) scale(1.15) } }
        @keyframes lg-drift2 { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(-70px,-60px) scale(1.2) } }
        @keyframes lg-rise { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
        .lg-rise { animation: lg-rise .8s cubic-bezier(.2,.7,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .lg-anim, .lg-rise { animation: none !important } }
      `}</style>

      <div className="lg-anim absolute -left-32 -top-32 w-[40rem] h-[40rem] rounded-full bg-brand-600/60 blur-3xl" style={{ animation: "lg-drift1 16s ease-in-out infinite" }} />
      <div className="lg-anim absolute -right-24 -bottom-32 w-[36rem] h-[36rem] rounded-full bg-accent-500/35 blur-3xl" style={{ animation: "lg-drift2 19s ease-in-out infinite" }} />
      <div className="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />
      <div className="pointer-events-none absolute inset-0 hidden md:block" style={{ background: "radial-gradient(520px circle at var(--mx) var(--my), rgba(240,150,104,0.14), transparent 60%)" }} />

      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-5 sm:px-8 py-12">
        <div className="text-center mb-10 sm:mb-12 lg-rise">
          <h1 className="text-4xl sm:text-5xl font-black tracking-tight">
            Welcome{first ? "," : ""}
            {first && <span className="ml-3 bg-gradient-to-r from-accent-200 via-white to-brand-200 bg-clip-text text-transparent">{first}</span>}
          </h1>
          <p className="mt-3 text-base sm:text-lg text-brand-100/80 font-medium">Choose where you would like to work today.</p>
        </div>

        <div className="w-full max-w-4xl space-y-10">
          {orgs.map((c, i) => (
            <Cards key={c.org.id} {...c} delay={0.1 + i * 0.15} label={orgs.length > 1 ? c.org.name : ORGS[c.org.id].name} />
          ))}
        </div>

        <button
          type="button"
          onClick={() => { clearPortalSessions(); setPortal(null); }}
          className="mt-12 inline-flex items-center gap-2 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 px-5 py-2 text-sm font-semibold text-brand-100 hover:text-white transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
