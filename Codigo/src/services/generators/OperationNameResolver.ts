import type { OperationModel } from '../../models/operation';
import { sanitizeIdentifier, sanitizeOperationId, toPascalCase } from '../../utils/naming';

export class OperationNameResolver {
  resolve(operation: Pick<OperationModel, 'operationId' | 'method' | 'path'>): string {
    if (operation.operationId) {
      return sanitizeOperationId(operation.operationId);
    }

    let name = operation.method.toLowerCase();

    const segments = operation.path.split('/').filter(Boolean);
    for (const segment of segments) {
      const paramMatch = segment.match(/^\{(.+)\}$/);
      if (paramMatch) {
        name += `By${toPascalCase(paramMatch[1])}`;
        continue;
      }

      name += toPascalCase(segment);
    }

    return sanitizeIdentifier(name);
  }

  resolveAll(operations: OperationModel[]): OperationModel[] {
    const occurrences = new Map<string, number>();

    return operations.map((operation) => {
      const baseName = this.resolve(operation);
      const count = occurrences.get(baseName) ?? 0;
      occurrences.set(baseName, count + 1);

      const functionName = count === 0 ? baseName : `${baseName}${count + 1}`;

      return {
        ...operation,
        functionName,
      };
    });
  }
}
