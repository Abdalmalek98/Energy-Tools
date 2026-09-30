export type LicenseStateName =
  | 'unlicensed' | 'active' | 'warning' | 'expired' | 'revoked' | 'suspended'
  | 'notYetValid' | 'validationOverdue' | 'wrongMachine' | 'deactivated' | 'invalid';

/** Mirrors `licensing_core::model::LicenseStatus` (camelCase). */
export interface LicenseStatus {
  state: LicenseStateName;
  allowed: boolean;
  message: string;
  licenseId: string | null;
  customer: string | null;
  company: string | null;
  product: string | null;
  activatedAt: string | null;
  expiresAt: string | null;
  perpetual: boolean;
  daysRemaining: number | null;
  machineStatus: 'notBound' | 'bound' | 'mismatch' | 'unknown';
  machineId: string;
  lastValidation: string | null;
  nextValidationDue: string | null;
  graceEndsAt: string | null;
  features: Record<string, boolean>;
  maxActivations: number | null;
  activations: number | null;
  keyId: string | null;
  offlineNote: string | null;
}

export interface AppInfo { version: string; product: string; os: string; arch: string; debug: boolean; }
export class LicenseCommandError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
