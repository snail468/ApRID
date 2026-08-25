import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// load .env from project root when running locally
dotenv.config();

// App-wide timezone: everything (task logs, alerts, scheduler wall-clock, cron
// evaluation) runs in UTC+8 / Asia/Shanghai. config.js is imported before any Date
// is used, so this takes effect globally. Forced (not host-overridable) so the
// panel's times are consistent with the frontend, which always renders UTC+8.
process.env.TZ = 'Asia/Shanghai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  port: parseInt(process.env.PORT || '6601', 10),
  jwtSecret: process.env.JWT_SECRET || 'aprid_dev_secret_change_me',
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'aprid.db'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  trustedDeviceDays: parseInt(process.env.TRUSTED_DEVICE_DAYS || '60', 10),
  sessionHours: parseInt(process.env.SESSION_HOURS || '24', 10),
  publicDir: path.join(__dirname, '..', 'public'),
  isProd: process.env.NODE_ENV === 'production',
  // Optional captcha-solver placeholder (not wired yet — reserved interface).
  captchaProvider: process.env.CAPTCHA_PROVIDER || '',   // e.g. 'capsolver' | 'yescaptcha'
  captchaApiKey: process.env.CAPTCHA_API_KEY || '',
  // Real node-availability probe: dials each node *through* a sing-box core and
  // fetches a test URL, so it verifies the proxy actually works (not just that the
  // TCP port is open). Needs the sing-box binary; bundled in the Docker image.
  // Gracefully degrades — the probe endpoint reports when it's unavailable.
  singboxPath: process.env.SINGBOX_PATH || 'sing-box',
  probeTestUrl: process.env.PROBE_TEST_URL || 'http://cp.cloudflare.com/generate_204',
  probeTimeout: parseInt(process.env.PROBE_TIMEOUT || '8000', 10),
};

// resolve the public base url for a given request (fallback to Host header)
export function resolveBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
