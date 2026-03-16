import type { OpenAPIModel } from './openapi';

export interface ImportOpenAPIResult {
  success: boolean;
  openAPI?: OpenAPIModel;
  warnings?: string[];
  errors?: string[];
}

export interface GenerateArtifactsResult {
  success: boolean;
  files: string[];
  warnings?: string[];
  errors?: string[];
}
