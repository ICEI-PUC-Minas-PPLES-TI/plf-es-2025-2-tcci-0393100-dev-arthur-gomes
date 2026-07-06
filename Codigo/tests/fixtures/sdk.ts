import type { Config } from '../../src/models/config';
import type { Operation } from '../../src/models/operation';
import type { Schema } from '../../src/models/schema';
import { ReactQueryGenerator } from '../../src/services/generators/ReactQueryGenerator';
import { SDKGenerator } from '../../src/services/generators/SDKGenerator';
import { TypeGenerator } from '../../src/services/generators/TypeGenerator';

export const sampleSchemas: Record<string, Schema> = {
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

export const sampleOperations: Operation[] = [
  {
    functionName: 'getUsersById',
    method: 'get',
    path: '/users/{id}',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { name: 'id', type: 'string' } },
      { name: 'expand', in: 'query', required: false, schema: { name: 'expand', type: 'boolean' } },
    ],
    responses: [
      { statusCode: '200', content: { 'application/json': { ref: '#/components/schemas/User' } } },
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
            properties: {
              name: { schema: { name: 'name', type: 'string' } },
              age: { schema: { name: 'age', type: 'integer', nullable: true } },
            },
          },
        },
      },
    },
    responses: [
      { statusCode: '201', content: { 'application/json': { ref: '#/components/schemas/User' } } },
    ],
  },
  {
    functionName: 'deleteUsersById',
    method: 'delete',
    path: '/users/{id}',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { name: 'id', type: 'string' } }],
    responses: [{ statusCode: '204', content: {} }],
  },
];

/**
 * An operation whose response set is empty. pickPrimaryResponseStatus returns
 * undefined, so the SDK falls back to a `Types.<Fn>Response200` reference that
 * TypeGenerator never declares — the known cross-module bug used as the
 * negative-control case in the compile harness.
 */
export const emptyResponsesOperation: Operation = {
  functionName: 'ping',
  method: 'get',
  path: '/ping',
  parameters: [],
  responses: [],
};

export function buildBundle(config: Config, operations: Operation[] = sampleOperations): Record<string, string> {
  const sdk = new SDKGenerator(config);
  const files: Record<string, string> = {
    'types.ts': new TypeGenerator().createTypes(sampleSchemas, operations),
    'transport.ts': sdk.generateTransport(),
    'api.ts': sdk.generateMethods(operations),
  };

  if (config.adapter === 'react-query') {
    files['react-query.ts'] = new ReactQueryGenerator().generateModule(operations);
  }

  return files;
}
