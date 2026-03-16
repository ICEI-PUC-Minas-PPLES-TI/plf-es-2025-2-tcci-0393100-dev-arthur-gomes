import type { OpenAPIModel } from './openapi';

export interface Config {
  baseURL?: string;
  importPath?: string;
  adapter: 'fetch';
  outputPath?: string;
  openAPI?: OpenAPIModel;
}
