import type { OpenAPI } from './openapi';

export interface ImportOpenAPIResult {
  success: boolean;
  openAPI?: OpenAPI;
  warnings?: string[];
  errors?: string[];
}

export interface GenerateArtifactsResult {
  success: boolean;
  files: string[];
  warnings?: string[];
  errors?: string[];
}
