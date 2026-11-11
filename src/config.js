import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
      message: 'must be a PostgreSQL connection URL',
    }),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  const issues = result.error.issues
    .map(({ path, message }) => `- ${path.join('.')}: ${message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${issues}\nSet these values in your .env file.`);
}

export const config = result.data;
