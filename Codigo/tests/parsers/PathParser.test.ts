import { describe, expect, it, vi } from 'vitest';
import type { SchemaParser } from '../../src/services/parsers/SchemaParser';
import { SchemaParser as RealSchemaParser } from '../../src/services/parsers/SchemaParser';
import { PathParser } from '../../src/services/parsers/PathParser';

function createParser() {
  return new PathParser(new RealSchemaParser());
}

describe('PathParser', () => {
  describe('method handling', () => {
    it('produces one Operation per supported method', () => {
      const ops = createParser().parsePaths({
        '/users': {
          get: { responses: {} },
          post: { responses: {} },
          put: { responses: {} },
          patch: { responses: {} },
          delete: { responses: {} },
        },
      });

      expect(ops.map((o) => o.method)).toEqual(['get', 'post', 'put', 'patch', 'delete']);
    });

    it('silently drops head/options/trace (no throw, no warning)', () => {
      const ops = createParser().parsePaths({
        '/users': {
          get: { responses: {} },
          head: { responses: {} },
          options: { responses: {} },
          trace: { responses: {} },
        },
      });

      expect(ops).toHaveLength(1);
      expect(ops[0].method).toBe('get');
    });

    it('skips non-object path items and non-object operation values', () => {
      const ops = createParser().parsePaths({
        '/a': 'nope',
        '/b': [1, 2],
        '/c': { get: 'nope', post: { responses: {} } },
      });

      expect(ops).toHaveLength(1);
      expect(ops[0].path).toBe('/c');
      expect(ops[0].method).toBe('post');
    });

    it('returns [] for empty paths', () => {
      expect(createParser().parsePaths({})).toEqual([]);
    });
  });

  describe('operation metadata', () => {
    it('maps scalar metadata only when correctly typed', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            operationId: 'listX',
            summary: 'S',
            description: 'D',
            tags: ['a', 'b'],
            responses: {},
          },
        },
      });

      expect(op.operationId).toBe('listX');
      expect(op.summary).toBe('S');
      expect(op.description).toBe('D');
      expect(op.tags).toEqual(['a', 'b']);
      expect(op.functionName).toBe('');
    });

    it('drops wrongly-typed metadata to undefined', () => {
      const [op] = createParser().parsePaths({
        '/x': { get: { operationId: 1, summary: {}, description: [], responses: {} } },
      });

      expect(op.operationId).toBeUndefined();
      expect(op.summary).toBeUndefined();
      expect(op.description).toBeUndefined();
    });

    it('asStringArray filters non-strings and collapses empty to undefined', () => {
      const [mixed] = createParser().parsePaths({
        '/x': { get: { tags: ['a', 1, 'b', null], responses: {} } },
      });
      expect(mixed.tags).toEqual(['a', 'b']);

      const [empty] = createParser().parsePaths({
        '/y': { get: { tags: [1, 2], responses: {} } },
      });
      expect(empty.tags).toBeUndefined();

      const [nonArray] = createParser().parsePaths({
        '/z': { get: { tags: 'a', responses: {} } },
      });
      expect(nonArray.tags).toBeUndefined();
    });
  });

  describe('parameter merging', () => {
    it('merges path-level params into every operation', () => {
      const ops = createParser().parsePaths({
        '/users/{id}': {
          parameters: [{ name: 'id', in: 'path' }],
          get: { responses: {} },
          delete: { responses: {} },
        },
      });

      for (const op of ops) {
        expect(op.parameters).toEqual([
          { name: 'id', in: 'path', required: true, schema: undefined, ref: undefined },
        ]);
      }
    });

    it('operation-level param overrides same in:name key', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          parameters: [{ name: 'q', in: 'query', required: false }],
          get: {
            parameters: [{ name: 'q', in: 'query', required: true }],
            responses: {},
          },
        },
      });

      expect(op.parameters).toHaveLength(1);
      expect(op.parameters[0].required).toBe(true);
    });

    it('keeps distinct-location params with the same name', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            parameters: [
              { name: 'id', in: 'path' },
              { name: 'id', in: 'query' },
            ],
            responses: {},
          },
        },
      });

      expect(op.parameters).toHaveLength(2);
      expect(op.parameters.map((p) => p.in)).toEqual(['path', 'query']);
    });

    it('defaults required by location and honors explicit boolean', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            parameters: [
              { name: 'a', in: 'path' }, // path -> true
              { name: 'b', in: 'query' }, // else -> false
              { name: 'c', in: 'query', required: 'nope' }, // non-boolean -> false
              { name: 'd', in: 'path', required: false }, // explicit false preserved
            ],
            responses: {},
          },
        },
      });

      const byName = Object.fromEntries(op.parameters.map((p) => [p.name, p.required]));
      expect(byName).toEqual({ a: true, b: false, c: false, d: false });
    });

    it('skips invalid params (missing/invalid name or location)', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            parameters: [
              { name: 'ok', in: 'query' },
              { in: 'query' }, // no name
              { name: 'x' }, // no location
              { name: 'y', in: 'body' }, // invalid location
              'not-an-object',
            ],
            responses: {},
          },
        },
      });

      expect(op.parameters).toHaveLength(1);
      expect(op.parameters[0].name).toBe('ok');
    });

    it('resolves $ref param to last path segment, defaults to query/optional', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            parameters: [{ $ref: '#/components/parameters/PageParam' }],
            responses: {},
          },
        },
      });

      expect(op.parameters[0]).toEqual({
        name: 'PageParam',
        in: 'query',
        required: false,
        ref: '#/components/parameters/PageParam',
      });
    });

    it('$ref of empty string falls back to refParameter name', () => {
      const [op] = createParser().parsePaths({
        '/x': { get: { parameters: [{ $ref: '' }], responses: {} } },
      });

      // ''.split('/').pop() === '' is falsy, so the `|| 'refParameter'`
      // fallback applies instead of leaving an empty name.
      expect(op.parameters[0].name).toBe('refParameter');
    });

    it('delegates param schema with `${name}ParamSchema` fallback name', () => {
      const schemaParser = { parseRefOrInline: vi.fn().mockReturnValue({ schema: { name: 's' } }) };
      const parser = new PathParser(schemaParser as unknown as SchemaParser);

      parser.parsePaths({
        '/x': {
          get: { parameters: [{ name: 'id', in: 'path', schema: { type: 'string' } }], responses: {} },
        },
      });

      expect(schemaParser.parseRefOrInline).toHaveBeenCalledWith({ type: 'string' }, 'idParamSchema');
    });
  });

  describe('request body', () => {
    it('sanitizes media type into the fallback name', () => {
      const schemaParser = new RealSchemaParser();
      const spy = vi.spyOn(schemaParser, 'parseRefOrInline');
      const parser = new PathParser(schemaParser);

      parser.parsePaths({
        '/x': {
          post: {
            requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
            responses: {},
          },
        },
      });

      expect(spy).toHaveBeenCalledWith({ type: 'object' }, 'applicationjsonRequestBody');
    });

    it('keeps required flag only when boolean', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            responses: {},
          },
        },
      });

      expect(op.requestBody?.required).toBe(true);
    });

    it('collapses empty-content request body to undefined (asymmetry vs responses)', () => {
      const [emptyContent] = createParser().parsePaths({
        '/x': { post: { requestBody: { content: {} }, responses: {} } },
      });
      expect(emptyContent.requestBody).toBeUndefined();

      const [noContent] = createParser().parsePaths({
        '/y': { post: { requestBody: {}, responses: {} } },
      });
      expect(noContent.requestBody).toBeUndefined();
    });
  });

  describe('responses', () => {
    it('keeps status codes as string keys with empty content object when absent', () => {
      const [op] = createParser().parsePaths({
        '/x': {
          get: {
            responses: {
              '200': { description: 'ok', content: { 'application/json': { schema: { type: 'object' } } } },
              '204': { description: 'no content' },
            },
          },
        },
      });

      expect(op.responses.map((r) => r.statusCode)).toEqual(['200', '204']);
      expect(op.responses[0].content['application/json']).toEqual({ schema: { name: '200applicationjsonResponse', type: 'object' } });
      // empty-content response stays {} (asymmetry vs requestBody)
      expect(op.responses[1].content).toEqual({});
    });

    it('returns [] when responses is not an object', () => {
      const [op] = createParser().parsePaths({
        '/x': { get: { responses: 'nope' } },
      });
      expect(op.responses).toEqual([]);
    });
  });
});
