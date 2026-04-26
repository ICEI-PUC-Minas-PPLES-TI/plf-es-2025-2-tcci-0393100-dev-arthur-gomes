import { join } from 'node:path';
import type { AdapterKind, Config } from '../models/config';
import type { GenerateArtifactsResult } from '../models/results';
import { ConfigManager } from '../services/config/ConfigManager';
import { FileWriter } from '../services/generators/FileWriter';
import { OperationNameResolver } from '../services/generators/OperationNameResolver';
import { ReactQueryGenerator } from '../services/generators/ReactQueryGenerator';
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
    private readonly reactQueryGenerator: ReactQueryGenerator,
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
      adapter: config.adapter,
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
      adapter: this.normalizeAdapter(partialConfig.adapter),
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
    partialConfig: Partial<Pick<Config, 'adapter' | 'baseURL' | 'outputPath'>> = {}
  ): Promise<ExtensionToUIMessage> {
    const currentConfig = await this.configManager.getConfig();
    const runtimeConfig: Config = {
      ...currentConfig,
      baseURL: this.normalizeOptionalString(partialConfig.baseURL) ?? currentConfig.baseURL,
      outputPath: this.normalizeOptionalString(partialConfig.outputPath) ?? currentConfig.outputPath,
      adapter: this.normalizeAdapter(partialConfig.adapter ?? currentConfig.adapter),
    };

    if (!runtimeConfig.openAPI) {
      return {
        type: 'generate:error',
        payload: {
          errors: ['No OpenAPI data found. Import a specification before generating SDK files.'],
        },
      };
    }

    const outputPath =
      this.normalizeOptionalString(runtimeConfig.outputPath) ?? join(this.workspaceRoot, 'generated-sdk');

    const resolvedOperations = this.operationNameResolver.resolveAll(runtimeConfig.openAPI.operations);
    const openAPI = {
      ...runtimeConfig.openAPI,
      operations: resolvedOperations,
    };

    const typesContent = this.typeGenerator.createTypes(openAPI.schemas, openAPI.operations);
    const sdkGenerator = new SDKGenerator({
      ...runtimeConfig,
      outputPath,
    });
    const transportContent = sdkGenerator.generateTransport();
    const clientContent = sdkGenerator.generateMethods(openAPI.operations);
    const generatedFiles: Record<string, string> = {
      'types.ts': typesContent,
      'transport.ts': transportContent,
      'client.ts': clientContent,
    };

    if (runtimeConfig.adapter === 'react-query') {
      generatedFiles['react-query.ts'] = this.reactQueryGenerator.generateModule(openAPI.operations);
    }

    generatedFiles['index.ts'] = this.generateIndexFile(runtimeConfig.adapter);
    const generationResult = await this.writeArtifacts(outputPath, generatedFiles);

    if (!generationResult.success) {
      return {
        type: 'generate:error',
        payload: {
          errors: generationResult.errors ?? ['Failed to write generated files.'],
          warnings: generationResult.warnings,
        },
      };
    }

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

  private normalizeAdapter(adapter: AdapterKind | undefined): AdapterKind {
    if (adapter === 'axios') {
      return 'axios';
    }

    if (adapter === 'react-query') {
      return 'react-query';
    }

    return 'fetch';
  }

  private generateIndexFile(adapter: AdapterKind): string {
    const exports = ["export * from './types';", "export * from './transport';", "export * from './client';"];

    if (adapter === 'react-query') {
      exports.push("export * from './react-query';");
    }

    return `${exports.join('\n')}\n`;
  }
}
