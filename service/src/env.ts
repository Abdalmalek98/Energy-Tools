export interface Env {
  DB: D1Database;
  MODEL_BEST: string;
  MODEL_FAST: string;
  ANTHROPIC_BASE_URL: string;
  LEASE_PUBLIC_KEY: string;
  ANTHROPIC_API_KEY: string;
  LEASE_PRIVATE_KEY: string;
  ADMIN_PASSWORD_HASH: string;
  ADMIN_TOTP_SECRET: string;
  ADMIN_SESSION_SECRET: string;
  ADMIN_API_KEY_HASH: string;
}
