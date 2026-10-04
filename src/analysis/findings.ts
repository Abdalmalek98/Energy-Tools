import type { AnalysisResult, Finding, ParsedBms, Status } from '../types';
import { fmt, fmt0 } from '../utils/format';
import { mean, std } from '../utils/stats';

// Indicative savings assumptions – documented in ARCHITECTURE.md; they are estimates, not guarantees.
export const ASSUMPTIONS = {
  stagingSavingFraction: 0.03, // of kWh in intervals where one fewer chiller could carry the load
  stagingLoadCeiling: 0.85, // n-1 chillers must stay below this fraction of their capacity
  chwResetPctPerDegC: 0.015, // ~1.5 % chiller energy per °C LCHWT rise
  chwResetStepC: 1,
  auxShareTarget: 0.1,
};

const sav = (a: AnalysisResult, kWh: number) => ({ savingsKWh: kWh, savingsCost: kWh * a.settings.tariff });

export function buildFindings(a: AnalysisResult, bms: ParsedBms): Finding[] {
  const s = a.settings;
  const k = a.kpis;
  const out: Finding[] = [];
  const cur = s.currency;

  // 1 Overall efficiency
  {
    const r = k.plantKwPerTR / s.targetKwPerTR;
    const status: Status = r <= 1 ? 'OK' : r <= 1.15 ? 'Review' : r <= 1.3 ? 'Action' : 'Priority';
    out.push({
      id: 'overall', status, title: 'Overall plant efficiency',
      text: `Plant runs at ${fmt(k.plantKwPerTR, 3)} kW/TR (${k.plantRating}) against a target of ${fmt(s.targetKwPerTR, 2)} kW/TR.` +
        (k.kWhAboveTarget > 0 ? ` Energy above target: ${fmt0(k.kWhAboveTarget)} kWh (${fmt0(k.costAboveTarget)} ${cur}).` : ''),
      numbers: [
        { label: 'Plant kW/TR', value: fmt(k.plantKwPerTR, 3) }, { label: 'Plant COP', value: fmt(k.plantCOP, 2) },
        { label: 'Target kW/TR', value: fmt(s.targetKwPerTR, 2) }, { label: 'Annualized cost above target', value: `${fmt0(k.annualizedCost)} ${cur}` },
      ],
      ...(k.kWhAboveTarget > 0 ? sav(a, k.kWhAboveTarget) : {}),
    });
  }

  // 2 Staging
  {
    const nCh = a.chillers.length;
    const capEach = nCh ? k.installedTR / nCh : 0;
    const cand = a.plantRows.filter((p) => p.nRunning >= 2 && p.tr <= ASSUMPTIONS.stagingLoadCeiling * capEach * (p.nRunning - 1));
    const share = a.plantRows.length ? cand.length / a.plantRows.length : 0;
    const kWh = cand.reduce((x, p) => x + p.kW + p.aux, 0) * a.intervalHours;
    const status: Status = nCh < 2 ? 'OK' : share < 0.05 ? 'OK' : share < 0.15 ? 'Review' : 'Action';
    out.push({
      id: 'staging', status, title: 'Chiller staging',
      text: nCh < 2 ? 'Single-chiller plant – staging is not applicable.' :
        `${cand.length} interval(s) (${fmt(share * 100, 1)} %) ran more chillers than the load required (one fewer chiller would stay below ${ASSUMPTIONS.stagingLoadCeiling * 100} % of capacity).`,
      numbers: [{ label: 'Over-staged intervals', value: String(cand.length) }, { label: 'Share of time', value: `${fmt(share * 100, 1)} %` }],
      ...(nCh >= 2 && cand.length ? sav(a, kWh * ASSUMPTIONS.stagingSavingFraction) : {}),
    });
  }

  // 3 Condenser water optimisation (from multivariate models)
  {
    let gain = 0;
    let used = 0;
    for (const reg of a.chillerRegressions) {
      const mv = reg.models.find((m) => m.kind === 'multivariate');
      if (!mv) continue;
      used++;
      for (const r of a.chillerRows.filter((x) => x.chiller === reg.subject && Number.isFinite(x.ecwt))) {
        const d = mv.predict(r.load, r.ecwt, r.lchwt) - mv.predict(r.load, r.ecwt - 1, r.lchwt);
        gain += d * a.intervalHours;
      }
    }
    const share = k.chillerKWh > 0 ? gain / k.chillerKWh : 0;
    const status: Status = used === 0 ? 'Review' : share < 0.01 ? 'OK' : share < 0.025 ? 'Review' : 'Action';
    out.push({
      id: 'condenser', status, title: 'Condenser-water optimisation',
      text: used === 0 ? 'No multivariate model available (needs ECWT and more than 20 samples) – condenser-water sensitivity could not be quantified.' :
        `Regression models indicate ${fmt0(gain)} kWh (${fmt(share * 100, 1)} % of chiller energy) could be saved for every 1 °C reduction of entering condenser-water temperature.`,
      numbers: [{ label: 'Chillers modelled', value: String(used) }, { label: 'Saving per −1 °C ECWT', value: `${fmt0(gain)} kWh` }],
      ...(used && gain > 0 ? sav(a, gain) : {}),
    });
  }

  // 4 CHW reset
  {
    const l = a.plantRows.map((p) => p.lchwt).filter(Number.isFinite);
    const sd = l.length ? std(l) : NaN;
    const avgL = mean(l);
    const avgPlr = k.installedTR ? k.avgLoad / k.installedTR : NaN;
    const fixed = Number.isFinite(sd) && sd < 0.3;
    const status: Status = !l.length ? 'Review' : fixed && avgPlr < 0.75 ? 'Action' : 'OK';
    out.push({
      id: 'chwreset', status, title: 'Chilled-water temperature reset',
      text: !l.length ? 'No LCHWT data mapped – chilled-water reset could not be assessed.' :
        fixed ? `LCHWT is essentially fixed (σ = ${fmt(sd, 2)} °C, mean ${fmt(avgL, 1)} °C) while average plant load is ${fmt(avgPlr * 100, 0)} % of installed capacity. A supply-temperature reset at part load is likely to reduce chiller energy.` :
          `LCHWT varies (σ = ${fmt(sd, 2)} °C, mean ${fmt(avgL, 1)} °C) – some reset is already in operation.`,
      numbers: [{ label: 'Mean LCHWT', value: `${fmt(avgL, 1)} °C` }, { label: 'σ LCHWT', value: `${fmt(sd, 2)} °C` }, { label: 'Avg plant PLR', value: `${fmt(avgPlr * 100, 0)} %` }],
      ...(l.length && fixed && avgPlr < 0.75 ? sav(a, k.chillerKWh * ASSUMPTIONS.chwResetPctPerDegC * ASSUMPTIONS.chwResetStepC) : {}),
    });
  }

  // 5 Least efficient chiller
  {
    const worst = [...a.chillers].sort((x, y) => y.pctVsRated - x.pctVsRated)[0];
    if (worst) {
      const map: Record<string, Status> = { 'On spec': 'OK', Degraded: 'Review', Poor: 'Action', Investigate: 'Priority' };
      const recover = Math.max(0, worst.kWh - worst.trHours * worst.ratedKwPerTR);
      out.push({
        id: 'worst', status: map[worst.status], title: `Least efficient chiller: ${worst.id}`,
        text: `${worst.id} runs at ${fmt(worst.kwPerTR, 3)} kW/TR, ${fmt(worst.pctVsRated, 1)} % versus its rated ${fmt(worst.ratedKwPerTR, 2)} kW/TR (${worst.status}).`,
        numbers: [{ label: 'kW/TR', value: fmt(worst.kwPerTR, 3) }, { label: 'Rated kW/TR', value: fmt(worst.ratedKwPerTR, 2) }, { label: 'vs rated', value: `${fmt(worst.pctVsRated, 1)} %` }],
        ...(recover > 0 ? sav(a, recover) : {}),
      });
    }
  }

  // 6 Aux
  {
    const share = k.auxShare;
    const status: Status = !(k.auxKWh > 0) ? 'Review' : share <= 0.1 ? 'OK' : share <= 0.15 ? 'Review' : 'Action';
    const target = (ASSUMPTIONS.auxShareTarget / (1 - ASSUMPTIONS.auxShareTarget)) * k.chillerKWh;
    const excess = Math.max(0, k.auxKWh - target);
    out.push({
      id: 'aux', status, title: 'Auxiliary consumption',
      text: k.auxKWh > 0 ? `Auxiliaries (pumps, towers) use ${fmt0(k.auxKWh)} kWh, ${fmt(share * 100, 1)} % of plant energy.` : 'No auxiliary power data mapped – plant kW/TR excludes auxiliaries.',
      numbers: [{ label: 'Aux kWh', value: fmt0(k.auxKWh) }, { label: 'Aux share', value: `${fmt(share * 100, 1)} %` }],
      ...(excess > 0 ? sav(a, excess) : {}),
    });
  }

  // 7 CHW ΔT
  {
    const dts = a.plantRows.map((p) => p.echwt - p.lchwt).filter(Number.isFinite);
    const dt = mean(dts);
    const r = dt / s.designDeltaT;
    const status: Status = !dts.length ? 'Review' : r >= 0.95 ? 'OK' : r >= 0.85 ? 'Review' : 'Action';
    out.push({
      id: 'deltat', status, title: 'Chilled-water ΔT',
      text: dts.length ? `Average CHW ΔT is ${fmt(dt, 2)} °C versus a design of ${fmt(s.designDeltaT, 1)} °C (${fmt(r * 100, 0)} %). ${r < 0.95 ? 'Low ΔT increases pumping energy and can force extra chillers on.' : ''}` : 'ECHWT/LCHWT not available – ΔT not assessed.',
      numbers: [{ label: 'Avg ΔT', value: `${fmt(dt, 2)} °C` }, { label: 'Design ΔT', value: `${fmt(s.designDeltaT, 1)} °C` }],
    });
  }

  // 8 Regression baseline
  {
    const m = a.plantRegression?.selected;
    out.push({
      id: 'regression', status: !m ? 'Review' : m.guideline14.pass ? 'OK' : 'Review', title: 'Regression baseline (ASHRAE Guideline 14)',
      text: m ? `Selected ${m.kind} plant model: CV(RMSE) ${fmt(m.cv, 1)} % (limit ${m.guideline14.cvLimit} %), NMBE ${fmt(m.nmbe, 2)} % (limit ±${m.guideline14.nmbeLimit} %) – ${m.guideline14.pass ? 'PASS' : 'FAIL'}.` : 'Not enough data to build a regression baseline.',
      numbers: m ? [{ label: 'R²', value: fmt(m.r2, 3) }, { label: 'CV(RMSE)', value: `${fmt(m.cv, 1)} %` }, { label: 'NMBE', value: `${fmt(m.nmbe, 2)} %` }, { label: 'n', value: String(m.n) }] : [],
    });
  }

  // 9 Data quality
  {
    const e = a.exclusions;
    const share = e.total ? e.excluded / e.total : 0;
    const status: Status = share < 0.05 && !bms.gapCount ? 'OK' : share < 0.2 ? 'Review' : 'Action';
    out.push({
      id: 'quality', status, title: 'Data quality',
      text: `${e.excluded} of ${e.total} rows (${fmt(share * 100, 1)} %) were excluded. ${bms.gapCount} logging gap(s), ${bms.duplicateCount} duplicate row(s).`,
      numbers: [
        { label: 'Non-numeric', value: String(e.reasons.nonNumeric) }, { label: 'kW ≤ 1', value: String(e.reasons.lowPower) },
        { label: 'Low load', value: String(e.reasons.lowLoad) }, { label: 'Outlier', value: String(e.reasons.outlier) },
      ],
    });
  }

  // 10 Weather (only when the customer supplied CDD data)
  if (a.cdd) {
    const c = a.cdd;
    const m = c.energyModel;
    if (!m) {
      out.push({ id: 'weather', status: 'Review', title: 'Weather (CDD) baseline', text: c.notes.filter((n) => /Only|hardly|could not/.test(n)).join(' ') || 'The CDD regression could not be computed.', numbers: [{ label: 'Days used', value: String(c.usedDays) }] });
    } else {
      const slope = m.coefs[1].value;
      const late = c.secondHalfResidualPct;
      const drift = late !== null && c.firstHalfResidualPct !== null ? late : null;
      // a large unexplained rise is the headline even when the whole-period fit is poor (the rise is what spoils the fit)
      const status: Status = drift !== null && drift > 10 ? 'Action' : !m.guideline14.pass || (drift !== null && drift > 5) ? 'Review' : 'OK';
      const secondHalf = c.days.filter((d) => d.used).slice(Math.floor(c.usedDays / 2));
      const excess = secondHalf.reduce((t, d) => t + Math.max(0, d.residualKWh ?? 0), 0);
      out.push({
        id: 'weather', status, title: 'Weather (CDD) baseline',
        text: `Daily energy follows cooling degree days with R² ${fmt(m.r2, 2)} (${m.guideline14.pass ? 'Guideline 14 PASS' : 'Guideline 14 FAIL'}): about ${fmt0(slope)} kWh per CDD on top of a base of ${fmt0(m.coefs[0].value)} kWh/day.` +
          (c.weatherShare !== null ? ` Weather explains ${fmt(c.weatherShare * 100, 0)} % of average daily energy.` : '') +
          (drift !== null ? ` In the second half of the period the plant used ${fmt(drift, 1)} % ${drift >= 0 ? 'more' : 'less'} than the weather-expected energy (first half ${fmt(c.firstHalfResidualPct ?? NaN, 1)} %).` : '') +
          (c.normalised ? ` Weather-normalised plant efficiency at ${c.refLabel}: ${fmt(c.normalised.kwPerTR, 3)} kW/TR.` : ''),
        numbers: [
          { label: 'Days used', value: String(c.usedDays) }, { label: 'R²', value: fmt(m.r2, 3) }, { label: 'CV(RMSE)', value: `${fmt(m.cv, 1)} %` }, { label: 'NMBE', value: `${fmt(m.nmbe, 2)} %` },
          ...(c.normalised ? [{ label: 'Normalised kW/TR', value: fmt(c.normalised.kwPerTR, 3) }] : []),
        ],
        ...(drift !== null && drift > 5 && excess > 0 ? sav(a, excess) : {}),
      });
    }
  }
  // 11 Hourly weather (only when the customer supplied hourly weather data)
  if (a.weather) {
    const w = a.weather;
    const sel = w.selected;
    if (!sel) {
      out.push({ id: 'weather-hourly', status: 'Review', title: 'Hourly weather baseline', text: w.notes.filter((n) => /Only|hardly|could not/.test(n)).join(' ') || 'The hourly weather regression could not be computed.', numbers: [{ label: 'Hours used', value: String(w.usedHours) }] });
    } else {
      const m = sel.energy;
      const unit = sel.id === 'enthalpy' ? 'kJ/kg' : '°C';
      const bins = w.tempBins.filter((b) => b.hours >= 10 && Number.isFinite(b.kwPerTR));
      let degr: number | null = null;
      if (bins.length >= 3) {
        const mild = bins[0], hot = bins[bins.length - 1];
        degr = (hot.kwPerTR / mild.kwPerTR - 1) * 100;
      }
      const status: Status = degr !== null && degr > 25 ? 'Action' : !m.guideline14.pass || (degr !== null && degr > 15) ? 'Review' : 'OK';
      out.push({
        id: 'weather-hourly', status, title: 'Hourly weather baseline',
        text: `Best hourly model: ${sel.label.toLowerCase()} (R² ${fmt(m.r2, 2)}, CV(RMSE) ${fmt(m.cv, 1)} %, ${m.guideline14.pass ? 'Guideline 14 PASS' : 'Guideline 14 FAIL'}). ` +
          (sel.id === 'temperature+humidity' ? `Plant power changes by ${fmt0(m.coefs[1].value)} kW per °C and ${fmt(m.coefs[2].value, 1)} kW per %RH.` : `Plant power changes by ${fmt(m.coefs[1].value, 1)} kW per ${unit}.`) +
          (degr !== null ? ` Efficiency in the hottest hours (${bins[bins.length - 1].label}) is ${fmt(degr, 0)} % ${degr >= 0 ? 'worse' : 'better'} than in the mildest (${bins[0].label}).` : '') +
          (w.normalised ? ` At mean weather the plant runs at ${fmt(w.normalised.kwPerTR, 3)} kW/TR.` : ''),
        numbers: [
          { label: 'Hours used', value: String(w.usedHours) }, { label: 'R²', value: fmt(m.r2, 3) }, { label: 'CV(RMSE)', value: `${fmt(m.cv, 1)} %` }, { label: 'NMBE', value: `${fmt(m.nmbe, 2)} %` },
          ...(w.correlations.temperature !== null ? [{ label: 'r (kW, T)', value: fmt(w.correlations.temperature, 2) }] : []),
          ...(w.correlations.enthalpy !== null ? [{ label: 'r (kW, h)', value: fmt(w.correlations.enthalpy, 2) }] : []),
          ...(w.correlations.humidity !== null ? [{ label: 'r (kW, RH)', value: fmt(w.correlations.humidity, 2) }] : []),
        ],
      });
    }
  }
  return out;
}
