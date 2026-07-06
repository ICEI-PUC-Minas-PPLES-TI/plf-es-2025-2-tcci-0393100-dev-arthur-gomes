import ts from 'typescript';

/**
 * Compile-check harness for generated SDK output.
 *
 * Two tiers:
 *  - transpileCheck: cheap per-file syntactic smoke via ts.transpileModule.
 *  - programCheck: real cross-module type-check via ts.createProgram over an
 *    in-memory CompilerHost, with virtual .d.ts stubs for axios / @tanstack.
 *
 * NOT collected as a spec (filename has no .test suffix).
 */

const VIRTUAL_DIR = '/virtual';

const AXIOS_STUB = `
declare interface AxiosResponse<T = unknown> { status: number; data: T; }
declare interface AxiosRequestConfig {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  data?: unknown;
  validateStatus?: (status: number) => boolean;
}
declare const axios: {
  request<T = unknown>(config: AxiosRequestConfig): Promise<AxiosResponse<T>>;
};
export default axios;
`;

const REACT_QUERY_STUB = `
export interface UseQueryOptions<TData = unknown, TError = unknown, TSelect = TData, TKey = unknown> {
  queryKey?: TKey;
  queryFn?: (...args: any[]) => any;
  [key: string]: unknown;
}
export interface UseMutationOptions<TData = unknown, TError = unknown, TVars = unknown> {
  mutationKey?: unknown;
  mutationFn?: (...args: any[]) => any;
  [key: string]: unknown;
}
export declare function queryOptions<T extends object>(options: T): T;
export declare function mutationOptions<T extends object>(options: T): T;
export declare function useQuery(options: unknown): unknown;
export declare function useMutation(options: unknown): unknown;
`;

const DEFAULT_OPTIONS: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2020,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  // DOM is mandatory: transport.ts uses global fetch + URLSearchParams.
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
};

export interface CompileResult {
  ok: boolean;
  diagnostics: ts.Diagnostic[];
  codes: number[];
  messages: string[];
}

/** Tier A — syntactic smoke test on a single generated file. */
export function transpileCheck(source: string): CompileResult {
  const output = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });

  const diagnostics = (output.diagnostics ?? []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );

  return toResult(diagnostics);
}

/** Tier B — whole-bundle type-check of the generated files together. */
export function programCheck(files: Record<string, string>): CompileResult {
  const virtualFiles = new Map<string, string>();
  for (const [name, content] of Object.entries(files)) {
    virtualFiles.set(`${VIRTUAL_DIR}/${name}`, content);
  }
  virtualFiles.set(`${VIRTUAL_DIR}/node_modules/axios/index.d.ts`, AXIOS_STUB);
  virtualFiles.set(
    `${VIRTUAL_DIR}/node_modules/@tanstack/react-query/index.d.ts`,
    REACT_QUERY_STUB
  );

  const baseHost = ts.createCompilerHost(DEFAULT_OPTIONS, true);

  const host: ts.CompilerHost = {
    ...baseHost,
    fileExists: (fileName) =>
      virtualFiles.has(fileName) || baseHost.fileExists(fileName),
    readFile: (fileName) =>
      virtualFiles.get(fileName) ?? baseHost.readFile(fileName),
    getSourceFile: (fileName, languageVersion, onError, shouldCreate) => {
      const virtual = virtualFiles.get(fileName);
      if (virtual !== undefined) {
        return ts.createSourceFile(fileName, virtual, languageVersion, true);
      }
      return baseHost.getSourceFile(fileName, languageVersion, onError, shouldCreate);
    },
    resolveModuleNames: (moduleNames, containingFile) =>
      moduleNames.map((name) => resolveModule(name, containingFile, virtualFiles)),
  };

  const rootNames = Object.keys(files).map((name) => `${VIRTUAL_DIR}/${name}`);
  const program = ts.createProgram(rootNames, DEFAULT_OPTIONS, host);

  const diagnostics = [
    ...program.getSyntacticDiagnostics(),
    ...program.getSemanticDiagnostics(),
  ];

  return toResult(diagnostics);
}

function resolveModule(
  name: string,
  containingFile: string,
  virtualFiles: Map<string, string>
): ts.ResolvedModule | undefined {
  if (name.startsWith('.')) {
    const dir = containingFile.slice(0, containingFile.lastIndexOf('/'));
    const stripped = name.replace(/^\.\//, '');
    const resolvedFileName = `${dir}/${stripped}.ts`;
    if (virtualFiles.has(resolvedFileName)) {
      return { resolvedFileName };
    }
    return undefined;
  }

  if (name === 'axios') {
    return {
      resolvedFileName: `${VIRTUAL_DIR}/node_modules/axios/index.d.ts`,
      isExternalLibraryImport: true,
    };
  }

  if (name === '@tanstack/react-query') {
    return {
      resolvedFileName: `${VIRTUAL_DIR}/node_modules/@tanstack/react-query/index.d.ts`,
      isExternalLibraryImport: true,
    };
  }

  return undefined;
}

function toResult(diagnostics: readonly ts.Diagnostic[]): CompileResult {
  return {
    ok: diagnostics.length === 0,
    diagnostics: [...diagnostics],
    codes: diagnostics.map((d) => d.code),
    messages: diagnostics.map((d) =>
      ts.flattenDiagnosticMessageText(d.messageText, '\n')
    ),
  };
}
