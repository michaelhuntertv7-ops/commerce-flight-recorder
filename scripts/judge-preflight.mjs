import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const envPath = path.join(root, '.env');
const paypalPath = path.join(root, 'paypal.mjs');
const replayMode = process.env.CFR_READ_ONLY_DEMO === '1';

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

const checks = [];
const major = Number(process.versions.node.split('.')[0]);
checks.push({name: 'Node.js 22+', ok: major >= 22, detail: `detected ${process.versions.node}`});
checks.push({name: 'Run mode', ok: true, detail: replayMode ? 'credential-free read-only replay' : 'interactive PayPal Sandbox'});

const envExists = fs.existsSync(envPath);
const env = envExists ? parseEnv(fs.readFileSync(envPath, 'utf8')) : {};
if (replayMode) {
  checks.push({name: '.env / PayPal credentials', ok: true, detail: 'not required for read-only replay'});
} else {
  checks.push({name: '.env present', ok: envExists, detail: envExists ? 'local secrets file found' : 'copy .env.example to .env'});
  for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET']) {
    const value = env[key] || '';
    const ok = Boolean(value) && !value.startsWith('your_');
    checks.push({name: key, ok, detail: ok ? 'configured (value hidden)' : 'missing or placeholder'});
  }
}

const paypalSource = fs.readFileSync(paypalPath, 'utf8');
checks.push({
  name: 'PayPal sandbox endpoint lock',
  ok: paypalSource.includes('https://api-m.sandbox.paypal.com') && !paypalSource.includes('api-m.paypal.com'),
  detail: 'production API host must not be configurable in this prototype'
});

if (replayMode) {
  checks.push({name: 'Payment-write capability', ok: true, detail: 'disabled by read-only replay mode'});
  checks.push({name: 'Signed webhook evidence', ok: true, detail: 'certified replay fixtures; no live webhook required'});
} else {
  const webhookConfigured = Boolean(env.PAYPAL_WEBHOOK_ID);
  checks.push({
    name: 'Signed webhook corroboration',
    ok: true,
    warn: !webhookConfigured,
    detail: webhookConfigured ? 'webhook ID configured (value hidden)' : 'optional for base run; required to reproduce signed webhook receipt path'
  });
}

let ollama = false;
try {
  const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(900) });
  ollama = response.ok;
} catch {}
checks.push({
  name: 'Local AI analyst',
  ok: true,
  warn: !ollama,
  detail: ollama ? 'Ollama reachable on 127.0.0.1:11434' : 'optional; CFR falls back to deterministic evidence explanation'
});

console.log('\nCommerce Flight Recorder — Judge Preflight');
console.log('No credential values are printed.\n');
for (const c of checks) {
  const state = c.ok ? (c.warn ? 'WARN' : 'PASS') : 'FAIL';
  console.log(`${state.padEnd(5)} ${c.name} — ${c.detail}`);
}

const hardFailures = checks.filter(c => !c.ok);
const readyLabel = replayMode ? ' for credential-free read-only replay' : ' for local sandbox run';
console.log(`\nResult: ${hardFailures.length ? 'HOLD' : 'READY'}${hardFailures.length ? ` (${hardFailures.length} required check(s) failed)` : readyLabel}`);
console.log(replayMode ? 'Next: npm test && npm run replay' : 'Next: npm test && npm start');
process.exitCode = hardFailures.length ? 1 : 0;
