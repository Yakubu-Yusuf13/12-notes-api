import { Router } from 'express';
import { sql } from '../db.js';

const router = Router();

router.get('/health', async (req, res, next) => {
  try {
    await sql`SELECT 1`;
    return res.json({ status: 'ok', db: 'ok' });
  } catch (error) {
    return next(Object.assign(new Error('Database health check failed', { cause: error }), { status: 503 }));
  }
});

export default router;
