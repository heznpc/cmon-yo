import { z } from 'zod';
import { openapi } from './openapi';
import {
  meetingDetailSchema,
  meetingListSchema,
  meetingInputSchema,
  meetingCommandSchema,
  membershipSchema,
  myMeetingsSchema,
  meetingFiltersSchema,
} from '../contracts/meetings';
import { idSchema } from '../contracts/meetup';
const wire = (s: z.ZodType) => z.toJSONSchema(s, { io: 'input', target: 'draft-2020-12' });
const response = (schema: z.ZodType) => ({
  description: 'Validated response; private, no-store.',
  content: { 'application/json': { schema: wire(schema) } },
});
const security = [{ SessionCookie: [] }, { SecureSessionCookie: [] }, { NativeSession: [] }];
const errors = Object.fromEntries(
  [400, 401, 403, 404, 409, 429, 503].map((status) => [
    status,
    {
      description:
        'INVALID_INPUT / UNAUTHENTICATED / INVALID_ORIGIN / FORBIDDEN / NOT_FOUND / VERSION_CONFLICT / FULL / CLOSED / ACCOUNT_CHANGED / COMMAND_CONFLICT / UNAVAILABLE. No automatic mutation retry.',
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
    },
  ]),
);
const id = { name: 'id', in: 'path', required: true, schema: wire(idSchema) };
const commandHeaders = [
  {
    name: 'Idempotency-Key',
    in: 'header',
    required: true,
    schema: wire(idSchema),
    description:
      'New UUID per intent. Retry the identical body with the same key. Stored while the account exists; GET /me/commands/{id} checks committed results. A missing result does not prove non-execution.',
  },
  {
    name: 'X-Cmon-User',
    in: 'header',
    required: true,
    schema: wire(idSchema),
    description: 'Identity that owned the form; must equal the current session subject.',
  },
];
const body = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: wire(schema) } },
});
const filters = Object.entries(meetingFiltersSchema.shape).map(([name, schema]) => ({
  name,
  in: 'query',
  schema: wire(schema),
}));
const result = z.object({ id: idSchema });
export const meetingsOpenapi = {
  ...openapi,
  info: {
    ...openapi.info,
    version: '1.1.0',
    description:
      openapi.info.description +
      ' Meetups persist in PostgreSQL. Capacity includes the host. Changes require a current version and a future, open meeting. Account deletion cancels hosted meetings and removes participation; personal reads are separate from public details.',
  },
  components: {
    ...openapi.components,
    securitySchemes: {
      ...openapi.components.securitySchemes,
      NativeSession: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Signed, revocable Better Auth session. HTTPS outside loopback. Store only in Keychain; no cookie fallback.',
      },
    },
  },
  paths: {
    ...openapi.paths,
    '/api/v1/me': { get: { ...openapi.paths['/api/v1/me'].get, security } },
    '/api/native/auth/sign-in/email': {
      post: {
        operationId: 'nativeSignIn',
        requestBody: body(z.object({ email: z.email(), password: z.string().min(12).max(128) })),
        responses: { 200: response(z.object({ token: z.string() })), ...errors },
        description:
          'Cookie-, Origin-, and Sec-Fetch-Site-bearing requests rejected. Success returns only a signed session credential. Email must be verified.',
      },
    },
    ...Object.fromEntries(
      ['sign-up/email', 'sign-out', 'send-verification-email', 'request-password-reset'].map(
        (action) => [
          `/api/native/auth/${action}`,
          {
            post: {
              security: action === 'sign-out' ? [{ NativeSession: [] }] : [],
              description:
                'Same Better Auth email lifecycle. Native requests omit Cookie/Origin/Sec-Fetch-Site. Verification/reset links open the Web account page.',
              requestBody: body(
                action === 'sign-up/email'
                  ? z.object({
                      email: z.email(),
                      password: z.string().min(12).max(128),
                      name: z.string().min(1),
                      callbackURL: z.literal('/account'),
                    })
                  : action === 'sign-out'
                    ? z.object({})
                    : action === 'send-verification-email'
                      ? z.object({ email: z.email(), callbackURL: z.literal('/account') })
                      : z.object({
                          email: z.email(),
                          redirectTo: z.literal('/account?mode=reset'),
                        }),
              ),
              responses: { 200: response(z.object({ success: z.boolean() })), ...errors },
            },
          },
        ],
      ),
    ),
    '/api/v1/meetups': {
      get: {
        operationId: 'listMeetups',
        parameters: filters,
        responses: { 200: response(meetingListSchema), ...errors },
      },
      post: {
        operationId: 'createMeetup',
        security,
        parameters: commandHeaders,
        requestBody: body(meetingInputSchema),
        responses: { 200: response(result), ...errors },
      },
    },
    '/api/v1/meetups/{id}': {
      get: {
        operationId: 'getMeetup',
        parameters: [id],
        responses: { 200: response(meetingDetailSchema), ...errors },
      },
      patch: {
        operationId: 'changeMeetup',
        security,
        parameters: [id, ...commandHeaders],
        requestBody: body(meetingCommandSchema),
        responses: { 200: response(result), ...errors },
      },
    },
    '/api/v1/meetups/{id}/membership': {
      get: {
        operationId: 'getMembership',
        security,
        parameters: [id],
        responses: { 200: response(membershipSchema), ...errors },
      },
    },
    '/api/v1/me/meetups': {
      get: {
        operationId: 'myMeetups',
        security,
        parameters: filters.filter((p) => p.name === 'page'),
        responses: { 200: response(myMeetingsSchema), ...errors },
      },
    },
    '/api/v1/me/commands/{id}': {
      get: {
        operationId: 'commandResult',
        security,
        parameters: [id],
        responses: { 200: response(z.object({ id: idSchema.nullable() })), ...errors },
      },
    },
  },
};
