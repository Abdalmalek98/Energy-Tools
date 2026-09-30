import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { Rotation } from "./model";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export const SOURCE_MAX = 2600;      // stored page image, long side
export const MODEL_MAX = 2400;       // sent to the model, long side
export const MAX_IMAGE_BYTES = 3.8 * 1024 * 1024;

const toJpeg = (c: HTMLCanvasElement | OffscreenCanvas, q: number): Promise<Blob> =>
  c instanceof HTMLCanvasElement ? new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error("toBlob failed"))), "image/jpeg", q)) : (c as OffscreenCanvas).convertToBlob({ type: "image/jpeg", quality: q });

/** Renders each PDF page to a JPEG (long side ≤ SOURCE_MAX). Scans are one photo per page, so this is fast. */
export async function* renderPdf(data: ArrayBuffer): AsyncGenerator<Blob> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const v0 = pg.getViewport({ scale: 1 });
      const vp = pg.getViewport({ scale: SOURCE_MAX / Math.max(v0.width, v0.height) });
      const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await pg.render({ canvasContext: ctx, viewport: vp }).promise;
      const b = await toJpeg(c, 0.9); c.width = c.height = 0; pg.cleanup();
      yield b;
    }
  } finally { await doc.destroy(); }
}

export async function imageToPage(data: ArrayBuffer, type: string): Promise<Blob> {
  const bmp = await createImageBitmap(new Blob([data], { type }));
  const sc = Math.min(1, SOURCE_MAX / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  const b = await toJpeg(c, 0.9); c.width = c.height = 0; return b;
}

/** Scans are usually portrait photos of a landscape form → rotate 90° counter-clockwise (= 270° clockwise). */
export async function autoRotation(blob: Blob): Promise<Rotation> {
  const bmp = await createImageBitmap(blob); const r: Rotation = bmp.height > bmp.width ? 270 : 0; bmp.close(); return r;
}

/** Page upright (rotation clockwise degrees) scaled so the long side ≤ maxSide. */
export async function rotatedCanvas(blob: Blob, rotation: Rotation, maxSide: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const sideways = rotation % 180 !== 0;
  const c = document.createElement("canvas"); c.width = sideways ? h : w; c.height = sideways ? w : h;
  const x = c.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  x.translate(c.width / 2, c.height / 2); x.rotate((rotation * Math.PI) / 180); x.drawImage(bmp, -w / 2, -h / 2, w, h); bmp.close();
  return c;
}
export async function thumbUrl(blob: Blob, rotation: Rotation): Promise<string> {
  const c = await rotatedCanvas(blob, rotation, 320); const u = c.toDataURL("image/jpeg", 0.7); c.width = c.height = 0; return u;
}
export async function viewBlob(blob: Blob, rotation: Rotation): Promise<Blob> {
  const c = await rotatedCanvas(blob, rotation, 2000); const b = await toJpeg(c, 0.85); c.width = c.height = 0; return b;
}

/** Whole page + top 56 % + bottom 56 % (they overlap) as JPEG bytes, each under ~4 MB. */
export async function modelImages(blob: Blob, rotation: Rotation): Promise<ArrayBuffer[]> {
  const c = await rotatedCanvas(blob, rotation, MODEL_MAX);
  const out: ArrayBuffer[] = [];
  const enc = async (cv: HTMLCanvasElement) => { for (const q of [0.9, 0.8, 0.7, 0.55]) { const b = await toJpeg(cv, q); if (b.size <= MAX_IMAGE_BYTES) return b.arrayBuffer(); } return (await toJpeg(cv, 0.4)).arrayBuffer(); };
  out.push(await enc(c));
  for (const [y0, y1] of [[0, 0.56], [0.44, 1]] as const) {
    const k = document.createElement("canvas"); k.width = c.width; k.height = Math.round(c.height * (y1 - y0));
    k.getContext("2d")!.drawImage(c, 0, Math.round(c.height * y0), c.width, k.height, 0, 0, k.width, k.height);
    out.push(await enc(k)); k.width = k.height = 0;
  }
  c.width = c.height = 0;
  return out;
}
