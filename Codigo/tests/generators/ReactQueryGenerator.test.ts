import { describe, expect, it } from 'vitest';
import type { Operation } from '../../src/models/operation';
import { ReactQueryGenerator } from '../../src/services/generators/ReactQueryGenerator';

const gen = new ReactQueryGenerator();

function op(overrides: Partial<Operation>): Operation {
  return {
    functionName: 'listX',
    method: 'get',
    path: '/x',
    parameters: [],
    responses: [{ statusCode: '200', content: {} }],
    ...overrides,
  };
}

describe('ReactQueryGenerator routing', () => {
  it('routes GET to query helpers with a use<Name> hook', () => {
    const out = gen.generateModule([op({ functionName: 'getUser', method: 'get' })]);
    expect(out).toContain('export function getUserQueryKey');
    expect(out).toContain('export function getUserQueryOptions');
    expect(out).toContain('export function useGetUser(');
    expect(out).not.toContain('MutationKey');
  });

  it('routes non-GET to mutation helpers with a use<Name>Mutation hook', () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const out = gen.generateModule([op({ functionName: 'saveUser', method })]);
      expect(out).toContain('export function saveUserMutationKey()');
      expect(out).toContain('export function saveUserMutationOptions');
      expect(out).toContain('export function useSaveUserMutation(');
      expect(out).not.toContain('QueryKey');
    }
  });
});

describe('ReactQueryGenerator required-args handling', () => {
  it('uses a defaulted `args = {}` signature but passes args through cleanly', () => {
    const out = gen.generateModule([op({ functionName: 'listX', method: 'get', parameters: [] })]);
    expect(out).toContain('export function listXQueryKey(args: Types.ListXRequestArgs = {})');
    // Pass-through must be a plain `args`, not `args = {}` (which would reassign
    // and clobber a caller-supplied value).
    expect(out).toContain('queryKey: listXQueryKey(args)');
    expect(out).toContain('return useQuery(listXQueryOptions(args, options));');
    expect(out).not.toContain('args = {})');
  });

  it('requires args (no default) when a required path param is present', () => {
    const out = gen.generateModule([
      op({
        functionName: 'getUser',
        method: 'get',
        parameters: [{ name: 'id', in: 'path', required: true }],
      }),
    ]);
    expect(out).toContain('export function getUserQueryKey(args: Types.GetUserRequestArgs)');
    expect(out).toContain('queryKey: getUserQueryKey(args)');
    expect(out).not.toContain('getUserQueryKey(args = {})');
  });

  it('requires args when the request body is required', () => {
    const out = gen.generateModule([
      op({
        functionName: 'getUser',
        method: 'get',
        requestBody: { required: true, content: { 'application/json': { schema: { name: 'B' } } } },
      }),
    ]);
    expect(out).toContain('export function getUserQueryOptions(\n  args: Types.GetUserRequestArgs,');
  });
});
