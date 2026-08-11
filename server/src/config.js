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
};

// resolve the public base url for a given request (fallback to Host header)
export function resolveBaseUrl(req) {
  if (config.publicBaseUrl) return config.publicBaseUrl;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}
