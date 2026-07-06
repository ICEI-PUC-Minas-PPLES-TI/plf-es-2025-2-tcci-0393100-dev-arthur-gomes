import { describe, expect, it } from 'vitest';
import type { Operation } from '../../src/models/operation';
import type { Schema } from '../../src/models/schema';
import { TypeGenerator } from '../../src/services/generators/TypeGenerator';

const gen = new TypeGenerator();

function typesFor(schemas: Record<string, Schema>, operations: Operation[] = []): string {
  return gen.createTypes(schemas, operations);
}

function op(overrides: Partial<Operation>): Operation {
  return {
    functionName: 'doThing',
    method: 'get',
    path: '/x',
    parameters: [],
    responses: [],
    ...overrides,
  };
}

describe('TypeGenerator schema declarations', () => {
  it('emits an interface for object schemas and a type alias otherwise', () => {
    const out = typesFor({
      Obj: { name: 'Obj', type: 'object', properties: { a: { schema: { name: 'a', type: 'string' } } } },
      Str: { name: 'Str', type: 'string' },
    });
    expect(out).toContain('export interface Obj ');
    expect(out).toContain('export type Str = string;');
  });

  it('falls back to an index signature for an empty object literal', () => {
    const out = typesFor({ Empty: { name: 'Empty', type: 'object' } });
    expect(out).toContain('export interface Empty { [key: string]: unknown; }');
  });

  it('renders array-of-ref as (Ref)[]', () => {
    const out = typesFor({
      Tags: { name: 'Tags', type: 'array', items: { ref: '#/components/schemas/Tag' } },
    });
    expect(out).toContain('export type Tags = (Tag)[];');
  });

  it('wraps nullable base types as (base) | null', () => {
    const out = typesFor({ N: { name: 'N', type: 'string', nullable: true } });
    expect(out).toContain('export type N = (string) | null;');
  });

  it('quotes property keys that are not valid identifiers', () => {
    const out = typesFor({
      H: {
        name: 'H',
        type: 'object',
        properties: { 'X-Request-Id': { schema: { name: 'X-Request-Id', type: 'string' } } },
      },
    });
    expect(out).toContain("'X-Request-Id'?: string;");
  });

  it('renders enum unions from JSON-stringified values', () => {
    const out = typesFor({ S: { name: 'S', enum: ['A', 'B'] } });
    expect(out).toContain('export type S = "A" | "B";');
  });
});

describe('TypeGenerator operation types', () => {
  it('emits void for a 204 response before any content lookup', () => {
    const out = typesFor({}, [op({ functionName: 'rm', method: 'delete', responses: [{ statusCode: '204', content: {} }] })]);
    expect(out).toContain('export type RmResponse204 = void;');
  });

  it('emits unknown for a primary response lacking json content', () => {
    const out = typesFor({}, [op({ responses: [{ statusCode: '200', content: {} }] })]);
    expect(out).toContain('export type DoThingResponse200 = unknown;');
  });

  it('marks body optional when requestBody is not required', () => {
    const out = typesFor({}, [
      op({
        functionName: 'make',
        method: 'post',
        requestBody: {
          required: false,
          content: { 'application/json': { schema: { name: 'B', type: 'object' } } },
        },
        responses: [{ statusCode: '200', content: {} }],
      }),
    ]);
    expect(out).toContain('body?: MakeRequestBody;');
  });

  it('always includes an optional headers field on the args interface', () => {
    const out = typesFor({}, [op({ responses: [{ statusCode: '200', content: {} }] })]);
    expect(out).toContain('headers?: Record<string, string>;');
  });
});
