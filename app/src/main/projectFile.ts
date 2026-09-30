import JSZip from "jszip";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const LSR_VERSION = 1;
/** .lsr = zip: project.json + pages/<pageId>.jpg */
export async function writeLsr(path: string, project: unknown, images: Record<string, Uint8Array>) {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify({ lsrVersion: LSR_VERSION, project }));
  for (const [id, data] of Object.entries(images)) zip.file(`pages/${id}.jpg`, data, { binary: true });
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 1 } });
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp"; writeFileSync(tmp, buf); renameSync(tmp, path);
}
export async function readLsr(path: string): Promise<{ project: unknown; images: Record<string, Uint8Array> }> {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const pj = zip.file("project.json"); if (!pj) throw new Error("This is not a Lighting Survey Reader project file.");
  const parsed = JSON.parse(await pj.async("string")) as { lsrVersion?: number; project?: unknown };
  if (parsed.lsrVersion !== LSR_VERSION) throw new Error("This project was made by a newer version of the app.");
  const images: Record<string, Uint8Array> = {};
  for (const name of Object.keys(zip.files)) {
    const m = name.match(/^pages\/(.+)\.jpg$/); if (m) images[m[1]] = await zip.files[name].async("uint8array");
  }
  return { project: parsed.project, images };
}
