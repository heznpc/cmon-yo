import { z } from 'zod';

// Public HTTP errors. Unknown codes remain readable by older clients.
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string(),
    requestId: z.string().min(1),
    retryable: z.boolean(),
  }),
});
