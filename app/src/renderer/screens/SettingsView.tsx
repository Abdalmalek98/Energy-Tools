import { useEffect, useState } from "react";
import type { SpaceRule } from "@lsr/shared";
import { daysLeft, type LicStatus } from "../types";
import { useProject } from "../store";

export function SettingsView({ status }: { status: LicStatus }) {
  const { spaceRules, setSpaceRules } = useProject();
  const [defaults, setDefaults] = useState<SpaceRule[]>([]);
  const [rules, setRules] = useState<SpaceRule[]>([]);
  const [msg, setMsg] = useState("");
  useEffect(() => { void window.api.settings.get().then((s: { spaceRules: SpaceRule[] | null; defaultSpaceRules: SpaceRule[] }) => { setDefaults(s.defaultSpaceRules); setRules(s.spaceRules ?? s.defaultSpaceRules); setSpaceRules(s.spaceRules ?? undefined); }); }, [setSpaceRules]);
  const save = (r: SpaceRule[] | null) => { void window.api.settings.set({ spaceRules: r }); setSpaceRules(r ?? undefined); };
  const s = status.state; const info = s.kind === "active" ? s.info : null;
  const d = info ? daysLeft(info.endsAt, status.now) : null;
  return (
    <div className="page">
      <h1>Settings & About</h1>
      <div className="card" data-testid="about">
        <h2>Licence</h2>
        {info ? <p>{info.customer} · {d == null ? "no end date" : `${d} days left`} · {info.quotaMonth == null ? "unlimited pages" : `${info.quotaLeft} pages left this month`}</p> : <p>Not active.</p>}
        <div className="row">
          <button data-testid="check-licence" onClick={() => void window.api.license.refresh()}>Check licence now</button>
          <button className="danger" data-testid="deactivate" onClick={() => { if (confirm("Deactivate this PC? You can activate the code on another PC afterwards.")) void window.api.license.deactivate(); }}>Deactivate this PC</button>
        </div>
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
