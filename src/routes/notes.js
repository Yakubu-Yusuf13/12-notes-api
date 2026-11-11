import { Router } from 'express';
import { z } from 'zod';
import { sql } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../lib/validate.js';

const router = Router();
const noteIdSchema = z.object({ id: z.uuid() });
const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().default(''),
  tags: z.array(z.string().trim().min(1)).default([]),
  pinned: z.boolean().default(false),
});
const updateNoteSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  body: z.string().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  pinned: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field must be provided',
});
const listNotesSchema = z.object({
  q: z.string().trim().min(1).optional(),
  tag: z.string().trim().min(1).optional(),
  pinned: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
  page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1_000_000)).default('1'),
  limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(100)).default('20'),
});

router.use(requireAuth);

router.get('/', validate(listNotesSchema, 'query'), async (req, res, next) => {
  const { q, tag, pinned, page, limit } = req.validated.query;
  const filters = [sql`user_id = ${req.user.id}`];

  if (q !== undefined) {
    filters.push(sql`(title ILIKE ${`%${q}%`} OR body ILIKE ${`%${q}%`})`);
  }
  if (tag !== undefined) {
    filters.push(sql`${tag} = ANY(tags)`);
  }
  if (pinned !== undefined) {
    filters.push(sql`pinned = ${pinned}`);
  }

  const where = filters.reduce((conditions, filter) => sql`${conditions} AND ${filter}`);
  const offset = (page - 1) * limit;

  try {
    const [notes, [{ total }]] = await Promise.all([
      sql`
        SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
        FROM notes
        WHERE ${where}
        ORDER BY pinned DESC, updated_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT count(*)::int AS total FROM notes WHERE ${where}`,
    ]);

    return res.json({
      notes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', validate(noteIdSchema, 'params'), async (req, res, next) => {
  try {
    const [note] = await sql`
      SELECT id, user_id, title, body, tags, pinned, created_at, updated_at
      FROM notes
      WHERE id = ${req.validated.params.id}
        AND user_id = ${req.user.id}
      LIMIT 1
    `;

    if (!note) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

router.post('/', validate(createNoteSchema), async (req, res, next) => {
  const { title, body, tags, pinned } = req.body;

  try {
    const [note] = await sql`
      INSERT INTO notes (user_id, title, body, tags, pinned)
      VALUES (${req.user.id}, ${title}, ${body}, ${tags}, ${pinned})
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    return res.status(201).json({ note });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id', validate(noteIdSchema, 'params'), validate(updateNoteSchema), async (req, res, next) => {
  const { title, body, tags, pinned } = req.body;

  try {
    const [note] = await sql`
      UPDATE notes
      SET title = COALESCE(${title ?? null}, title),
          body = COALESCE(${body ?? null}, body),
          tags = COALESCE(${tags ?? null}, tags),
          pinned = COALESCE(${pinned ?? null}, pinned),
          updated_at = now()
      WHERE id = ${req.validated.params.id}
        AND user_id = ${req.user.id}
      RETURNING id, user_id, title, body, tags, pinned, created_at, updated_at
    `;

    if (!note) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    return res.json({ note });
  } catch (error) {
    return next(error);
  }
});

router.delete('/:id', validate(noteIdSchema, 'params'), async (req, res, next) => {
  try {
    const [note] = await sql`
      DELETE FROM notes
      WHERE id = ${req.validated.params.id}
        AND user_id = ${req.user.id}
      RETURNING id
    `;

    if (!note) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
});

export default router;
