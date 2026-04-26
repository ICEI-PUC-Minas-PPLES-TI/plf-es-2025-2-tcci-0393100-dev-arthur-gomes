import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/models/config';
import type { OperationModel } from '../../src/models/operation';
import type { SchemaModel } from '../../src/models/schema';
import { ReactQueryGenerator } from '../../src/services/generators/ReactQueryGenerator';
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
    expect(generated).toContain('export interface GetUsersByIdRequestArgs');
    expect(generated).toContain('export type DeleteUsersByIdResponse204 = void;');
    expect(generated).toContain('export interface DeleteUsersByIdRequestArgs');
    expect(generated).toContain('export type CreateUserRequestBody =');
    expect(generated).toContain('export interface CreateUserRequestArgs');
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
    expect(generated).toContain("import { createTransport } from './transport';");
    expect(generated).toContain('const BASE_URL = "https://api.example.com";');
    expect(generated).toContain('const transport = createTransport();');
    expect(generated).toContain('export async function getUsersById');
    expect(generated).toContain('args: Types.GetUsersByIdRequestArgs');
    expect(generated).toContain('args: Types.CreateUserRequestArgs');
    expect(generated).toContain('transport.request<');
    expect(generated).toContain('Missing path parameter');
    expect(generated).toContain("const normalizedBase = baseURL.replace(/\\/+$/, '');");
    expect(generated).not.toContain('...(args.headerParams ?? {})');
    expect(generated).toContain('args.path as unknown as Record<string, string | number | boolean>');
    expect(generated).toContain('args.query as unknown as Record<string, unknown> | undefined');
  });

  it('generates a fetch transport implementation by default', () => {
    const config: Config = {
      adapter: 'fetch',
      outputPath: '/tmp/generated-sdk',
    };

    const transport = new SDKGenerator(config).generateTransport();

    expect(transport).toContain('export function createTransport(): Transport');
    expect(transport).toContain('fetch(url');
    expect(transport).not.toContain('import axios');
  });

  it('generates axios transport wiring when adapter is axios', () => {
    const config: Config = {
      adapter: 'axios',
      outputPath: '/tmp/generated-sdk',
    };

    const transport = new SDKGenerator(config).generateTransport();

    expect(transport).toContain("import axios from 'axios';");
    expect(transport).toContain('axios.request<TResponse>');
    expect(transport).not.toContain('fetch(url');
  });

  it('generates a react-query module with query and mutation helpers', () => {
    const generated = new ReactQueryGenerator().generateModule(operations);

    expect(generated).toContain("from '@tanstack/react-query'");
    expect(generated).toContain('export function getUsersByIdQueryKey');
    expect(generated).toContain('return ["getUsersById", args] as const;');
    expect(generated).toContain('export function getUsersByIdQueryOptions');
    expect(generated).toContain('return useQuery(getUsersByIdQueryOptions(args, options));');
    expect(generated).toContain('export function createUserMutationKey()');
    expect(generated).toContain('export function createUserMutationOptions');
    expect(generated).toContain('mutationFn: (args: Types.CreateUserRequestArgs) => Client.createUser(args),');
    expect(generated).toContain('return useMutation(createUserMutationOptions(options));');
  });
});
