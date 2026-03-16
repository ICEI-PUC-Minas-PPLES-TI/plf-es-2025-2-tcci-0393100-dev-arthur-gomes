import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OperationNameResolver } from '../../src/services/generators/OperationNameResolver';
import { OpenAPILoader } from '../../src/services/parsers/OpenAPILoader';
import { OpenAPIValidator } from '../../src/services/parsers/OpenAPIValidator';
import { PathParser } from '../../src/services/parsers/PathParser';
import { SchemaParser } from '../../src/services/parsers/SchemaParser';

function createLoader(fetcher?: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>) {
  const schemaParser = new SchemaParser();
  const pathParser = new PathParser(schemaParser);
  const validator = new OpenAPIValidator();
  const operationNameResolver = new OperationNameResolver();

  return new OpenAPILoader(validator, pathParser, schemaParser, operationNameResolver, fetcher);
}

const createdDirectories: string[] = [];

async function withTempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plf-es-loader-'));
  createdDirectories.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

afterEach(async () => {
  while (createdDirectories.length > 0) {
    const directory = createdDirectories.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

describe('OpenAPILoader', () => {
  it('imports a valid local JSON OpenAPI file', async () => {
    const filePath = await withTempFile(
      'spec.json',
      JSON.stringify({
        openapi: '3.0.0',
        paths: {
          '/users': {
            get: {
              operationId: 'list-users',
              responses: {
                200: {
                  description: 'ok',
                  content: {
                    'application/json': {
                      schema: { type: 'array', items: { type: 'string' } },
                    },
                  },
                },
              },
            },
          },
        },
      })
    );

    const result = await createLoader().importOpenAPI(filePath);

    expect(result.success).toBe(true);
    expect(result.openAPI?.operations).toHaveLength(1);
    expect(result.openAPI?.operations[0].functionName).toBe('listUsers');
  });

  it('imports a valid local YAML OpenAPI file', async () => {
    const filePath = await withTempFile(
      'spec.yaml',
      `openapi: 3.0.0
paths:
  /users/{id}:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: string
`
    );

    const result = await createLoader().importOpenAPI(filePath);

    expect(result.success).toBe(true);
    expect(result.openAPI?.operations[0].functionName).toBe('getUsersById');
  });

  it('imports a valid OpenAPI URL response', async () => {
    const loader = createLoader(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          openapi: '3.0.0',
          paths: {
            '/health': {
              get: {
                responses: {
                  200: { description: 'ok' },
                },
              },
            },
          },
        }),
    }));

    const result = await loader.importOpenAPI('https://example.com/openapi.json');

    expect(result.success).toBe(true);
    expect(result.openAPI?.operations[0].functionName).toBe('getHealth');
  });

  it('returns a readable error for missing local file', async () => {
    const result = await createLoader().importOpenAPI('/tmp/does-not-exist-openapi.json');

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('Unable to read OpenAPI file');
  });

  it('returns a readable error for unreachable URL', async () => {
    const loader = createLoader(async () => {
      throw new Error('Network unreachable');
    });

    const result = await loader.importOpenAPI('https://example.com/openapi.yaml');

    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain('Network unreachable');
  });

  it('rejects non-OpenAPI documents', async () => {
    const filePath = await withTempFile('invalid.json', JSON.stringify({ foo: 'bar' }));

    const result = await createLoader().importOpenAPI(filePath);

    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('OpenAPI 3.x');
  });

  it('rejects OpenAPI documents without paths', async () => {
    const filePath = await withTempFile('no-paths.yaml', 'openapi: 3.0.0\ninfo:\n  title: Demo\n');

    const result = await createLoader().importOpenAPI(filePath);

    expect(result.success).toBe(false);
    expect(result.errors?.join(' ')).toContain('non-empty "paths"');
  });

  it('warns for unsupported methods without crashing', async () => {
    const filePath = await withTempFile(
      'unsupported.yaml',
      `openapi: 3.0.0
paths:
  /users:
    head:
      responses:
        '200':
          description: ok
    get:
      responses:
        '200':
          description: ok
`
    );

    const result = await createLoader().importOpenAPI(filePath);

    expect(result.success).toBe(true);
    expect(result.warnings?.join(' ')).toContain('not supported in V1');
    expect(result.openAPI?.operations).toHaveLength(1);
  });
});
