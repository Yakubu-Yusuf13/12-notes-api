import jwt from 'jsonwebtoken';
import { config } from '../config.js';

export function requireAuth(req, res, next) {
  const authorization = req.get('Authorization');
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);

  if (!match) {
    res.set('WWW-Authenticate', 'Bearer realm="api"');
    return res.status(401).json({ error: { message: 'Authentication required' } });
  }

  try {
    const payload = jwt.verify(match[1], config.JWT_SECRET, { algorithms: ['HS256'] });

    if (typeof payload === 'string' || typeof payload.sub !== 'string') {
      throw new Error('Invalid token subject');
    }

    req.user = { id: payload.sub };
    return next();
  } catch {
    res.set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"');
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}
