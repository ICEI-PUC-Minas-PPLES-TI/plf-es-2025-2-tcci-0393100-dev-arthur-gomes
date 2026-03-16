import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { OpenAPIModel } from '../../models/openapi';
import type { ImportOpenAPIResult } from '../../models/results';
import { OperationNameResolver } from '../generators/OperationNameResolver';
import { PathParser } from './PathParser';
import { SchemaParser } from './SchemaParser';
import { OpenAPIValidator } from './OpenAPIValidator';

interface FetchResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

type Fetcher = (url: string) => Promise<FetchResponseLike>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function defaultFetcher(url: string): Promise<FetchResponseLike> {
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API is not available in this runtime.');
  }

  return fetch(url);
}

export class OpenAPILoader {
  constructor(
    private readonly validator: OpenAPIValidator,
    private readonly pathParser: PathParser,
    private readonly schemaParser: SchemaParser,
    private readonly operationNameResolver: OperationNameResolver,
    private readonly fetcher: Fetcher = defaultFetcher
  ) {}

  async importOpenAPI(pathOrUrl: string): Promise<ImportOpenAPIResult> {
    if (!pathOrUrl.trim()) {
      return {
        success: false,
        errors: ['OpenAPI source cannot be empty.'],
      };
    }

    try {
      const source = pathOrUrl.trim();
      const content = this.isUrl(source)
        ? await this.loadFromUrl(source)
        : await this.loadFromFile(source);
      const document = this.parseDocument(content, source);
      const validation = this.validator.validate(document);

      if (!validation.valid) {
        return {
          success: false,
          warnings: validation.warnings,
          errors: validation.errors,
        };
      }

      const record = asRecord(document) ?? {};
      const components = asRecord(record.components);
      const schemas = this.schemaParser.parseSchemas(asRecord(components?.schemas));
      const operations = this.operationNameResolver.resolveAll(
        this.pathParser.parsePaths(asRecord(record.paths) ?? {})
      );
      const info = asRecord(record.info);

      const openAPI: OpenAPIModel = {
        version: typeof record.openapi === 'string' ? record.openapi : '3.0.0',
        info: info
          ? {
              title: typeof info.title === 'string' ? info.title : undefined,
              version: typeof info.version === 'string' ? info.version : undefined,
            }
          : undefined,
        schemas,
        operations,
        status: 'COMPLETED',
      };

      return {
        success: true,
        openAPI,
        warnings: validation.warnings,
      };
    } catch (error) {
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown OpenAPI import error.'],
      };
    }
  }

  private isUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }

  private async loadFromUrl(url: string): Promise<string> {
    const response = await this.fetcher(url);
    if (!response.ok) {
      throw new Error(`Unable to fetch OpenAPI from URL (HTTP ${response.status}).`);
    }

    return response.text();
  }

  private async loadFromFile(filePath: string): Promise<string> {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      throw new Error(
        `Unable to read OpenAPI file at "${filePath}": ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      );
    }
  }

  private parseDocument(content: string, source: string): unknown {
    const normalizedSource = source.toLowerCase();

    try {
      if (normalizedSource.endsWith('.json')) {
        return JSON.parse(content) as unknown;
      }

      if (normalizedSource.endsWith('.yaml') || normalizedSource.endsWith('.yml')) {
        return parseYaml(content) as unknown;
      }

      try {
        return JSON.parse(content) as unknown;
      } catch {
        return parseYaml(content) as unknown;
      }
    } catch (error) {
      throw new Error(
        `Failed to parse OpenAPI source "${source}": ${
          error instanceof Error ? error.message : 'invalid document content'
        }`
      );
    }
  }
}
