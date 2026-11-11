import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import express from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../lib/validate.js';

const router = express.Router();
const passwordSchema = z.string()
  .min(10)
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');
const registerSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: passwordSchema,
});
const loginSchema = z.object({
  email: z.string().trim().email().transform((email) => email.toLowerCase()),
  password: z.string().min(1),
});
const invalidCredentials = { error: { message: 'Invalid email or password' } };

function validateLogin(req, res, next) {
  const result = loginSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(401).json(invalidCredentials);
  }

  req.body = result.data;
  return next();
}

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: { message: 'Too many authentication attempts. Please try again later.' },
  }),
}));

function createToken(userId) {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    created_at: user.created_at,
  };
}

router.post('/register', validate(registerSchema), async (req, res, next) => {
  const { name, email, password } = req.body;

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const [user] = await sql`
      INSERT INTO users (name, email, password_hash)
      VALUES (${name}, ${email}, ${passwordHash})
      RETURNING id, name, email, created_at
    `;

    return res.status(201).json({
      user: publicUser(user),
      token: createToken(user.id),
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: { message: 'An account with this email already exists' },
      });
    }

    return next(error);
  }
});

router.post('/login', validateLogin, async (req, res, next) => {
  const { email, password } = req.body;

  try {
    const [user] = await sql`
      SELECT id, name, email, password_hash, created_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json(invalidCredentials);
    }

    return res.json({
      token: createToken(user.id),
      user: publicUser(user),
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [user] = await sql`
      SELECT id, name, email, created_at
      FROM users
      WHERE id = ${req.user.id}
      LIMIT 1
    `;

    if (!user) {
      res.set('WWW-Authenticate', 'Bearer realm="api", error="invalid_token"');
      return res.status(401).json({ error: { message: 'Invalid or expired token' } });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

export default router;
