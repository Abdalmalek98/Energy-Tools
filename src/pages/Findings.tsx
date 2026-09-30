import { useStore } from '../app/store';
import { Card, Chip, NeedData, PageHead } from '../components/ui';
import { fmt0 } from '../utils/format';

export function FindingsPage() {
  const { analysis: a, table } = useStore();
  if (!table || !a) return (<><PageHead title="Findings" /><NeedData /></>);
  const total = a.findings.reduce((t, f) => t + (f.savingsKWh ?? 0), 0);
  return (
    <>
      <PageHead title="Findings" subtitle="Generated automatically from the analysis. Savings are indicative estimates based on stated assumptions." />
      {a.findings.map((f) => (
        <Card key={f.id}>
          <div className="finding">
            <Chip label={f.status} />
            <div>
              <h2>{f.title}</h2>
              <p style={{ margin: '6px 0 0' }}>{f.text}</p>
              <div className="nums">
                {f.numbers.map((n) => <span key={n.label}>{n.label}: <b>{n.value}</b></span>)}
                {f.savingsKWh !== undefined && <span>Estimated saving: <b>{fmt0(f.savingsKWh)} kWh</b> · <b>{fmt0(f.savingsCost ?? 0)} {a.settings.currency}</b></span>}
              </div>
            </div>
          </div>
        </Card>
      ))}
      <p className="hint">Sum of individual estimates (opportunities overlap, so do not add them up blindly): {fmt0(total)} kWh.</p>
    </>
  );
}
