import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ExtensionController statically imports ConfigManager, which imports 'vscode'.
vi.mock('vscode', () => ({}));

import type { Config } from '../../src/models/config';
import type { OpenAPI } from '../../src/models/openapi';
import type { ImportOpenAPIResult } from '../../src/models/results';
import { ExtensionController } from '../../src/ui/ExtensionController';

const WORKSPACE = '/workspace';

function sampleOpenAPI(): OpenAPI {
  return {
    version: '3.0.0',
    schemas: { User: { name: 'User', type: 'object' } },
    operations: [
      { functionName: '', method: 'get', path: '/users', parameters: [], responses: [] },
    ],
    status: 'COMPLETED',
  };
}

function setup(configOverrides: Partial<Config> = {}) {
  const config: Config = { adapter: 'fetch', ...configOverrides };

  const configManager = {
    getConfig: vi.fn(async () => config),
    mergeConfig: vi.fn(async (partial: Partial<Config>) => ({ ...config, ...partial })),
    setConfig: vi.fn(async () => undefined),
  };
  const openAPILoader = { importOpenAPI: vi.fn() };
  const operationNameResolver = {
    resolveAll: vi.fn((ops: OpenAPI['operations']) =>
      ops.map((o, i) => ({ ...o, functionName: `fn${i}` }))
    ),
  };
  const typeGenerator = { createTypes: vi.fn(() => '// types') };
  const reactQueryGenerator = { generateModule: vi.fn(() => '// rq') };
  const fileWriter = { writeArtifacts: vi.fn(async (_out: string, files: Record<string, string>) => Object.keys(files)) };

  const controller = new ExtensionController(
    configManager as never,
    openAPILoader as never,
    operationNameResolver as never,
    typeGenerator as never,
    reactQueryGenerator as never,
    fileWriter as never,
    WORKSPACE
  );

  return { controller, configManager, openAPILoader, operationNameResolver, typeGenerator, reactQueryGenerator, fileWriter, config };
}

beforeEach(() => vi.clearAllMocks());

describe('getUIConfig', () => {
  it('maps config and reports hasOpenAPI + adapter options', async () => {
    const { controller } = setup({ baseURL: 'https://x', importPath: '/spec', openAPI: sampleOpenAPI() });
    const ui = await controller.getUIConfig();

    expect(ui).toMatchObject({
      baseURL: 'https://x',
      adapter: 'fetch',
      importPath: '/spec',
      hasOpenAPI: true,
      adapterOptions: ['fetch', 'axios', 'react-query'],
    });
  });

  it('reports hasOpenAPI false when no spec loaded', async () => {
    const { controller } = setup();
    expect((await controller.getUIConfig()).hasOpenAPI).toBe(false);
  });
});

describe('updateConfig normalization', () => {
  it('trims/empties baseURL and outputPath and omits adapter when not supplied', async () => {
    const { controller, configManager } = setup();
    await controller.updateConfig({ baseURL: '  ', outputPath: '  /out  ', adapter: undefined });

    expect(configManager.mergeConfig).toHaveBeenCalledWith({
      baseURL: undefined,
      outputPath: '/out',
    });
  });

  it('does not reset the adapter when only the base URL changes', async () => {
    const { controller, configManager } = setup();
    await controller.setBaseUrl('https://api');

    const [arg] = configManager.mergeConfig.mock.calls[0];
    expect(arg).toEqual({ baseURL: 'https://api' });
    expect(arg).not.toHaveProperty('adapter');
  });

  it('preserves axios and react-query adapters', async () => {
    const { controller, configManager } = setup();
    await controller.setDefaultAdapter('axios');
    expect(configManager.mergeConfig).toHaveBeenCalledWith(expect.objectContaining({ adapter: 'axios' }));

    await controller.setDefaultAdapter('react-query');
    expect(configManager.mergeConfig).toHaveBeenCalledWith(expect.objectContaining({ adapter: 'react-query' }));
  });
});

describe('reloadOpenAPI', () => {
  it('errors when there is no importPath', async () => {
    const { controller } = setup();
    const result = await controller.reloadOpenAPI();
    expect(result).toEqual({ type: 'import:error', payload: { errors: ['No OpenAPI source to reload.'] } });
  });

  it('delegates to runImportOpenAPI when importPath exists', async () => {
    const { controller, openAPILoader } = setup({ importPath: '/spec.yaml', baseURL: 'https://x' });
    openAPILoader.importOpenAPI.mockResolvedValue({ success: true, openAPI: sampleOpenAPI() } as ImportOpenAPIResult);

    const result = await controller.reloadOpenAPI();
    expect(openAPILoader.importOpenAPI).toHaveBeenCalledWith('/spec.yaml');
    expect(result.type).toBe('import:success');
  });
});

