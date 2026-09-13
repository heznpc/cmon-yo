import { z } from 'zod';
import { apiErrorSchema } from '../contracts/http';
import { idSchema, meetupDetailSchema } from '../contracts/meetup';
import { placeIdSchema, placeDetailSchema, placeListSchema } from '../contracts/place';

// Describe accepted wire values, before client normalization. In particular, an
// unknown sport and an omitted description must remain compatible with PR1.
function wireSchema(schema: z.ZodType) {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' });
  delete json.$schema;
  return json;
}
const response = (schema: string, description: string) => ({
  description,
  headers: {
    'Cache-Control': { schema: { type: 'string', const: 'private, no-store' } },
  },
  content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
});
const unavailable = response(
  'ApiError',
  'UNAVAILABLE: storage or service failure; not an empty result.',
);
const detailErrors = {
  '400': response('ApiError', 'INVALID_ID: malformed identifier; do not retry unchanged.'),
  '404': response('ApiError', 'NOT_FOUND: replace the previous detail with an absent state.'),
  '503': unavailable,
};

export const openapi = {
  openapi: '3.1.1',
  info: {
    title: "C'mon Yo! public read API",
    version: '1.0.0',
    description:
      'Current PR1/PR2 routes only. Public reads require no authentication. ' +
      'Clients ignore additional response fields and validate known fields at runtime. ' +
      'HTTP errors carry code, message, requestId and retryable; retryable does not trigger an automatic retry. ' +
      'SSR calls the same application services directly, without an HTTP self-call.',
  },
  servers: [{ url: '/' }],
  security: [],
  paths: {
    '/api/v1/meetups/{id}': {
      get: {
        operationId: 'getMeetup',
        summary: 'Read a public sample meetup (not a real recruitment).',
        parameters: [{ name: 'id', in: 'path', required: true, schema: wireSchema(idSchema) }],
        responses: {
          '200': response('MeetupDetail', 'Public fixture detail.'),
          ...detailErrors,
        },
      },
    },
    '/api/v1/places': {
      get: {
        operationId: 'listPlaces',
        summary: 'Read imported Muan parks; an empty list is a successful response.',
        responses: {
          '200': response('PlaceList', 'Imported public facilities.'),
          '503': unavailable,
        },
      },
    },
    '/api/v1/places/{id}': {
      get: {
        operationId: 'getPlace',
        summary: 'Read an imported park and its forecast availability.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: wireSchema(placeIdSchema) }],
        responses: {
          '200': response(
            'PlaceDetail',
            'Weather failure is a successful place response with weather.status stale or unavailable. ' +
              'issuedAt is the forecast issue time, validAt its target time, fetchedAt the collection time.',
          ),
          ...detailErrors,
        },
      },
    },
  },
  components: {
    schemas: {
      MeetupDetail: {
        ...wireSchema(meetupDetailSchema),
        description:
          'Dates must be real UTC instants and endsAt must be after startsAt. These semantic checks ' +
          'remain in runtime validators and the shared TS/Swift fixture matrix; JSON Schema alone ' +
          'does not enforce them. Clients normalize omitted description to null and unknown sport to unknown.',
      },
      PlaceList: wireSchema(placeListSchema),
      PlaceDetail: wireSchema(placeDetailSchema),
      ApiError: wireSchema(apiErrorSchema),
    },
  },
};
