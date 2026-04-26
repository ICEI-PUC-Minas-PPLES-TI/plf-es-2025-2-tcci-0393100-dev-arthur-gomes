import type { OperationResponseModel } from '../models/operation';
import { toTypeName } from './naming';

export function pathParamsTypeName(functionName: string): string {
  return `${toTypeName(functionName)}PathParams`;
}

export function queryParamsTypeName(functionName: string): string {
  return `${toTypeName(functionName)}QueryParams`;
}

export function headerParamsTypeName(functionName: string): string {
  return `${toTypeName(functionName)}HeaderParams`;
}

export function cookieParamsTypeName(functionName: string): string {
  return `${toTypeName(functionName)}CookieParams`;
}

export function requestBodyTypeName(functionName: string): string {
  return `${toTypeName(functionName)}RequestBody`;
}

export function operationArgsTypeName(functionName: string): string {
  return `${toTypeName(functionName)}RequestArgs`;
}

export function responseTypeName(functionName: string, statusCode: string): string {
  return `${toTypeName(functionName)}Response${statusCode.replace(/[^0-9A-Za-z]/g, '')}`;
}

export function pickPrimaryResponseStatus(responses: OperationResponseModel[]): string | undefined {
  const priority = ['200', '201', '204'];

  for (const preferred of priority) {
    if (responses.some((response) => response.statusCode === preferred)) {
      return preferred;
    }
  }

  const first2xx = responses.find((response) => /^2\d\d$/.test(response.statusCode));
  if (first2xx) {
    return first2xx.statusCode;
  }

  return responses[0]?.statusCode;
}
