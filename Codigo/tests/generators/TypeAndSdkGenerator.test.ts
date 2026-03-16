import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/models/config';
import type { OperationModel } from '../../src/models/operation';
import type { SchemaModel } from '../../src/models/schema';
import { SDKGenerator } from '../../src/services/generators/SDKGenerator';
import { TypeGenerator } from '../../src/services/generators/TypeGenerator';

const schemas: Record<string, SchemaModel> = {
  User: {
    name: 'User',
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { schema: { name: 'id', type: 'string' } },
      name: { schema: { name: 'name', type: 'string' } },
      status: { schema: { name: 'status', enum: ['ACTIVE', 'INACTIVE'] } },
    },
  },
};

const operations: OperationModel[] = [
  {
    functionName: 'getUsersById',
    method: 'get',
    path: '/users/{id}',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { name: 'id', type: 'string' },
      },
      {
        name: 'includePosts',
        in: 'query',
        required: false,
        schema: { name: 'includePosts', type: 'boolean' },
      },
    ],
    responses: [
      {
        statusCode: '200',
        content: {
          'application/json': {
            ref: '#/components/schemas/User',
          },
        },
      },
    ],
  },
  {
    functionName: 'deleteUsersById',
    method: 'delete',
    path: '/users/{id}',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: { name: 'id', type: 'string' },
      },
    ],
    responses: [
      {
        statusCode: '204',
        content: {},
      },
    ],
  },
  {
    functionName: 'createUser',
    method: 'post',
    path: '/users',
    parameters: [],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            name: 'CreateUserRequest',
            type: 'object',
            required: ['name'],
            nullable: false,
            properties: {
              name: { schema: { name: 'name', type: 'string' } },
              age: { schema: { name: 'age', type: 'integer', nullable: true } },
            },
          },
        },
      },
    },
    responses: [
      {
        statusCode: '201',
        content: {
          'application/json': {
            ref: '#/components/schemas/User',
          },
        },
      },
    ],
  },
];

describe('TypeGenerator', () => {
  it('generates component and operation types with expected mappings', () => {
    const generator = new TypeGenerator();
    const generated = generator.createTypes(schemas, operations);

    expect(generated).toContain("export interface User");
    expect(generated).toContain("status?: \"ACTIVE\" | \"INACTIVE\"");
    expect(generated).toContain('export interface GetUsersByIdPathParams');
    expect(generated).toContain('export type DeleteUsersByIdResponse204 = void;');
    expect(generated).toContain('export type CreateUserRequestBody =');
    expect(generated).toContain('(number) | null');
  });
});

describe('SDKGenerator', () => {
  it('generates typed methods with URL/body handling and baseURL support', () => {
    const config: Config = {
      adapter: 'fetch',
      baseURL: 'https://api.example.com',
      outputPath: '/tmp/generated-sdk',
    };

    const generated = new SDKGenerator(config).generateMethods(operations);

    expect(generated).toContain("import type * as Types from './types';");
    expect(generated).toContain('const BASE_URL = "https://api.example.com";');
    expect(generated).toContain('export async function getUsersById');
    expect(generated).toContain('JSON.stringify(args.body)');
    expect(generated).toContain('Missing path parameter');
    expect(generated).toContain('return undefined as Types.DeleteUsersByIdResponse204;');
    expect(generated).toContain("const normalizedBase = baseURL.replace(/\\/+$/, '');");
    expect(generated).not.toContain('...(args.headerParams ?? {})');
    expect(generated).toContain('args.path as unknown as Record<string, string | number | boolean>');
    expect(generated).toContain('args.query as unknown as Record<string, unknown> | undefined');
  });
});
