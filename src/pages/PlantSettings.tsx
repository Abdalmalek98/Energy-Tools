import { useStore } from '../app/store';
import { Card, Field, NumberField, PageHead } from '../components/ui';
import type { Settings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';

export function PlantSettingsPage() {
  const { settings: s, updateSettings, resetSettings, parsed } = useStore();
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => updateSettings({ [k]: v } as Partial<Settings>);
  const ids = parsed?.chillers ?? Object.keys(s.chillerOverrides);
  const setOverride = (id: string, key: 'ratedTR' | 'ratedKwPerTR', v: number | undefined) => {
    const cur = { ...(s.chillerOverrides[id] ?? {}) };
    if (v === undefined) delete cur[key]; else cur[key] = v;
    updateSettings({ chillerOverrides: { ...s.chillerOverrides, [id]: cur } });
  };
  return (
    <>
      <PageHead title="Plant Settings" subtitle="Engineering assumptions used by every calculation. Defaults follow the original specification.">
        <button className="btn" onClick={resetSettings}>Restore defaults</button>
      </PageHead>
      <div className="grid g2">
        <Card title="Data interpretation">
          <div className="form-grid">
            <Field label="Power column"><select value={s.powerMode} onChange={(e) => set('powerMode', e.target.value as Settings['powerMode'])}><option value="demandKW">Demand kW</option><option value="intervalKWh">Interval energy kWh</option><option value="cumulativeKWh">Cumulative kWh (meter)</option></select></Field>
            <Field label="Cooling load"><select value={s.loadSource} onChange={(e) => set('loadSource', e.target.value as Settings['loadSource'])}><option value="flowDT">Flow × ΔT</option><option value="column">Load column</option></select></Field>
            {s.loadSource === 'column' && <Field label="Load units"><select value={s.loadUnit} onChange={(e) => set('loadUnit', e.target.value as Settings['loadUnit'])}><option value="TR">TR</option><option value="kWth">kW thermal</option><option value="TRh">TR·h</option><option value="kWhth">kWh thermal</option></select></Field>}
            <Field label="Flow units"><select value={s.flowUnit} onChange={(e) => set('flowUnit', e.target.value as Settings['flowUnit'])}><option value="L/s">L/s</option><option value="m3/h">m³/h</option><option value="gpm">gpm</option></select></Field>
            <Field label="Temperature units"><select value={s.tempUnit} onChange={(e) => set('tempUnit', e.target.value as Settings['tempUnit'])}><option value="C">°C</option><option value="F">°F</option></select></Field>
            <Field label="Plant type"><select value={s.plantType} onChange={(e) => set('plantType', e.target.value as Settings['plantType'])}><option value="water">Water-cooled</option><option value="air">Air-cooled</option></select></Field>
            <Field label="Auxiliary power per timestamp"><select value={s.auxMode} onChange={(e) => set('auxMode', e.target.value as Settings['auxMode'])}><option value="max">Max of rows (repeated value)</option><option value="sum">Sum of per-chiller rows</option></select></Field>
          </div>
        </Card>
        <Card title="Design & targets">
          <div className="form-grid">
            <NumberField label="Default rated capacity (TR)" value={s.ratedTR} onChange={(v) => set('ratedTR', v)} hint={`default ${DEFAULT_SETTINGS.ratedTR}`} />
            <NumberField label="Default rated kW/TR" value={s.ratedKwPerTR} onChange={(v) => set('ratedKwPerTR', v)} hint={`default ${DEFAULT_SETTINGS.ratedKwPerTR}`} />
            <NumberField label="Design CHW ΔT (°C)" value={s.designDeltaT} onChange={(v) => set('designDeltaT', v)} hint={`default ${DEFAULT_SETTINGS.designDeltaT}`} />
            <NumberField label="Target plant kW/TR" value={s.targetKwPerTR} onChange={(v) => set('targetKwPerTR', v)} hint={`default ${DEFAULT_SETTINGS.targetKwPerTR}`} />
            <NumberField label={`Tariff (${s.currency}/kWh)`} value={s.tariff} onChange={(v) => set('tariff', v)} hint={`default ${DEFAULT_SETTINGS.tariff}`} />
            <Field label="Currency"><input type="text" value={s.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
          </div>
        </Card>
      </div>
      <Card title="Row filters">
        <div className="form-grid">
          <Field label="Outlier filter"><label className="check"><input type="checkbox" checked={s.outlierFilter} onChange={(e) => set('outlierFilter', e.target.checked)} /> enabled</label></Field>
          <NumberField label="Outlier min kW/TR" value={s.outlierMin} onChange={(v) => set('outlierMin', v)} />
          <NumberField label="Outlier max kW/TR" value={s.outlierMax} onChange={(v) => set('outlierMax', v)} />
          <NumberField label="Minimum PLR" value={s.minPLR} step="0.01" onChange={(v) => set('minPLR', v)} hint="rows with load ≤ rated × PLR are excluded" />
        </div>
        <p className="hint">Always excluded: non-numeric values, kW ≤ 1, load ≤ rated capacity × minimum PLR.</p>
      </Card>
      <Card title="Weather (CDD) analysis">
        <div className="form-grid">
          <NumberField label="CDD base temperature (°C)" value={s.cddBaseTemp} onChange={(v) => set('cddBaseTemp', v)} hint="used when the weather file has temperatures; 18.3 °C = 65 °F" />
          <NumberField label="Typical annual CDD (optional)" value={s.typicalAnnualCdd} onChange={(v) => set('typicalAnnualCdd', v)} hint="0 = not set; enables annual weather-normalised energy" />
          <NumberField label="Minimum logged share of a day" value={s.cddMinCoverage} step="0.05" onChange={(v) => set('cddMinCoverage', v)} hint="days below this are left out of the regression" />
        </div>
      </Card>
      <Card title="Hourly weather">
        <div className="form-grid">
          <Field label="Time stamps mean"><select value={s.weatherHourEnding ? 'end' : 'start'} onChange={(e) => set('weatherHourEnding', e.target.value === 'end')}><option value="start">Start of the hour (13:00 = 13:00–14:00)</option><option value="end">End of the hour (14:00 = 13:00–14:00)</option></select></Field>
          <Field label="Plant-off hours"><label className="check"><input type="checkbox" checked={s.weatherIncludeOffHours} onChange={(e) => set('weatherIncludeOffHours', e.target.checked)} /> include logged off hours (zero energy)</label></Field>
          <NumberField label="Atmospheric pressure (kPa)" value={s.atmPressureKPa} onChange={(v) => set('atmPressureKPa', v)} hint="used to compute enthalpy from temperature + humidity; 101.325 = sea level" />
        </div>
      </Card>
      <Card title="Annual projection">
        <div className="form-grid">
          <Field label="Weather driver"><select value={s.annualPredictor} onChange={(e) => set('annualPredictor', e.target.value as typeof s.annualPredictor)}><option value="auto">Automatic (wet-bulb if humidity exists)</option><option value="wetbulb">Wet-bulb temperature</option><option value="temperature">Dry-bulb temperature</option><option value="enthalpy">Enthalpy</option></select></Field>
          <NumberField label="Proposed plant efficiency (kW/TR)" value={s.annualProposedKwPerTR} step="0.01" onChange={(v) => set('annualProposedKwPerTR', v)} hint="0 = no savings scenario" />
          <NumberField label="Safety factor (%)" value={s.annualSafetyPct} onChange={(v) => set('annualSafetyPct', v)} hint="added to the proposed plant's consumption" />
        </div>
      </Card>
      {ids.length > 0 && (
        <Card title="Per-chiller ratings (optional overrides)">
          <div className="table-wrap"><table>
            <thead><tr><th>Chiller</th><th>Rated TR</th><th>Rated kW/TR</th></tr></thead>
            <tbody>{ids.map((id) => (
              <tr key={id}><td><b>{id}</b></td>
                <td><input type="number" style={{ width: 110 }} placeholder={String(s.ratedTR)} value={s.chillerOverrides[id]?.ratedTR ?? ''} onChange={(e) => setOverride(id, 'ratedTR', e.target.value === '' ? undefined : Number(e.target.value))} /></td>
                <td><input type="number" style={{ width: 110 }} step="0.01" placeholder={String(s.ratedKwPerTR)} value={s.chillerOverrides[id]?.ratedKwPerTR ?? ''} onChange={(e) => setOverride(id, 'ratedKwPerTR', e.target.value === '' ? undefined : Number(e.target.value))} /></td></tr>
            ))}</tbody></table></div>
        </Card>
      )}
    </>
  );
}
