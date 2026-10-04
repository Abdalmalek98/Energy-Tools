import { useEffect, useState } from "react";
import type { SpaceRule } from "@lsr/shared";
import { isError, type LicStatus } from "../types";
import { LicensePanel } from "./LicensePanel";
import { PersonalGroq } from "./PersonalGroq";
import { useProject } from "../store";

export function SettingsView({ status }: { status: LicStatus }) {
  const { spaceRules, setSpaceRules } = useProject();
  const [defaults, setDefaults] = useState<SpaceRule[]>([]);
  const [rules, setRules] = useState<SpaceRule[]>([]);
  const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  useEffect(() => { void window.api.settings.get().then((s: { spaceRules: SpaceRule[] | null; defaultSpaceRules: SpaceRule[] } | { error: string }) => { if (isError(s)) return setErr(s.error); setDefaults(s.defaultSpaceRules); setRules(s.spaceRules ?? s.defaultSpaceRules); setSpaceRules(s.spaceRules ?? undefined); }); }, [setSpaceRules]);
  const save = async (r: SpaceRule[] | null) => { const res = await window.api.settings.set({ spaceRules: r }); if (isError(res)) return setErr(`Couldn’t save the settings: ${res.error}`); setErr(""); setSpaceRules(r ?? undefined); };
  return (
    <div className="page">
      <h1>Settings & About</h1>
      {err && <p className="error" role="alert" data-testid="settings-error">{err}</p>}
      {status.personal ? <PersonalGroq /> : <LicensePanel status={status} />}
      <div className="card" data-testid="about">
        <h2>About</h2>
        <p>Version {status.version}</p>
        <button onClick={async () => setMsg((await window.api.updates.check()).message)}>Check for updates</button> <span className="muted">{msg}</span>
      </div>
      <div className="card">
        <h2>Space types</h2>
        <p className="muted small">Room names containing these words get the space type shown. First matching row wins. Separate words with commas.</p>
        <table className="rules"><thead><tr><th>Keywords</th><th>Space type</th><th /></tr></thead><tbody>
          {rules.map((r, i) => <tr key={i}>
            <td><input dir="auto" value={r.keywords.join(", ")} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, keywords: e.target.value.split(",").map((k) => k.trim().toUpperCase()).filter(Boolean) } : x)))} /></td>
            <td><input dir="auto" value={r.type} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, type: e.target.value.toUpperCase() } : x)))} /></td>
            <td><button onClick={() => setRules(rules.filter((_, j) => j !== i))} aria-label="Remove row">×</button></td></tr>)}
        </tbody></table>
        <div className="row">
          <button onClick={() => setRules([{ keywords: [], type: "" }, ...rules])}>Add row</button>
          <button className="primary" onClick={() => save(rules.filter((r) => r.keywords.length && r.type))}>Save</button>
          <button onClick={() => { setRules(defaults); save(null); }}>Reset to defaults</button>
        </div>
      </div>
    </div>
  );
}
