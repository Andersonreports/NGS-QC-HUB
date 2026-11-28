import { useEffect, useRef, useState } from "react";
import { api, setPortalSession, setSession } from "../api";
import { ORGS, currentOrgId } from "../orgs";
import { Alert, Icon, Spinner } from "./ui";

export default function Login({ onLoggedIn, site, portal = false }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Landing only: the rotating headline word and the cursor spotlight.
  const [wordIdx, setWordIdx] = useState(0);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!portal) return undefined;
    const t = setInterval(() => setWordIdx((i) => (i + 1) % 3), 2400);
    return () => clearInterval(t);
  }, [portal]);
  function spotlight(e) {
    const el = rootRef.current;
    if (el) {
      el.style.setProperty("--mx", `${e.clientX}px`);
      el.style.setProperty("--my", `${e.clientY}px`);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (portal) {
        const data = await api.portalLogin(username.trim(), password);
        setPortalSession(data);
        onLoggedIn(data);
      } else {
        const data = await api.login(username.trim(), password, site);
        setSession(data.access_token, data.user);
        onLoggedIn(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const fields = (
    <>
      {error && <Alert kind="error">{error}</Alert>}

      <div>
        <label className="label" htmlFor="username">Username</label>
        <input
          id="username"
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          autoFocus
          required
        />
      </div>

      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="field"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </div>

      <button type="submit" className="btn-primary w-full" disabled={busy || !username || !password}>
        {busy ? <Spinner /> : null}
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </>
  );

  if (portal) {
    // Two sine strands of a DNA helix, with rungs between them.
    const N = 18, STEP = 22;
    const xs = (i, ph) => 50 + 36 * Math.sin(i * 0.8 + ph);
    const strand = (ph) => Array.from({ length: N }, (_, i) => `${i ? "L" : "M"}${xs(i, ph).toFixed(1)} ${12 + i * STEP}`).join(" ");
    const iconCls = "absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-200/70 group-focus-within:text-accent-300 transition-colors";
    const inputCls = "w-full rounded-xl bg-white/10 border border-white/20 text-white placeholder-brand-200/50 pl-11 pr-3 py-3.5 text-sm outline-none transition focus:bg-white/15 focus:border-accent-300/70 focus:ring-4 focus:ring-accent-400/20";
    const WORDS = ["tracked", "checked", "trusted"];
    // Floating specks: [left %, size px, duration s, delay s]
    const specks = [[8, 4, 14, 0], [18, 3, 19, 4], [29, 5, 16, 8], [41, 3, 21, 2], [53, 4, 17, 11], [64, 3, 23, 6], [76, 5, 15, 1], [87, 3, 20, 9], [94, 4, 18, 5]];
    return (
      <div ref={rootRef} onMouseMove={spotlight} className="relative min-h-screen overflow-hidden text-white bg-brand-950" style={{ "--mx": "50vw", "--my": "40vh" }}>
        <style>{`
          @keyframes lg-drift1 { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(80px,50px) scale(1.15) } }
          @keyframes lg-drift2 { 0%,100% { transform: translate(0,0) scale(1) } 50% { transform: translate(-70px,-60px) scale(1.2) } }
          @keyframes lg-drift3 { 0%,100% { transform: translate(0,0) } 50% { transform: translate(-40px,60px) } }
          @keyframes lg-float { 0%,100% { transform: translateY(-50%) rotate(0deg) } 50% { transform: translateY(calc(-50% - 16px)) rotate(2deg) } }
          @keyframes lg-rise { from { opacity: 0; transform: translateY(18px) } to { opacity: 1; transform: none } }
          @keyframes lg-pulse { 0%,100% { opacity: .25 } 50% { opacity: 1 } }
          @keyframes lg-shine { from { transform: translateX(-120%) skewX(-20deg) } to { transform: translateX(380%) skewX(-20deg) } }
          @keyframes lg-spin { to { transform: rotate(360deg) } }
          @keyframes lg-speck { 0% { transform: translateY(105vh); opacity: 0 } 10% { opacity: .8 } 90% { opacity: .8 } 100% { transform: translateY(-10vh); opacity: 0 } }
          @keyframes lg-word { 0% { opacity: 0; transform: translateY(60%); filter: blur(6px) } 100% { opacity: 1; transform: none; filter: none } }
          .lg-rise { animation: lg-rise .8s cubic-bezier(.2,.7,.2,1) both }
          .lg-word { animation: lg-word .6s cubic-bezier(.2,.7,.2,1) both }
          .lg-btn:hover .lg-shine { animation: lg-shine .9s ease }
          .lg-input:-webkit-autofill { -webkit-text-fill-color: #fff; transition: background-color 9999s; }
          @media (prefers-reduced-motion: reduce) { .lg-anim, .lg-rise, .lg-word { animation: none !important } }
        `}</style>

        {/* one continuous background — no panels, no seam */}
        <div className="lg-anim absolute -left-32 -top-32 w-[40rem] h-[40rem] rounded-full bg-brand-600/60 blur-3xl" style={{ animation: "lg-drift1 16s ease-in-out infinite" }} />
        <div className="lg-anim absolute -right-24 -bottom-32 w-[36rem] h-[36rem] rounded-full bg-accent-500/35 blur-3xl" style={{ animation: "lg-drift2 19s ease-in-out infinite" }} />
        <div className="lg-anim absolute left-1/3 top-1/2 w-[26rem] h-[26rem] rounded-full bg-brand-400/25 blur-3xl" style={{ animation: "lg-drift3 22s ease-in-out infinite" }} />
        <div className="absolute inset-0 opacity-[0.10] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_80%)]" />
        {/* soft light that follows the cursor */}
        <div className="pointer-events-none absolute inset-0 hidden md:block" style={{ background: "radial-gradient(520px circle at var(--mx) var(--my), rgba(240,150,104,0.14), transparent 60%)" }} />
        {specks.map(([left, size, dur, delay], i) => (
          <span key={i} aria-hidden className="lg-anim absolute bottom-0 rounded-full bg-white/70" style={{ left: `${left}%`, width: size, height: size, animation: `lg-speck ${dur}s linear ${delay}s infinite`, opacity: 0 }} />
        ))}

        <svg aria-hidden className="lg-anim absolute left-1/2 top-1/2 -ml-16 h-[92%] w-32 hidden lg:block opacity-60" viewBox="0 0 100 400" style={{ animation: "lg-float 10s ease-in-out infinite" }}>
          <defs>
            <linearGradient id="lg-s1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f09668" /><stop offset="1" stopColor="#e8712f" /></linearGradient>
            <linearGradient id="lg-s2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#9bbbe0" /></linearGradient>
          </defs>
          {Array.from({ length: N }, (_, i) => (
            <g key={i} style={{ animation: `lg-pulse 3.4s ease-in-out ${i * 0.17}s infinite` }}>
              <line x1={xs(i, 0)} y1={12 + i * STEP} x2={xs(i, Math.PI)} y2={12 + i * STEP} stroke="white" strokeOpacity=".3" strokeWidth="1.4" />
              <circle cx={xs(i, 0)} cy={12 + i * STEP} r="4.2" fill="#f09668" />
              <circle cx={xs(i, Math.PI)} cy={12 + i * STEP} r="4.2" fill="white" />
            </g>
          ))}
          <path d={strand(0)} fill="none" stroke="url(#lg-s1)" strokeWidth="2.4" strokeLinejoin="round" opacity=".8" />
          <path d={strand(Math.PI)} fill="none" stroke="url(#lg-s2)" strokeWidth="2.4" strokeLinejoin="round" opacity=".8" />
        </svg>

        <div className="relative z-10 min-h-screen mx-auto max-w-7xl grid lg:grid-cols-2 items-center gap-12 px-6 sm:px-12 py-14">
          <section className="lg-rise max-w-xl">
            <h1 className="tracking-tight">
              <span className="block text-2xl sm:text-3xl font-bold text-brand-100">Welcome to</span>
              <span className="block mt-2 text-3xl sm:text-4xl lg:text-[2.6rem] font-extrabold leading-tight bg-gradient-to-r from-accent-200 via-white to-brand-200 bg-clip-text text-transparent">Sequence. Analyse. Report.</span>
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-brand-100/90 font-medium leading-relaxed max-w-md">
              Where every sample is <span className="inline-block min-w-[5.2rem]"><span key={wordIdx} className="lg-word inline-block font-extrabold text-accent-300">{WORDS[wordIdx]}</span></span>
              <span className="block">and every report you can rely on.</span>
            </p>
            <ul className="mt-9 space-y-4 text-base text-brand-100">
              {[
                ["flask", "Seamless Wet Lab to Bioinformatics handoff"],
                ["check", "Clear, step-by-step approvals"],
                ["shield", "Quality you can trace, run after run"],
              ].map(([icon, t], i) => (
                <li key={t} className="lg-rise group flex items-center gap-3.5" style={{ animationDelay: `${0.2 + i * 0.14}s` }}>
                  <span className="w-9 h-9 rounded-xl bg-white/10 border border-white/20 backdrop-blur flex items-center justify-center shrink-0 text-accent-300 transition-transform group-hover:scale-110 group-hover:bg-white/20">
                    <Icon name={icon} size={17} />
                  </span>
                  <span className="font-medium">{t}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="lg-rise w-full max-w-md lg:ml-auto lg:mr-4" style={{ animationDelay: ".1s" }}>
            {/* a slowly rotating light runs around the card's edge */}
            <div className="relative rounded-3xl p-px overflow-hidden shadow-2xl shadow-black/40">
              <div className="lg-anim absolute -inset-[60%]" style={{ background: "conic-gradient(from 0deg, transparent 0 60%, rgba(240,150,104,.9) 80%, transparent 100%)", animation: "lg-spin 7s linear infinite" }} />
              <div className="absolute inset-0 bg-white/15" />
              <div className="relative rounded-[calc(1.5rem-1px)] bg-brand-950/70 backdrop-blur-2xl p-8 sm:p-10">
                <div className="text-3xl font-extrabold tracking-tight">Welcome back</div>
                <p className="text-sm text-brand-200/80 mt-1.5 mb-8">Enter your details to continue.</p>

                <form onSubmit={submit} autoComplete="off" className="space-y-5">
                  {error && <Alert kind="error">{error}</Alert>}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-brand-200/80 mb-1.5" htmlFor="username">Username</label>
                    <div className="relative group">
                      <span className={iconCls}><Icon name="users" size={17} /></span>
                      <input id="username" className={`lg-input ${inputCls}`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" autoFocus required />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-brand-200/80 mb-1.5" htmlFor="password">Password</label>
                    <div className="relative group">
                      <span className={iconCls}><Icon name="shield" size={17} /></span>
                      <input id="password" type="password" className={`lg-input ${inputCls}`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !username || !password}
                    className="lg-btn relative overflow-hidden w-full rounded-xl py-3.5 font-bold text-white bg-gradient-to-r from-accent-600 via-accent-500 to-accent-400 shadow-lg shadow-accent-900/40 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:hover:translate-y-0 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span className="lg-shine pointer-events-none absolute inset-y-0 left-0 w-1/4 bg-white/30 -translate-x-full" />
                    {busy ? <Spinner /> : null}
                    <span className="relative">{busy ? "Signing in…" : "Sign in"}</span>
                  </button>
                </form>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-accent-600 text-white flex items-center justify-center">
            <Icon name="flask" size={22} />
          </div>
          <div>
            <div className="text-lg font-extrabold leading-tight">{site === "vswarehouse" ? "VSWarehouse Token Monitor" : "Germline Exome QC Hub"}</div>
            <div className="text-xs text-slate-500 font-medium">Anderson Diagnostics & Labs · {ORGS[currentOrgId()]?.name}</div>
          </div>
        </div>

        <form onSubmit={submit} autoComplete="off" className="card p-6 space-y-4">
          <div>
            <h1 className="text-base font-bold">Sign in</h1>
            <p className="text-sm text-slate-500 mt-0.5">Use the account for your team.</p>
          </div>
          {fields}
        </form>
        <a href="/" className="block text-center text-xs font-semibold text-slate-500 hover:text-slate-700 mt-4">
          ← Back
        </a>
      </div>
    </div>
  );
}
