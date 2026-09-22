import { z } from 'zod';
import { walkingCommandSchema, walkingDashboardSchema } from '../contracts/walking';
import { commandResultSchema } from '../contracts/command';
const schema = (type: z.ZodType) => z.toJSONSchema(type, { io: 'input', target: 'draft-2020-12' });
const response = (type: z.ZodType) => ({ description: 'Authenticated private response.', content: { 'application/json': { schema: schema(type) } } });
const security = [{ SessionCookie: [] }, { SecureSessionCookie: [] }, { NativeSession: [] }];
const errors = Object.fromEntries([400,401,403,404,409,413,415,429,503].map((status) => [status, {
  description: 'Rejected or unknown command; inspect the original receipt before an explicit identical retry.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
}]));
const viewer = { name: 'X-Cmon-User', in: 'header', required: true, schema: schema(z.uuid()) };
export const walkingPaths = {
  '/api/v1/me/walking': { get: { security, parameters: [{ ...viewer, required: false }], responses: { 200: response(walkingDashboardSchema), ...errors } } },
  '/api/v1/me/walking-commands/{id}': { get: { security, parameters: [{ name: 'id', in: 'path', required: true, schema: schema(z.uuid()) }, { ...viewer, required: false }], responses: { 200: response(commandResultSchema), ...errors } } },
  '/api/v1/walking/commands': { post: {
    security,
    description: 'Verified account required. bindHealth/syncHealth require Native bearer without cookies. All intents require a persistent UUID and identical payload on retry. Native submission does not attest physical activity. Daily game credit is capped and nondecreasing; visible health readings may decrease. Badge points have no external exchange value.',
    parameters: [viewer, { name: 'Idempotency-Key', in: 'header', required: true, schema: schema(z.uuid()) }],
    requestBody: { required: true, content: { 'application/json': { schema: schema(walkingCommandSchema) } } },
    responses: { 200: response(commandResultSchema), ...errors },
  } },
};
