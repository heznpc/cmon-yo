import { z } from 'zod';
export const commandResultSchema = z.object({ id: z.uuid().nullable() });
