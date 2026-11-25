import { useEffect } from "react";
import App from "./App.jsx";
import Landing from "./components/Landing";
import { ORGS, currentOrgId } from "./orgs";

/** Entry point: "/" is the organization picker; each organization is its own site. */
export default function Root() {
  const org = currentOrgId();
  const external = org && ORGS[org].url;

  useEffect(() => {
    if (external) window.location.replace(external);
  }, [external]);

  useEffect(() => {
    if (org) document.documentElement.dataset.org = org;
    document.title = org ? `${ORGS[org].name} – Anderson Diagnostics & Labs` : "Anderson Diagnostics & Labs";
  }, [org]);

  if (external) return null;
  if (org) return <App />;
  return <Landing />;
}
