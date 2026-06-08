export type EnumValue = string | number | boolean | null;

export interface SchemaRefOrInline {
  ref?: string;
  schema?: Schema;
}

export type SchemaProperties = Record<string, SchemaRefOrInline>;

export interface Schema {
  name: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  required?: string[];
  enum?: EnumValue[];
  items?: SchemaRefOrInline;
  properties?: SchemaProperties;
  ref?: string;
}
