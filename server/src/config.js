import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// load .env from project root when running locally
dotenv.config();

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
  // Browser-mode airport reset: default CDP endpoint of a side-car browser
  // (the optional `browserless` service in docker-compose). Airports can
  // override this per-airport. Used only when an airport's reset_mode='browser'.
  browserCdpEndpoint: process.env.BROWSER_CDP_ENDPOINT || 'http://browserless:3000',
  // FlareSolverr endpoint for the 'flaresolverr' reset mode (solves Cloudflare
  // and returns cf_clearance). Airports can override per-airport.
  flaresolverrUrl: process.env.FLARESOLVERR_URL || 'http://flaresolverr:8191',
  // Optional captcha-solver placeholder (not wired yet — reserved interface).
  captchaProvider: process.env.CAPTCHA_PROVIDER || '',   // e.g. 'capsolver' | 'yescaptcha'
  captchaApiKey: process.env.CAPTCHA_API_KEY || '',
};

// resolve the public base url for a given request (fallback to Host header)
export function resolveBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
