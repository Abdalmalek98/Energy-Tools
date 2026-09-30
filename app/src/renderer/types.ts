import type { LicenseState } from "../main/licenseCore";
export interface LicStatus { state: LicenseState; contact: string; version: string; now: number }
export const daysLeft = (endsAt: number | null, now: number) => (endsAt == null ? null : Math.max(0, Math.ceil((endsAt - now) / 86400)));
export type View = "home" | "project" | "review" | "export" | "settings";
export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
