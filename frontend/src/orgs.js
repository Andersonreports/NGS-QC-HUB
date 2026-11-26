// Organization registry. Each organization is an independent site. By default each
// lives at its own path inside this app; set VITE_CMC_URL / VITE_NGS_URL at build time
// to send users to a separately hosted website instead.
export const ORGS = {
  cmc: {
    id: "cmc",
    name: "CMC - Ranipet",
    path: "/cmc",
    url: import.meta.env.VITE_CMC_URL || "",
    tagline: "Germline Exome QC Hub",
    blurb: "CMC - Ranipet workspace: sequencing runs, QC approvals and monthly reports.",
  },
  ngs: {
    id: "ngs",
    name: "Anderson Diagnosis and Lab - Chennai",
    path: "/ngs",
    url: import.meta.env.VITE_NGS_URL || "",
    tagline: "Germline Exome QC Hub",
    blurb: "Anderson Diagnosis and Lab - Chennai workspace: sequencing runs, QC approvals and monthly reports.",
  },
};

/** Where choosing an organization takes the user (external site if configured). */
export function orgHref(org) {
  return org.url || org.path;
}

export function currentOrgId(pathname = window.location.pathname) {
  const seg = pathname.split("/")[1]?.toLowerCase();
  return ORGS[seg] ? seg : null;
}
