import { z } from 'zod';
import { batchSchema } from '@souls/world-compiler';
import { buildFieldSchema } from './builds.ts';

export const revisionSchema = z.object({ id: z.string().min(1).max(100), v: z.number().int().min(1) });
export const expectationsSchema = z.record(z.string().min(1).max(300), revisionSchema);
export type Expectations = z.infer<typeof expectationsSchema>;
/** A preview supplies its sealed operations; explicit ops, when also supplied, must match them. */
export const submissionSchema = batchSchema.extend({
  ops: batchSchema.shape.ops.optional(),
  preview: z.string().min(1).max(100).optional(),
  expect: expectationsSchema.optional(),
  expectWorldAbout: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  build: buildFieldSchema.optional(),
}).refine(b => b.ops !== undefined || b.preview !== undefined, { path: ['ops'], message: 'Supply ops or a preview id.' });
