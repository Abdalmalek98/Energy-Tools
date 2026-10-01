import JSZip from 'jszip';

/** Native Excel chart XML (DrawingML) injected into an xlsx produced by SheetJS. */

export interface SeriesSpec {
  name: string;
  xRef?: string; // scatter/bar categories
  yRef: string;
  xVals?: (number | string)[];
  yVals?: number[];
  color: string;
  kind?: 'markers' | 'line' | 'both';
  dash?: boolean;
  width?: number;
}
export interface ChartSpec {
  title: string;
  type: 'scatter' | 'bar';
  xTitle: string;
  yTitle: string;
  xFormat?: string;
  yFormat?: string;
  xMin?: number;
  xMax?: number;
  yMin?: number;
  series: SeriesSpec[];
  /** 0-based anchor: [col, row, colEnd, rowEnd] */
  anchor: [number, number, number, number];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function numCache(vals: number[] | undefined, fmt = 'General') {
  if (!vals) return '';
  const pts = vals.map((v, i) => (Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '')).join('');
  return `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${pts}</c:numCache>`;
}
function strCache(vals: (number | string)[] | undefined) {
  if (!vals) return '';
  return `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(String(v))}</c:v></c:pt>`).join('')}</c:strCache>`;
}
const numRef = (f: string, vals?: number[], fmt?: string) => `<c:numRef><c:f>${esc(f)}</c:f>${numCache(vals, fmt)}</c:numRef>`;

const txPr = (sz = 900) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
const title = (t: string, sz = 1000, b = 1) => `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${sz}" b="${b}"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

function scatterSer(s: SeriesSpec, i: number, spec: ChartSpec) {
  const kind = s.kind ?? 'markers';
  const ln = kind === 'markers'
    ? '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>'
    : `<c:spPr><a:ln w="${s.width ?? 19050}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${s.dash ? '<a:prstDash val="dash"/>' : ''}<a:round/></a:ln></c:spPr>`;
  const marker = kind === 'line'
    ? '<c:marker><c:symbol val="none"/></c:marker>'
    : `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"><a:alpha val="60000"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:marker>`;
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx>${ln}${marker}` +
    `<c:xVal>${numRef(s.xRef!, s.xVals as number[], spec.xFormat)}</c:xVal><c:yVal>${numRef(s.yRef, s.yVals, spec.yFormat)}</c:yVal><c:smooth val="0"/></c:ser>`;
}
function barSer(s: SeriesSpec, i: number, spec: ChartSpec) {
  const cat = s.xRef ? `<c:cat><c:strRef><c:f>${esc(s.xRef)}</c:f>${strCache(s.xVals)}</c:strRef></c:cat>` : '';
  return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${esc(s.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${cat}<c:val>${numRef(s.yRef, s.yVals, spec.yFormat)}</c:val></c:ser>`;
}

const gridLn = '<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9DEE3"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>';

export function chartXml(spec: ChartSpec): string {
  const valAx = (id: number, cross: number, pos: 'b' | 'l', ttl: string, fmt: string | undefined, min?: number, max?: number) =>
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/>${max !== undefined ? `<c:max val="${max}"/>` : ''}${min !== undefined ? `<c:min val="${min}"/>` : ''}</c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${pos === 'l' ? gridLn : ''}${title(ttl, 900, 0)}<c:numFmt formatCode="${esc(fmt ?? 'General')}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${txPr()}<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="midCat"/></c:valAx>`;
  let plot: string;
  if (spec.type === 'scatter') {
    plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${spec.series.map((s, i) => scatterSer(s, i, spec)).join('')}<c:axId val="50010"/><c:axId val="50020"/></c:scatterChart>` +
      valAx(50010, 50020, 'b', spec.xTitle, spec.xFormat, spec.xMin, spec.xMax) + valAx(50020, 50010, 'l', spec.yTitle, spec.yFormat, spec.yMin);
  } else {
    plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${spec.series.map((s, i) => barSer(s, i, spec)).join('')}<c:gapWidth val="60"/><c:axId val="50010"/><c:axId val="50020"/></c:barChart>` +
      `<c:catAx><c:axId val="50010"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>${title(spec.xTitle, 900, 0)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${txPr()}<c:crossAx val="50020"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      valAx(50020, 50010, 'l', spec.yTitle, spec.yFormat, spec.yMin).replace('midCat', 'between');
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${NS}><c:roundedCorners val="0"/><c:chart>${title(spec.title, 1200, 1)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea><c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txPr()}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

function drawingXml(charts: ChartSpec[]) {
  const anchors = charts.map((c, i) => {
    const [c0, r0, c1, r1] = c.anchor;
    return `<xdr:twoCellAnchor><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

/**
 * Attach native charts to the named worksheet of an xlsx package.
 * `sheetIndex` is the 0-based position of the sheet (SheetJS writes xl/worksheets/sheet{N+1}.xml in order).
 */
export async function attachCharts(xlsx: Uint8Array, sheetIndex: number, charts: ChartSpec[]): Promise<Uint8Array> {
  if (!charts.length) return xlsx;
  const zip = await JSZip.loadAsync(xlsx);
  const sheetPath = `xl/worksheets/sheet${sheetIndex + 1}.xml`;
  let sheetXml = await zip.file(sheetPath)!.async('string');
  if (!/xmlns:r=/.test(sheetXml.slice(0, 500))) sheetXml = sheetXml.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
  // <drawing> must follow pageMargins/pageSetup/headerFooter and precede legacyDrawing/tableParts
  const tag = '<drawing r:id="rIdDrawing1"/>';
  if (/<legacyDrawing|<tableParts/.test(sheetXml)) sheetXml = sheetXml.replace(/(<legacyDrawing|<tableParts)/, tag + '$1');
  else sheetXml = sheetXml.replace('</worksheet>', tag + '</worksheet>');
  // print setup: landscape, fit all charts to one page width
  if (!/<sheetPr/.test(sheetXml)) sheetXml = sheetXml.replace(/(<worksheet[^>]*>)/, '$1<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  // Schema order (CT_Worksheet): … pageMargins, pageSetup, … ignoredErrors, … drawing, legacyDrawing, tableParts.
  // Excel rejects out-of-order elements (LibreOffice does not), so place pageSetup explicitly.
  const setup = '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
  if (/<pageMargins[^>]*\/>/.test(sheetXml)) sheetXml = sheetXml.replace(/(<pageMargins[^>]*\/>)/, '$1' + setup);
  else if (sheetXml.includes('<ignoredErrors')) sheetXml = sheetXml.replace('<ignoredErrors', setup + '<ignoredErrors');
  else sheetXml = sheetXml.replace('<drawing ', setup + '<drawing ');
  zip.file(sheetPath, sheetXml);
  const relPath = `xl/worksheets/_rels/sheet${sheetIndex + 1}.xml.rels`;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const existing = zip.file(relPath) ? await zip.file(relPath)!.async('string') : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  zip.file(relPath, existing.replace('</Relationships>', `<Relationship Id="rIdDrawing1" Type="${REL}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`));
  zip.file('xl/drawings/drawing1.xml', drawingXml(charts));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${charts.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/chart" Target="../charts/chart${i + 1}.xml"/>`).join('')}</Relationships>`);
  charts.forEach((c, i) => zip.file(`xl/charts/chart${i + 1}.xml`, chartXml(c)));
  let ct = await zip.file('[Content_Types].xml')!.async('string');
  const add = `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` +
    charts.map((_, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('');
  ct = ct.replace('</Types>', add + '</Types>');
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
