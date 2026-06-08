import type { EnumValue, Schema, SchemaProperties, SchemaRefOrInline } from '../../models/schema';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function isEnumValue(value: unknown): value is EnumValue {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}

export class SchemaParser {
  parseSchemas(schemas: Record<string, unknown> = {}): Record<string, Schema> {
    const parsed: Record<string, Schema> = {};

    for (const [name, schema] of Object.entries(schemas)) {
      parsed[name] = this.parseSchemaModel(name, schema);
    }

    return parsed;
  }

  parseRefOrInline(rawSchema: unknown, fallbackName: string): SchemaRefOrInline | undefined {
    const schemaObject = asRecord(rawSchema);
    if (!schemaObject) {
      return undefined;
    }

    const ref = schemaObject.$ref;
    if (typeof ref === 'string') {
      return { ref };
    }

    return {
      schema: this.parseSchemaModel(fallbackName, schemaObject),
    };
  }

  parseSchemaModel(name: string, rawSchema: unknown): Schema {
    const schemaObject = asRecord(rawSchema) ?? {};
    const parsed: Schema = { name };

    if (typeof schemaObject.$ref === 'string') {
      parsed.ref = schemaObject.$ref;
      return parsed;
    }

    if (typeof schemaObject.type === 'string') {
      parsed.type = schemaObject.type;
    }

    if (typeof schemaObject.format === 'string') {
      parsed.format = schemaObject.format;
    }

    if (typeof schemaObject.nullable === 'boolean') {
      parsed.nullable = schemaObject.nullable;
    }

    if (Array.isArray(schemaObject.required)) {
      parsed.required = schemaObject.required.filter(
        (value): value is string => typeof value === 'string'
      );
    }

    if (Array.isArray(schemaObject.enum)) {
      parsed.enum = schemaObject.enum.filter(isEnumValue);
    }

    if (schemaObject.items) {
      const item = this.parseRefOrInline(schemaObject.items, `${name}Item`);
      if (item) {
        parsed.items = item;
      }
    }

    const properties = asRecord(schemaObject.properties);
    if (properties) {
      const parsedProperties: SchemaProperties = {};

      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        const parsedProperty = this.parseRefOrInline(propertySchema, `${name}${propertyName}`);
        if (parsedProperty) {
          parsedProperties[propertyName] = parsedProperty;
        }
      }

      parsed.properties = parsedProperties;
    }

    return parsed;
  }
}
