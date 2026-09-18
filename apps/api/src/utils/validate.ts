/** Parse with Zod, converting failures to safe 400 AppErrors. */
import type { z } from 'zod';
import { AppError } from './errors.js';

export function parseOr400<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new AppError('VALIDATION_ERROR', 'Invalid request.', 400, r.error.flatten());
  }
  return r.data;
}
