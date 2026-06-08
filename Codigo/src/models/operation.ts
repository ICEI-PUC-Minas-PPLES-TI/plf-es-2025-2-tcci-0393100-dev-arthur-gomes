import type { Schema, SchemaRefOrInline } from './schema';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export type PathItem = Record<string, unknown>;
export type OperationSchema = SchemaRefOrInline;

export interface Parameter {
  name: string;
  in: ParameterLocation;
  required: boolean;
  schema?: Schema;
  ref?: string;
}

export interface OperationRequestBody {
  required?: boolean;
  content: Record<string, OperationSchema>;
}

export interface OperationResponse {
  statusCode: string;
  description?: string;
  content: Record<string, OperationSchema>;
}

export interface Operation {
  operationId?: string;
  functionName: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: Parameter[];
  requestBody?: OperationRequestBody;
  responses: OperationResponse[];
}
