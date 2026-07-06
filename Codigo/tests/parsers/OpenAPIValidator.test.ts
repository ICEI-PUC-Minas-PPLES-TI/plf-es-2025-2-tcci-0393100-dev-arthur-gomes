import { describe, expect, it } from 'vitest';
import { OpenAPIValidator } from '../../src/services/parsers/OpenAPIValidator';

const validate = (doc: unknown) => new OpenAPIValidator().validate(doc);

const minimalPaths = { '/x': { get: { responses: {} } } };

describe('OpenAPIValidator', () => {
  it('rejects non-object documents (including arrays) with a single exact error', () => {
    for (const doc of [null, 'str', 42, [1, 2]]) {
      const result = validate(doc);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(['OpenAPI document must be a JSON or YAML object.']);
      expect(result.warnings).toEqual([]);
    }
  });

  it('errors on missing or non-3.x version', () => {
    expect(validate({ paths: minimalPaths }).errors).toContain(
      'Only OpenAPI 3.x documents are supported in this version.'
    );
    // '3' has no dot -> fails startsWith('3.')
    expect(validate({ openapi: '3', paths: minimalPaths }).errors).toContain(
      'Only OpenAPI 3.x documents are supported in this version.'
    );
    // numeric openapi fails typeof string
    expect(validate({ openapi: 3.0, paths: minimalPaths }).errors).toContain(
      'Only OpenAPI 3.x documents are supported in this version.'
    );
  });

  it('accepts a valid 3.x document with supported methods and emits no warnings', () => {
    const result = validate({
      openapi: '3.0.0',
      paths: {
        '/users': {
          get: { responses: {} },
          post: { responses: {} },
          put: { responses: {} },
          patch: { responses: {} },
          delete: { responses: {} },
        },
      },
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('warns once per unsupported-but-known method and stays valid', () => {
    const result = validate({
      openapi: '3.0.0',
      paths: { '/users': { head: {}, options: {}, trace: {}, get: { responses: {} } } },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([
      'Method "HEAD /users" is not supported in V1 and will be ignored.',
      'Method "OPTIONS /users" is not supported in V1 and will be ignored.',
      'Method "TRACE /users" is not supported in V1 and will be ignored.',
    ]);
  });

  it('errors on missing, empty, or non-object paths and skips the loop', () => {
    for (const paths of [undefined, {}, [1, 2], 'x']) {
      const result = validate({ openapi: '3.0.0', paths });
      expect(result.errors).toContain('OpenAPI document must include a non-empty "paths" object.');
    }
  });

  it('warns and skips invalid path-item values without becoming fatal', () => {
    const result = validate({
      openapi: '3.0.0',
      paths: { '/bad': 'nope', '/good': { get: { responses: {} } } },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Ignoring invalid path item at "/bad".');
  });

  it('ignores unknown path-level keys silently', () => {
    const result = validate({
      openapi: '3.0.0',
      paths: { '/x': { parameters: [], summary: 's', $ref: '#/x', get: { responses: {} } } },
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('matches methods case-insensitively but reports uppercased original in the warning', () => {
    const result = validate({
      openapi: '3.0.0',
      paths: { '/x': { HeAd: {}, get: { responses: {} } } },
    });

    expect(result.warnings).toEqual([
      'Method "HEAD /x" is not supported in V1 and will be ignored.',
    ]);
  });

  it('accumulates multiple errors without short-circuiting', () => {
    const result = validate({});
    expect(result.errors).toEqual([
      'Only OpenAPI 3.x documents are supported in this version.',
      'OpenAPI document must include a non-empty "paths" object.',
    ]);
    expect(result.valid).toBe(false);
  });
});
