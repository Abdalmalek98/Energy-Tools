import XLSX from 'xlsx-js-style';

export const COLORS = {
  ink: '1F2A37', head: '0F4C5C', headText: 'FFFFFF', band: 'EEF3F6', input: 'FFF4CC', border: 'C9D3DB',
  OK: 'C8E6C9', Review: 'FFF3C4', Action: 'FFD8B0', Priority: 'F8B4B4',
  Excellent: 'C8E6C9', Good: 'DCEDC8', Fair: 'FFF3C4', 'Needs improvement': 'F8B4B4',
  'On spec': 'C8E6C9', Degraded: 'FFF3C4', Poor: 'FFD8B0', Investigate: 'F8B4B4',
  PASS: 'C8E6C9', FAIL: 'F8B4B4',
};

export interface CellSpec { v?: string | number | boolean | null; f?: string; z?: string; s?: any; }

const thin = { style: 'thin', color: { rgb: COLORS.border } };
export const styles = {
  title: { font: { name: 'Barlow Condensed', sz: 18, bold: true, color: { rgb: COLORS.head } } },
  sub: { font: { name: 'Barlow', sz: 10, italic: true, color: { rgb: '667788' } } },
  head: { font: { name: 'Barlow', sz: 10, bold: true, color: { rgb: COLORS.headText } }, fill: { patternType: 'solid', fgColor: { rgb: COLORS.head } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: { top: thin, bottom: thin, left: thin, right: thin } },
  label: { font: { name: 'Barlow', sz: 10, bold: true }, border: { bottom: thin } },
  body: { font: { name: 'Barlow', sz: 10 }, border: { bottom: thin } },
  num: { font: { name: 'JetBrains Mono', sz: 10 }, alignment: { horizontal: 'right' }, border: { bottom: thin } },
  input: { font: { name: 'JetBrains Mono', sz: 10, color: { rgb: '0000FF' } }, fill: { patternType: 'solid', fgColor: { rgb: COLORS.input } }, alignment: { horizontal: 'right' }, border: { bottom: thin } },
  wrap: { font: { name: 'Barlow', sz: 10 }, alignment: { wrapText: true, vertical: 'top' }, border: { bottom: thin } },
  section: { font: { name: 'Barlow Condensed', sz: 13, bold: true, color: { rgb: COLORS.head } }, border: { bottom: { style: 'medium', color: { rgb: COLORS.head } } } },
};

export function chip(text: string) {
  const c = (COLORS as Record<string, string>)[text];
  return { font: { name: 'Barlow', sz: 10, bold: true }, alignment: { horizontal: 'center' }, border: { bottom: thin }, ...(c ? { fill: { patternType: 'solid', fgColor: { rgb: c } } } : {}) };
}

/** Sparse sheet builder. Rows/cols are 0-based. */
export class Sheet {
  cells = new Map<string, CellSpec>();
  widths: number[] = [];
  merges: XLSX.Range[] = [];
  freeze?: { row: number; col: number };
  maxR = 0;
  maxC = 0;
  constructor(public name: string) {}
  set(r: number, c: number, spec: CellSpec | string | number | null | undefined, s?: any, z?: string) {
    const cs: CellSpec = typeof spec === 'object' && spec !== null ? { ...spec } : { v: spec ?? '' };
    if (s && !cs.s) cs.s = s;
    if (z && !cs.z) cs.z = z;
    this.cells.set(`${r},${c}`, cs);
    this.maxR = Math.max(this.maxR, r);
    this.maxC = Math.max(this.maxC, c);
    return this;
  }
  row(r: number, c0: number, vals: (CellSpec | string | number | null | undefined)[], s?: any) {
    vals.forEach((v, i) => this.set(r, c0 + i, v, s));
  }
  head(r: number, c0: number, labels: string[]) {
    labels.forEach((l, i) => this.set(r, c0 + i, l, styles.head));
  }
  addr(r: number, c: number, abs = false) {
    return XLSX.utils.encode_cell({ r, c }).replace(/^([A-Z]+)(\d+)$/, abs ? '$$$1$$$2' : '$1$2');
  }
  build(cache: boolean): XLSX.WorkSheet {
    const ws: XLSX.WorkSheet = {};
    for (const [k, spec] of this.cells) {
      const [r, c] = k.split(',').map(Number);
      const cell: any = {};
      const v = spec.v;
      if (spec.f) {
        cell.f = spec.f;
        if (cache && v !== undefined && v !== null && v !== '') {
          cell.v = v;
          cell.t = typeof v === 'number' ? 'n' : typeof v === 'boolean' ? 'b' : 's';
        } else cell.t = typeof v === 'string' ? 's' : 'n';
        if (!cache) delete cell.v;
      } else if (typeof v === 'number') {
        if (!Number.isFinite(v)) { cell.t = 's'; cell.v = ''; } else { cell.t = 'n'; cell.v = v; }
      } else if (typeof v === 'boolean') { cell.t = 'b'; cell.v = v; }
      else { cell.t = 's'; cell.v = v ?? ''; }
      if (spec.z) cell.z = spec.z;
      if (spec.s) cell.s = spec.s;
      ws[XLSX.utils.encode_cell({ r, c })] = cell;
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } });
    if (this.widths.length) ws['!cols'] = this.widths.map((w) => ({ wch: w }));
    if (this.merges.length) ws['!merges'] = this.merges;
    if (this.freeze) (ws as any)['!freeze'] = this.freeze;
    return ws;
  }
}
export const q = (name: string) => `'${name.replace(/'/g, "''")}'`;
export const colLetter = (c: number) => XLSX.utils.encode_col(c);