describe('runImportOpenAPI', () => {
  it('rejects an empty source', async () => {
    const { controller } = setup();
    const result = await controller.runImportOpenAPI('   ');
    expect(result).toEqual({ type: 'import:error', payload: { errors: ['OpenAPI source cannot be empty.'] } });
  });

  it('surfaces loader failure errors and warnings', async () => {
    const { controller, openAPILoader } = setup();
    openAPILoader.importOpenAPI.mockResolvedValue({ success: false, errors: ['bad'], warnings: ['w'] });

    const result = await controller.runImportOpenAPI('/spec');
    expect(result).toEqual({ type: 'import:error', payload: { errors: ['bad'], warnings: ['w'] } });
  });

  it('falls back to a default error when success is true but openAPI is undefined', async () => {
    const { controller, openAPILoader } = setup();
    openAPILoader.importOpenAPI.mockResolvedValue({ success: true, openAPI: undefined });

    const result = await controller.runImportOpenAPI('/spec');
    expect(result).toEqual({
      type: 'import:error',
      payload: { errors: ['Failed to import OpenAPI source.'], warnings: undefined },
    });
  });

  it('persists trimmed source + openAPI and reports counts on success', async () => {
    const { controller, openAPILoader, configManager } = setup();
    openAPILoader.importOpenAPI.mockResolvedValue({ success: true, openAPI: sampleOpenAPI(), warnings: ['w'] });

    const result = await controller.runImportOpenAPI('  /spec.yaml  ');

    expect(openAPILoader.importOpenAPI).toHaveBeenCalledWith('/spec.yaml');
    expect(configManager.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ importPath: '/spec.yaml', openAPI: expect.any(Object) })
    );
    expect(result).toEqual({
      type: 'import:success',
      payload: { operations: 1, schemas: 1, warnings: ['w'] },
    });
  });
});

describe('runGenerateMethods', () => {
  it('errors when no OpenAPI is loaded', async () => {
    const { controller } = setup();
    const result = await controller.runGenerateMethods();
    expect(result.type).toBe('generate:error');
    expect(result.payload).toMatchObject({ errors: [expect.stringContaining('No OpenAPI data found')] });
  });

  it('writes exactly types/transport/api/index for the fetch adapter', async () => {
    const { controller, fileWriter, reactQueryGenerator } = setup({ openAPI: sampleOpenAPI(), outputPath: '/out' });
    const result = await controller.runGenerateMethods();

    const [outPath, files] = fileWriter.writeArtifacts.mock.calls[0];
    expect(outPath).toBe('/out');
    expect(Object.keys(files)).toEqual(['types.ts', 'transport.ts', 'api.ts', 'index.ts']);
    expect(reactQueryGenerator.generateModule).not.toHaveBeenCalled();
    expect(result.type).toBe('generate:success');
  });

  it('adds react-query.ts for the react-query adapter', async () => {
    const { controller, fileWriter, reactQueryGenerator } = setup({ openAPI: sampleOpenAPI(), adapter: 'react-query', outputPath: '/out' });
    await controller.runGenerateMethods();

    const files = fileWriter.writeArtifacts.mock.calls[0][1];
    expect(Object.keys(files)).toContain('react-query.ts');
    expect(reactQueryGenerator.generateModule).toHaveBeenCalled();
  });

  it('passes resolved operations to the generators', async () => {
    const { controller, typeGenerator, operationNameResolver } = setup({ openAPI: sampleOpenAPI(), outputPath: '/out' });
    await controller.runGenerateMethods();

    expect(operationNameResolver.resolveAll).toHaveBeenCalled();
    const [, operations] = typeGenerator.createTypes.mock.calls[0];
    expect(operations[0].functionName).toBe('fn0');
  });

  it('defaults outputPath to <workspace>/generated-sdk', async () => {
    const { controller, fileWriter } = setup({ openAPI: sampleOpenAPI() });
    await controller.runGenerateMethods();
    expect(fileWriter.writeArtifacts.mock.calls[0][0]).toBe(join(WORKSPACE, 'generated-sdk'));
  });

  it('maps a FileWriter throw to generate:error with the Error message', async () => {
    const { controller, fileWriter } = setup({ openAPI: sampleOpenAPI(), outputPath: '/out' });
    fileWriter.writeArtifacts.mockRejectedValue(new Error('disk full'));

    const result = await controller.runGenerateMethods();
    expect(result).toEqual({ type: 'generate:error', payload: { errors: ['disk full'], warnings: undefined } });
  });

  it('maps a non-Error throw to the generic file-writing message', async () => {
    const { controller, fileWriter } = setup({ openAPI: sampleOpenAPI(), outputPath: '/out' });
    fileWriter.writeArtifacts.mockRejectedValue('nope');

    const result = await controller.runGenerateMethods();
    expect(result.payload).toMatchObject({ errors: ['Unknown file writing error.'] });
  });
});

describe('runGenerateTypes', () => {
  it('writes only types.ts and skips SDK/RQ generation', async () => {
    const { controller, fileWriter, reactQueryGenerator } = setup({ openAPI: sampleOpenAPI(), outputPath: '/out' });
    const result = await controller.runGenerateTypes();

    const files = fileWriter.writeArtifacts.mock.calls[0][1];
    expect(Object.keys(files)).toEqual(['types.ts']);
    expect(reactQueryGenerator.generateModule).not.toHaveBeenCalled();
    expect(result.type).toBe('generate:success');
  });
});
