import type { FileInput, PageInput, RawRow } from "@lsr/shared";

export type Rotation = 0 | 90 | 180 | 270;
export type PageStatus = "new" | "queued" | "reading" | "done" | "error";
export interface PageState {
  id: string; n: number; rotation: Rotation; status: PageStatus; error?: string;
  header: PageInput["header"]; section_changes: PageInput["section_changes"]; copy_notes: PageInput["copy_notes"]; rows: RawRow[];
}
export interface FileState { id: string; name: string; building: string; pages: PageState[]; loading?: boolean }
export interface Project { name: string; hint: string; quality: "best" | "fast"; dateFormat: "DMY" | "MDY"; files: FileState[] }
export const emptyProject = (): Project => ({ name: "Untitled survey", hint: "", quality: "best", dateFormat: "DMY", files: [] });

let uid = Date.now();
export const nid = (p = "i") => `${p}${(uid++).toString(36)}`;

/** File name → building name: drop extension, underscores → spaces, tidy separators. */
export function cleanName(n: string): string {
  return n.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/\s*[-–]\s*(\s*[-–]\s*)*$/, "").replace(/\s+/g, " ").trim().toUpperCase();
}
export function toFileInputs(files: FileState[]): FileInput[] {
  return files.map((f) => ({
    id: f.id, name: f.name, building: f.building.trim().toUpperCase(),
    pages: f.pages.map((p) => ({ id: p.id, header: p.header, section_changes: p.section_changes, copy_notes: p.copy_notes, rows: p.rows, done: p.status === "done" })),
  }));
}
