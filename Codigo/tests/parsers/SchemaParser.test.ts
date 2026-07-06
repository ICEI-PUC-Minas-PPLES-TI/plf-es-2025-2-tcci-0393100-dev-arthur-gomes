import { describe, expect, it } from 'vitest';
import { SchemaParser } from '../../src/services/parsers/SchemaParser';

describe('SchemaParser', () => {
  const parser = new SchemaParser();

  describe('parseSchemas', () => {
    it('preserves keys and maps each entry to a Schema model', () => {
      const result = parser.parseSchemas({
        User: { type: 'object' },
        Id: { type: 'string' },
      });

      expect(Object.keys(result)).toEqual(['User', 'Id']);
      expect(result.User).toEqual({ name: 'User', type: 'object' });
      expect(result.Id).toEqual({ name: 'Id', type: 'string' });
    });

    it('defaults to an empty object when called with no argument', () => {
      expect(parser.parseSchemas()).toEqual({});
    });
  });

  describe('parseSchemaModel', () => {
    it('returns a name-only model for non-object raw schema', () => {
      expect(parser.parseSchemaModel('Foo', null)).toEqual({ name: 'Foo' });
      expect(parser.parseSchemaModel('Foo', 'string')).toEqual({ name: 'Foo' });
      expect(parser.parseSchemaModel('Foo', [1, 2])).toEqual({ name: 'Foo' });
    });

    it('short-circuits on $ref and drops sibling fields (data-loss branch)', () => {
      const result = parser.parseSchemaModel('Foo', {
        $ref: '#/components/schemas/Bar',
        type: 'object',
        nullable: true,
      });

      expect(result).toEqual({ name: 'Foo', ref: '#/components/schemas/Bar' });
      expect(result.type).toBeUndefined();
      expect(result.nullable).toBeUndefined();
    });

    it('copies type and format only when they are strings', () => {
      expect(parser.parseSchemaModel('Foo', { type: 'string', format: 'date-time' })).toEqual({
        name: 'Foo',
        type: 'string',
        format: 'date-time',
      });

      const nonString = parser.parseSchemaModel('Foo', { type: 42, format: true });
      expect(nonString.type).toBeUndefined();
      expect(nonString.format).toBeUndefined();
    });

    it('keeps nullable for both true and false, strips it for non-boolean', () => {
      expect(parser.parseSchemaModel('Foo', { nullable: true }).nullable).toBe(true);
      expect(parser.parseSchemaModel('Foo', { nullable: false }).nullable).toBe(false);
      expect(parser.parseSchemaModel('Foo', { nullable: 'yes' }).nullable).toBeUndefined();
    });

    it('filters required array down to strings only', () => {
      const result = parser.parseSchemaModel('Foo', { required: ['a', 1, 'b', null, true] });
      expect(result.required).toEqual(['a', 'b']);
    });

    it('ignores non-array required', () => {
      expect(parser.parseSchemaModel('Foo', { required: 'a' }).required).toBeUndefined();
    });

    it('keeps string/number/boolean/null enum values, drops objects and arrays', () => {
      const result = parser.parseSchemaModel('Foo', {
        enum: ['A', 1, true, null, { x: 1 }, [1]],
      });
      expect(result.enum).toEqual(['A', 1, true, null]);
    });

    it('preserves $ref items and gives inline items a `${name}Item` fallback', () => {
      const refItems = parser.parseSchemaModel('Tags', {
        type: 'array',
        items: { $ref: '#/components/schemas/Tag' },
      });
      expect(refItems.items).toEqual({ ref: '#/components/schemas/Tag' });

      const inlineItems = parser.parseSchemaModel('Tags', {
        type: 'array',
        items: { type: 'string' },
      });
      expect(inlineItems.items).toEqual({ schema: { name: 'TagsItem', type: 'string' } });
    });

    it('enters items when truthy but drops non-object items (items: true)', () => {
      const result = parser.parseSchemaModel('Tags', { type: 'array', items: true });
      expect(result.items).toBeUndefined();
    });

    it('skips falsy items (items: null)', () => {
      const result = parser.parseSchemaModel('Tags', { type: 'array', items: null });
      expect(result.items).toBeUndefined();
    });

    it('recurses into properties with concatenated `${name}${prop}` names', () => {
      const result = parser.parseSchemaModel('User', {
        type: 'object',
        properties: {
          id: { type: 'string' },
          role: { $ref: '#/components/schemas/Role' },
        },
      });

      expect(result.properties).toEqual({
        id: { schema: { name: 'Userid', type: 'string' } },
        role: { ref: '#/components/schemas/Role' },
      });
    });

    it('omits property entries whose value is not an object', () => {
      const result = parser.parseSchemaModel('User', {
        properties: {
          id: { type: 'string' },
          bogus: 'nope',
        },
      });
      expect(result.properties).toEqual({ id: { schema: { name: 'Userid', type: 'string' } } });
    });

    it('ignores non-object properties value entirely', () => {
      expect(parser.parseSchemaModel('User', { properties: [1, 2] }).properties).toBeUndefined();
      expect(parser.parseSchemaModel('User', { properties: 'x' }).properties).toBeUndefined();
    });
  });

  describe('parseRefOrInline', () => {
    it('returns undefined for non-object raw schema', () => {
      expect(parser.parseRefOrInline(null, 'Foo')).toBeUndefined();
      expect(parser.parseRefOrInline('str', 'Foo')).toBeUndefined();
      expect(parser.parseRefOrInline([1], 'Foo')).toBeUndefined();
    });

    it('returns a ref wrapper when $ref is a string', () => {
      expect(parser.parseRefOrInline({ $ref: '#/x' }, 'Foo')).toEqual({ ref: '#/x' });
    });

    it('falls through to inline schema when $ref is not a string', () => {
      expect(parser.parseRefOrInline({ $ref: 123, type: 'string' }, 'Foo')).toEqual({
        schema: { name: 'Foo', type: 'string' },
      });
    });
  });
});
