import type {
  HttpMethod,
  OperationModel,
  OperationRequestBodyModel,
  OperationResponseModel,
  ParameterLocation,
  ParameterModel,
} from '../../models/operation';
import { SchemaParser } from './SchemaParser';

const SUPPORTED_HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];
const PARAMETER_LOCATIONS: ParameterLocation[] = ['path', 'query', 'header', 'cookie'];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const values = value.filter((entry): entry is string => typeof entry === 'string');
  return values.length > 0 ? values : undefined;
}

export class PathParser {
  constructor(private readonly schemaParser: SchemaParser) {}

  parsePaths(paths: Record<string, unknown>): OperationModel[] {
    const operations: OperationModel[] = [];

    for (const [path, rawPathItem] of Object.entries(paths)) {
      const pathItem = asRecord(rawPathItem);
      if (!pathItem) {
        continue;
      }

      const pathLevelParameters = this.parseParameters(pathItem.parameters);

      for (const method of SUPPORTED_HTTP_METHODS) {
        const rawOperation = pathItem[method];
        if (!rawOperation) {
          continue;
        }

        const operationRecord = asRecord(rawOperation);
        if (!operationRecord) {
          continue;
        }

        operations.push(this.extractOperation(path, method, operationRecord, pathLevelParameters));
      }
    }

    return operations;
  }

  private extractOperation(
    path: string,
    method: HttpMethod,
    operation: Record<string, unknown>,
    pathLevelParameters: ParameterModel[]
  ): OperationModel {
    const operationParameters = this.parseParameters(operation.parameters);
    const mergedParameters = this.mergeParameters(pathLevelParameters, operationParameters);

    return {
      operationId: typeof operation.operationId === 'string' ? operation.operationId : undefined,
      functionName: '',
      method,
      path,
      summary: typeof operation.summary === 'string' ? operation.summary : undefined,
      description: typeof operation.description === 'string' ? operation.description : undefined,
      tags: asStringArray(operation.tags),
      parameters: mergedParameters,
      requestBody: this.parseRequestBody(operation.requestBody),
      responses: this.parseResponses(operation.responses),
    };
  }

  private mergeParameters(pathLevel: ParameterModel[], operationLevel: ParameterModel[]): ParameterModel[] {
    const merged = new Map<string, ParameterModel>();

    for (const parameter of pathLevel) {
      merged.set(`${parameter.in}:${parameter.name}`, parameter);
    }

    for (const parameter of operationLevel) {
      merged.set(`${parameter.in}:${parameter.name}`, parameter);
    }

    return [...merged.values()];
  }

  private parseParameters(parametersValue: unknown): ParameterModel[] {
    if (!Array.isArray(parametersValue)) {
      return [];
    }

    const parameters: ParameterModel[] = [];

    for (const rawParameter of parametersValue) {
      const parameter = asRecord(rawParameter);
      if (!parameter) {
        continue;
      }

      if (typeof parameter.$ref === 'string') {
        const inferredName = parameter.$ref.split('/').pop() ?? 'refParameter';
        parameters.push({
          name: inferredName,
          in: 'query',
          required: false,
          ref: parameter.$ref,
        });
        continue;
      }

      const name = parameter.name;
      const parameterIn = parameter.in;

      if (typeof name !== 'string' || typeof parameterIn !== 'string') {
        continue;
      }

      if (!PARAMETER_LOCATIONS.includes(parameterIn as ParameterLocation)) {
        continue;
      }

      const location = parameterIn as ParameterLocation;
      const parsedSchema = this.schemaParser.parseRefOrInline(parameter.schema, `${name}ParamSchema`);

      parameters.push({
        name,
        in: location,
        required: typeof parameter.required === 'boolean' ? parameter.required : location === 'path',
        schema: parsedSchema?.schema,
        ref: parsedSchema?.ref,
      });
    }

    return parameters;
  }

  private parseRequestBody(requestBodyValue: unknown): OperationRequestBodyModel | undefined {
    const requestBody = asRecord(requestBodyValue);
    if (!requestBody) {
      return undefined;
    }

    const contentRecord = asRecord(requestBody.content);
    if (!contentRecord) {
      return undefined;
    }

    const content: OperationRequestBodyModel['content'] = {};

    for (const [mediaType, rawMediaType] of Object.entries(contentRecord)) {
      const mediaTypeObject = asRecord(rawMediaType);
      if (!mediaTypeObject) {
        continue;
      }

      const parsedSchema = this.schemaParser.parseRefOrInline(
        mediaTypeObject.schema,
        `${mediaType.replace(/\W+/g, '')}RequestBody`
      );

      if (parsedSchema) {
        content[mediaType] = parsedSchema;
      }
    }

    if (Object.keys(content).length === 0) {
      return undefined;
    }

    return {
      required: typeof requestBody.required === 'boolean' ? requestBody.required : undefined,
      content,
    };
  }

  private parseResponses(responsesValue: unknown): OperationResponseModel[] {
    const responses = asRecord(responsesValue);
    if (!responses) {
      return [];
    }

    const parsedResponses: OperationResponseModel[] = [];

    for (const [statusCode, rawResponse] of Object.entries(responses)) {
      const response = asRecord(rawResponse);
      if (!response) {
        continue;
      }

      const contentRecord = asRecord(response.content);
      const content: OperationResponseModel['content'] = {};

      if (contentRecord) {
        for (const [mediaType, rawMediaType] of Object.entries(contentRecord)) {
          const mediaTypeObject = asRecord(rawMediaType);
          if (!mediaTypeObject) {
            continue;
          }

          const parsedSchema = this.schemaParser.parseRefOrInline(
            mediaTypeObject.schema,
            `${statusCode}${mediaType.replace(/\W+/g, '')}Response`
          );

          if (parsedSchema) {
            content[mediaType] = parsedSchema;
          }
        }
      }

      parsedResponses.push({
        statusCode,
        description: typeof response.description === 'string' ? response.description : undefined,
        content,
      });
    }

    return parsedResponses;
  }
}
