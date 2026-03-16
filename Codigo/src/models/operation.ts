import type { SchemaModel, SchemaRefOrInline } from './schema';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type ParameterLocation = 'path' | 'query' | 'header' | 'cookie';

export interface ParameterModel {
  name: string;
  in: ParameterLocation;
  required: boolean;
  schema?: SchemaModel;
  ref?: string;
}

export interface OperationRequestBodyModel {
  required?: boolean;
  content: Record<string, SchemaRefOrInline>;
}

export interface OperationResponseModel {
  statusCode: string;
  description?: string;
  content: Record<string, SchemaRefOrInline>;
}

export interface OperationModel {
  operationId?: string;
  functionName: string;
  method: HttpMethod;
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters: ParameterModel[];
  requestBody?: OperationRequestBodyModel;
  responses: OperationResponseModel[];
}
