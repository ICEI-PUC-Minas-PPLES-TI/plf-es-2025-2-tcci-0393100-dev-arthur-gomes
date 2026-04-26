import type { OpenAPIModel } from './openapi';

export type AdapterKind = 'fetch' | 'axios' | 'react-query';

export interface Config {
  baseURL?: string;
  importPath?: string;
  adapter: AdapterKind;
  outputPath?: string;
  openAPI?: OpenAPIModel;
}
