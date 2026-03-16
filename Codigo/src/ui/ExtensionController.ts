import { join } from 'node:path';
import type { Config } from '../models/config';
import type { GenerateArtifactsResult } from '../models/results';
import { ConfigManager } from '../services/config/ConfigManager';
import { FileWriter } from '../services/generators/FileWriter';
import { OperationNameResolver } from '../services/generators/OperationNameResolver';
import { SDKGenerator } from '../services/generators/SDKGenerator';
import { TypeGenerator } from '../services/generators/TypeGenerator';
import { OpenAPILoader } from '../services/parsers/OpenAPILoader';
import type { ExtensionToUIMessage, UIConfigPayload } from './messages';

export class ExtensionController {
  constructor(
    private readonly configManager: ConfigManager,
    private readonly openAPILoader: OpenAPILoader,
    private readonly operationNameResolver: OperationNameResolver,
    private readonly typeGenerator: TypeGenerator,
    private readonly fileWriter: FileWriter,
    private readonly workspaceRoot: string
  ) {}

  async getConfig(): Promise<Config> {
    return this.configManager.getConfig();
  }

  async getUIConfig(): Promise<UIConfigPayload> {
    const config = await this.configManager.getConfig();

    return {
      baseURL: config.baseURL,
      importPath: config.importPath,
      outputPath: config.outputPath,
      hasOpenAPI: Boolean(config.openAPI),
    };
  }

  async updateConfig(partialConfig: Partial<Config>): Promise<Config> {
    const normalized: Partial<Config> = {
      ...partialConfig,
      baseURL: this.normalizeOptionalString(partialConfig.baseURL),
      outputPath: this.normalizeOptionalString(partialConfig.outputPath),
    };

    return this.configManager.mergeConfig(normalized);
  }

  async runImportOpenAPI(
    source: string,
    partialConfig: Pick<Config, 'baseURL' | 'outputPath'> = {}
  ): Promise<ExtensionToUIMessage> {
    const normalizedSource = source.trim();
    if (!normalizedSource) {
      return {
        type: 'import:error',
        payload: {
          errors: ['OpenAPI source cannot be empty.'],
        },
      };
    }

    const mergedConfig = await this.updateConfig(partialConfig);
    const importResult = await this.openAPILoader.importOpenAPI(normalizedSource);

    if (!importResult.success || !importResult.openAPI) {
      return {
        type: 'import:error',
        payload: {
          errors: importResult.errors ?? ['Failed to import OpenAPI source.'],
          warnings: importResult.warnings,
        },
      };
    }

    await this.configManager.setConfig({
      ...mergedConfig,
      importPath: normalizedSource,
      openAPI: importResult.openAPI,
    });

    return {
      type: 'import:success',
      payload: {
        operations: importResult.openAPI.operations.length,
        schemas: Object.keys(importResult.openAPI.schemas).length,
        warnings: importResult.warnings,
      },
    };
  }

  async runGenerateMethods(
    partialConfig: Pick<Config, 'baseURL' | 'outputPath'> = {}
  ): Promise<ExtensionToUIMessage> {
    const currentConfig = await this.updateConfig(partialConfig);

    if (!currentConfig.openAPI) {
      return {
        type: 'generate:error',
        payload: {
          errors: ['No OpenAPI data found. Import a specification before generating SDK files.'],
        },
      };
    }

    const outputPath =
      this.normalizeOptionalString(currentConfig.outputPath) ?? join(this.workspaceRoot, 'generated-sdk');

    const resolvedOperations = this.operationNameResolver.resolveAll(currentConfig.openAPI.operations);
    const openAPI = {
      ...currentConfig.openAPI,
      operations: resolvedOperations,
    };

    const typesContent = this.typeGenerator.createTypes(openAPI.schemas, openAPI.operations);
    const sdkGenerator = new SDKGenerator({
      ...currentConfig,
      outputPath,
    });
    const clientContent = sdkGenerator.generateMethods(openAPI.operations);

    const generationResult = await this.writeArtifacts(outputPath, {
      'types.ts': typesContent,
      'client.ts': clientContent,
      'index.ts': "export * from './types';\nexport * from './client';\n",
    });

    if (!generationResult.success) {
      return {
        type: 'generate:error',
        payload: {
          errors: generationResult.errors ?? ['Failed to write generated files.'],
          warnings: generationResult.warnings,
        },
      };
    }

    await this.configManager.setConfig({
      ...currentConfig,
      outputPath,
      openAPI,
    });

    return {
      type: 'generate:success',
      payload: {
        files: generationResult.files,
        warnings: generationResult.warnings,
      },
    };
  }

  private async writeArtifacts(
    outputPath: string,
    files: Record<string, string>
  ): Promise<GenerateArtifactsResult> {
    try {
      const writtenFiles = await this.fileWriter.writeArtifacts(outputPath, files);

      return {
        success: true,
        files: writtenFiles,
      };
    } catch (error) {
      return {
        success: false,
        files: [],
        errors: [error instanceof Error ? error.message : 'Unknown file writing error.'],
      };
    }
  }

  private normalizeOptionalString(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
