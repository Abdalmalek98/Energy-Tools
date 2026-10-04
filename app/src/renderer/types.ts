import type { ClientStatus } from "@lsr/licensing";
export interface LicStatus extends ClientStatus { contact: string; supportUrl: string; version: string; now: number; personal?: boolean }
export type View = "home" | "project" | "review" | "export" | "settings";
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
/** IPC handlers answer { error } when something failed on disk/dialog: show it, never swallow it. */
export const isError = (x: unknown): x is { error: string } => !!x && typeof x === "object" && "error" in x && typeof (x as { error: unknown }).error === "string";
export const fmtDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");
export const fmtDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Never");
