#!/usr/bin/env node
// cpa-admin – command line access to the same admin API.  CPA_SERVER_URL and CPA_ADMIN_TOKEN come from the environment.
import { AdminApi } from './api.js';
const [cmd, id, ...rest] = process.argv.slice(2);
const api = new AdminApi(process.env.CPA_SERVER_URL || 'https://licensing.abdalmalek.com', process.env.CPA_ADMIN_TOKEN || '');
const opt = (n) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : undefined; };
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const usage = `cpa-admin list | show <id> | token <id> | create --customer X [--company X --email X --days N|--expires ISO|--perpetual --max N --binding none|first|specific --machine MID1.… --notes …]
          revoke|suspend|reinstate|reset-activations <id> | renew <id> (--days N|--expires ISO|--perpetual) | extend <id> --days N | replace <id> | authorize <id> [--machine MID1.…] | audit [id]`;
try {
  switch (cmd) {
    case 'list': out((await api.list()).licenses.map((l) => `${l.licenseId}  ${l.effectiveStatus.padEnd(9)} ${String(l.remainingDays ?? '∞').padStart(5)}d  ${l.currentActivations}/${l.maxActivations}  ${l.customer}`).join('\n')); break;
    case 'show': out(await api.get(id)); break;
    case 'token': out((await api.token_(id)).token); break;
    case 'create': {
      const r = await api.create({ customerName: opt('customer'), companyName: opt('company'), email: opt('email'), notes: opt('notes'), durationDays: rest.includes('--perpetual') || opt('expires') ? undefined : Number(opt('days') ?? 365), expiresAt: opt('expires'), maxActivations: Number(opt('max') ?? 1), machineBinding: rest.includes('--offline') ? 'specific' : opt('binding') ?? 'none', machineId: opt('machine'), offline: rest.includes('--offline'), allowUnboundOffline: rest.includes('--allow-unbound-offline') });
      out(r.license); out('\nACTIVATION CODE:\n' + r.token); break;
    }
    case 'revoke': case 'suspend': case 'reinstate': case 'reset-activations': out(await api.action(id, cmd)); break;
    case 'renew': out(await api.action(id, 'renew', { days: Number(opt('days')) || undefined, expiresAt: opt('expires'), perpetual: rest.includes('--perpetual') })); break;
    case 'extend': out(await api.action(id, 'extend', { days: Number(opt('days')) })); break;
    case 'replace': { const r = await api.action(id, 'replacement'); out(r.license); out('\nACTIVATION CODE:\n' + r.token); break; }
    case 'authorize': out(await api.action(id, 'authorize-replacement', { machine: opt('machine') ? JSON.parse(Buffer.from(opt('machine').slice(5), 'base64url').toString()) : null })); break;
    case 'audit': out(await api.audit(id)); break;
    default: console.log(usage); process.exit(cmd ? 2 : 0);
  }
} catch (e) { console.error('Error:', e.message); process.exit(1); }
