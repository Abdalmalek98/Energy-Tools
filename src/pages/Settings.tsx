import { useStore } from '../app/store';
import { Card, Field, PageHead } from '../components/ui';
import { AboutPanel } from './About';

export function SettingsPage() {
  const { theme, setTheme, license } = useStore();
  return (
    <>
      <PageHead title="Settings" subtitle="Application preferences. Engineering assumptions live under Plant Settings." />
      <Card title="Appearance">
        <Field label="Theme">
          <select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark' | 'system')} style={{ maxWidth: 240 }}>
            <option value="system">Follow system</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </Field>
      </Card>
      <Card title="License validation policy">
        <dl className="kv">
          <dt>Initial activation</dt><dd>Internet required</dd>
          <dt>After activation</dt><dd>Works offline</dd>
          <dt>Periodic check</dt><dd>{license?.nextValidationDue && license.lastValidation ? `every ${Math.round((Date.parse(license.nextValidationDue) - Date.parse(license.lastValidation)) / 864e5)} days (set by the licensing service)` : 'set by the licensing service'}</dd>
          <dt>Offline grace</dt><dd>{license?.graceEndsAt && license.nextValidationDue ? `${Math.round((Date.parse(license.graceEndsAt) - Date.parse(license.nextValidationDue)) / 864e5)} days after a check is due` : '—'}</dd>
        </dl>
        <p className="hint">Remote revocation cannot reach a computer that is completely offline – it takes effect the next time this computer validates online.</p>
      </Card>
      <Card title="About"><AboutPanel /></Card>
    </>
  );
}
