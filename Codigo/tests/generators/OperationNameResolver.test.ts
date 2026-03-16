import { describe, expect, it } from 'vitest';
import { OperationNameResolver } from '../../src/services/generators/OperationNameResolver';

const resolver = new OperationNameResolver();

describe('OperationNameResolver', () => {
  it('prioritizes and sanitizes operationId', () => {
    const name = resolver.resolve({
      operationId: 'list-users',
      method: 'get',
      path: '/users',
    });

    expect(name).toBe('listUsers');
  });

  it('falls back to method + path', () => {
    const name = resolver.resolve({
      method: 'delete',
      path: '/orders/{orderId}/items/{itemId}',
    });

    expect(name).toBe('deleteOrdersByOrderIdItemsByItemId');
  });

  it('handles snake_case and invalid operationId', () => {
    const name = resolver.resolve({
      operationId: '123_get_user_by_id',
      method: 'get',
      path: '/users/{id}',
    });

    expect(name).toBe('op123GetUserById');
  });

  it('resolves collisions deterministically', () => {
    const resolved = resolver.resolveAll([
      { method: 'get', path: '/users', functionName: '', parameters: [], responses: [] },
      { method: 'get', path: '/users', functionName: '', parameters: [], responses: [] },
      { method: 'get', path: '/users', functionName: '', parameters: [], responses: [] },
    ]);

    expect(resolved.map((operation) => operation.functionName)).toEqual([
      'getUsers',
      'getUsers2',
      'getUsers3',
    ]);
  });
});
