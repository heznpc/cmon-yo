import { Ajv2020 } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { AnySchema, ValidateFunction } from 'ajv';
import { expect } from 'vitest';

type Document = {
  openapi: string;
  paths: Record<
    string,
    {
      get: {
        responses: Record<
          string,
          {
            content: { 'application/json': { schema: { $ref: string } } };
          }
        >;
      };
    }
  >;
  components: { schemas: Record<string, AnySchema> };
};

// Validate the response against the document downloaded over HTTP, independently
// of the TS client parser. Runtime-only date/order semantics have separate tests.
export function responseContract(document: unknown) {
  const spec = document as Document;
  expect(spec.openapi).toBe('3.1.1');
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validators = new Map<string, ValidateFunction>();
  return (path: string, status: number, body: unknown) => {
    const response = spec.paths[path]?.get.responses[String(status)];
    expect(response, `Undocumented GET ${path} ${status}`).toBeDefined();
    const ref = response.content['application/json'].schema.$ref;
    expect(ref).toMatch(/^#\/components\/schemas\/[^/]+$/);
    const name = ref.split('/').at(-1)!;
    if (!validators.has(name)) validators.set(name, ajv.compile(spec.components.schemas[name]));
    const validate = validators.get(name)!;
    return { valid: validate(body), errors: validate.errors };
  };
}
