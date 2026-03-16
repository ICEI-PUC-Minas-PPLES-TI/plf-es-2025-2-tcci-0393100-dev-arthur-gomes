import type { OperationModel } from './operation';
import type { SchemaModel } from './schema';

export type OpenAPIStatus = 'NOT_INITIALIZED' | 'COMPLETED' | 'FAILED';

export interface OpenAPIInfo {
  title?: string;
  version?: string;
}

export interface OpenAPIModel {
  version: string;
  info?: OpenAPIInfo;
  schemas: Record<string, SchemaModel>;
  operations: OperationModel[];
  status: OpenAPIStatus;
}
