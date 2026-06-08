import type { Operation } from './operation';
import type { Schema } from './schema';

export type OpenAPIStatus = 'NOT_INITIALIZED' | 'COMPLETED' | 'FAILED';

export type RawOpenAPI = Record<string, unknown>;

export interface Info {
  title?: string;
  version?: string;
}

export interface OpenAPI {
  version: string;
  info?: Info;
  schemas: Record<string, Schema>;
  operations: Operation[];
  status: OpenAPIStatus;
}
