const SUPPORTED_HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const KNOWN_HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
]);

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

export class OpenAPIValidator {
  validate(document: unknown): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const record = asRecord(document);
    if (!record) {
      return {
        valid: false,
        errors: ['OpenAPI document must be a JSON or YAML object.'],
        warnings,
      };
    }

    const openapiVersion = record.openapi;
    if (typeof openapiVersion !== 'string' || !openapiVersion.startsWith('3.')) {
      errors.push('Only OpenAPI 3.x documents are supported in this version.');
    }

    const paths = asRecord(record.paths);
    if (!paths || Object.keys(paths).length === 0) {
      errors.push('OpenAPI document must include a non-empty "paths" object.');
    }

    if (paths) {
      for (const [path, pathItemValue] of Object.entries(paths)) {
        const pathItem = asRecord(pathItemValue);
        if (!pathItem) {
          warnings.push(`Ignoring invalid path item at "${path}".`);
          continue;
        }

        for (const method of Object.keys(pathItem)) {
          const normalized = method.toLowerCase();
          if (!KNOWN_HTTP_METHODS.has(normalized)) {
            continue;
          }

          if (!SUPPORTED_HTTP_METHODS.has(normalized)) {
            warnings.push(
              `Method "${method.toUpperCase()} ${path}" is not supported in V1 and will be ignored.`
            );
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }
}
