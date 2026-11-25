import { useEffect, useRef } from "react";
import styles from "../vswarehouse/dashboard.css?inline";
import template from "../vswarehouse/template.js";
import { mountTokenMonitor } from "../vswarehouse/tokenMonitor.js";

const FONT_LINK_ID = "vsw-inter-font";

/**
 * VSWarehouse Token Monitor for the signed-in organization. The dashboard (original markup,
 * styles and script) lives in a shadow root so it keeps its own look without touching the
 * Germline styles; the data it shows is whatever /api/vswarehouse returns for the session's
 * organization, so CMC and NGS each see only their own license, CSVs and Google Sheet.
 */
export default function VSWarehouse({ onBack }) {
  const hostRef = useRef(null);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!document.getElementById(FONT_LINK_ID)) {
      const link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
      document.head.appendChild(link);
    }

    const host = hostRef.current;
    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${styles}</style><div class="vsw-root" data-mode="csv">${template}</div>`;
    const wrapper = root.querySelector(".vsw-root");
    const destroy = mountTokenMonitor(root, wrapper, { onBack: () => onBackRef.current?.() });
    return () => {
      destroy();
      root.innerHTML = "";
    };
  }, []);

  return <div ref={hostRef} className="min-h-screen" />;
}
