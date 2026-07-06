import { join } from 'node:path';
import type { AdapterKind, Config } from '../models/config';
import type { OpenAPI } from '../models/openapi';
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
      adapterOptions: this.getAdapterOptions(),
    };
  }

  async updateConfig(partialConfig: Partial<Config>): Promise<Config> {
    const normalized: Partial<Config> = { ...partialConfig };

    if ('baseURL' in partialConfig) {
      normalized.baseURL = this.normalizeOptionalString(partialConfig.baseURL);
    }

    if ('outputPath' in partialConfig) {
      normalized.outputPath = this.normalizeOptionalString(partialConfig.outputPath);
    }

    // Only touch the adapter when the caller actually supplied one; otherwise
    // leave it out so mergeConfig preserves the stored adapter instead of
    // silently resetting it to 'fetch'.
    if (partialConfig.adapter !== undefined) {
      normalized.adapter = this.normalizeAdapter(partialConfig.adapter);
    } else {
      delete normalized.adapter;
    }

    return this.configManager.mergeConfig(normalized);
  }

  async setBaseUrl(url: string): Promise<Config> {
    return this.updateConfig({ baseURL: url });
  }

  async setDefaultAdapter(adapter: AdapterKind): Promise<Config> {
    return this.updateConfig({ adapter });
  }

  async setOutputPath(path: string): Promise<Config> {
    return this.updateConfig({ outputPath: path });
  }

  getAdapterOptions(): AdapterKind[] {
    return ['fetch', 'axios', 'react-query'];
  }

  async reloadOpenAPI(): Promise<ExtensionToUIMessage> {
    const config = await this.configManager.getConfig();

    if (!config.importPath) {
      return {
        type: 'import:error',
        payload: {
          errors: ['No OpenAPI source to reload.'],
        },
      };
    }

    return this.runImportOpenAPI(config.importPath, {
      baseURL: config.baseURL,
      outputPath: config.outputPath,
    });
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
    const prepared = await this.prepareGeneration(partialConfig);
    if ('error' in prepared) {
      return prepared.error;
    }

    const { runtimeConfig, outputPath, openAPI } = prepared;

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
      'api.ts': clientContent,
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

  async runGenerateTypes(
    partialConfig: Partial<Pick<Config, 'adapter' | 'baseURL' | 'outputPath'>> = {}
  ): Promise<ExtensionToUIMessage> {
    const prepared = await this.prepareGeneration(partialConfig);
    if ('error' in prepared) {
      return prepared.error;
    }

    const { outputPath, openAPI } = prepared;

    const typesContent = this.typeGenerator.createTypes(openAPI.schemas, openAPI.operations);
    const generationResult = await this.writeArtifacts(outputPath, {
      'types.ts': typesContent,
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

    return {
      type: 'generate:success',
      payload: {
        files: generationResult.files,
        warnings: generationResult.warnings,
      },
    };
  }

  private async prepareGeneration(
    partialConfig: Partial<Pick<Config, 'adapter' | 'baseURL' | 'outputPath'>>
  ): Promise<
    | { error: ExtensionToUIMessage }
    | { runtimeConfig: Config; outputPath: string; openAPI: OpenAPI }
  > {
    const currentConfig = await this.configManager.getConfig();
    const runtimeConfig: Config = {
      ...currentConfig,
      baseURL: this.normalizeOptionalString(partialConfig.baseURL) ?? currentConfig.baseURL,
      outputPath: this.normalizeOptionalString(partialConfig.outputPath) ?? currentConfig.outputPath,
      adapter: this.normalizeAdapter(partialConfig.adapter ?? currentConfig.adapter),
    };

    if (!runtimeConfig.openAPI) {
      return {
        error: {
          type: 'generate:error',
          payload: {
            errors: ['No OpenAPI data found. Import a specification before generating SDK files.'],
          },
        },
      };
    }

    const outputPath =
      this.normalizeOptionalString(runtimeConfig.outputPath) ?? join(this.workspaceRoot, 'generated-sdk');

    const resolvedOperations = this.operationNameResolver.resolveAll(runtimeConfig.openAPI.operations);
    const openAPI: OpenAPI = {
      ...runtimeConfig.openAPI,
      operations: resolvedOperations,
    };

    return { runtimeConfig, outputPath, openAPI };
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
    const exports = ["export * from './types';", "export * from './transport';", "export * from './api';"];

    if (adapter === 'react-query') {
      exports.push("export * from './react-query';");
    }

    return `${exports.join('\n')}\n`;
  }
}
