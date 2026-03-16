export type EnumValue = string | number | boolean | null;

export interface SchemaRefOrInline {
  ref?: string;
  schema?: SchemaModel;
}

export interface SchemaModel {
  name: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  required?: string[];
  enum?: EnumValue[];
  items?: SchemaRefOrInline;
  properties?: Record<string, SchemaRefOrInline>;
  ref?: string;
}
