const IDENTIFIER_REPLACEMENT = /[^a-zA-Z0-9_$]+/g;

export function splitToWords(value: string): string[] {
  const normalized = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[{}]/g, ' ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function toPascalCase(value: string): string {
  const words = splitToWords(value);
  if (words.length === 0) {
    return '';
  }

  return words
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

export function toCamelCase(value: string): string {
  const pascal = toPascalCase(value);
  if (!pascal) {
    return '';
  }

  return pascal[0].toLowerCase() + pascal.slice(1);
}

export function sanitizeIdentifier(value: string): string {
  const compact = value.replace(IDENTIFIER_REPLACEMENT, '');
  if (!compact) {
    return 'unnamedOperation';
  }

  if (/^[0-9]/.test(compact)) {
    return `op${compact}`;
  }

  return compact;
}

export function sanitizeOperationId(operationId: string): string {
  return sanitizeIdentifier(toCamelCase(operationId));
}

export function toTypeName(functionName: string): string {
  return sanitizeIdentifier(toPascalCase(functionName));
}
