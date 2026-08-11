import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function signSession(payload) {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

// require a valid admin session (cookie `aprid_session` or Bearer token)
export function requireAuth(req, res, next) {
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const token = req.cookies?.aprid_session || bearer;
  const claims = token && verifyToken(token);
  if (!claims || claims.scope !== 'admin') {
    return res.status(401).json({ error: '未登录或会话已过期' });
  }
  req.admin = claims;
  next();
}

export function setSessionCookie(res, token) {
  res.cookie('aprid_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // set true behind HTTPS terminator if desired
    maxAge: config.sessionHours * 3600 * 1000,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('aprid_session', { path: '/' });
}
