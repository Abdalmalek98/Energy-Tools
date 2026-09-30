import type { AppInfo, LicenseStatus } from './types';
import { LicenseCommandError } from './types';
import { APP_VERSION, PRODUCT_NAME } from '../settings/defaults';

/**
 * Bridge to the Rust licensing core. All verification, storage and networking happens in Rust; the
 * frontend only displays the result. In a plain browser (development only) a stand-in is used when
 * VITE_CPA_DEV_LICENSE=1 – production builds never include the stand-in.
 */
const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    return await invoke<T>(cmd, args);
  } catch (e: any) {
    if (e && typeof e === 'object' && 'message' in e) throw new LicenseCommandError(e.code ?? 'error', e.message);
    throw new LicenseCommandError('error', String(e));
  }
}

const DEV_STUB = import.meta.env.DEV && import.meta.env.VITE_CPA_DEV_LICENSE === '1';

function stubStatus(overrides: Partial<LicenseStatus> = {}): LicenseStatus {
  return {
    state: 'active', allowed: true, message: 'License is valid. (browser development stand-in)', licenseId: 'CPA-DEV-000000', customer: 'Development', company: 'Local',
    product: PRODUCT_NAME, activatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 864e5).toISOString(), perpetual: false, daysRemaining: 90,
    machineStatus: 'notBound', machineId: 'MID1.dev', lastValidation: new Date().toISOString(), nextValidationDue: new Date(Date.now() + 7 * 864e5).toISOString(),
    graceEndsAt: new Date(Date.now() + 21 * 864e5).toISOString(), features: { bmsAnalysis: true, flukeAnalysis: true, excelExport: true, plantAnalysis: true, advancedRegression: true },
    maxActivations: 1, activations: 1, keyId: 'dev-1', offlineNote: null, offlineLicense: false, ...overrides,
  };
}

const unavailable = () => new LicenseCommandError('no_native', 'Licensing requires the Chiller Plant Analyzer desktop application.');

export const licensing = {
  async appInfo(): Promise<AppInfo> {
    if (inTauri()) return call<AppInfo>('app_info');
    return { version: APP_VERSION, product: PRODUCT_NAME, os: 'browser', arch: '-', debug: true };
  },
  async status(): Promise<LicenseStatus> {
    if (inTauri()) return call('license_status');
    if (DEV_STUB) return stubStatus();
    return { ...stubStatus({ state: 'unlicensed', allowed: false, message: unavailable().message, licenseId: null, customer: null, company: null, expiresAt: null, daysRemaining: null, features: {} }) };
  },
  async activate(code: string): Promise<LicenseStatus> {
    if (inTauri()) return call('license_activate', { code });
    if (DEV_STUB) return stubStatus();
    throw unavailable();
  },
  async check(): Promise<LicenseStatus> {
    if (inTauri()) return call('license_check');
    if (DEV_STUB) return stubStatus();
    throw unavailable();
  },
  async deactivate(forceLocal = false): Promise<LicenseStatus> {
    if (inTauri()) return call('license_deactivate', { forceLocal });
    if (DEV_STUB) return stubStatus({ state: 'unlicensed', allowed: false, licenseId: null });
    throw unavailable();
  },
  /** Throws when the license does not allow `feature` (used before export / logger import). */
  async require(feature: string): Promise<void> {
    if (inTauri()) return call('license_require', { feature });
    if (!DEV_STUB) throw unavailable();
  },
};
