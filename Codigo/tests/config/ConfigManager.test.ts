import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterKind, Config } from '../../src/models/config';

const mocks = vi.hoisted(() => {
  const inspect = vi.fn();
  const updateSetting = vi.fn();
  const getConfiguration = vi.fn(() => ({
    inspect,
    update: updateSetting,
  }));
  const workspaceState = {
    get: vi.fn(),
    update: vi.fn(),
  };

  return {
    inspect,
    updateSetting,
    getConfiguration,
    workspaceState,
  };
});

vi.mock('vscode', () => ({
  ConfigurationTarget: { Workspace: 1 },
  workspace: {
    workspaceFolders: [{}],
    getConfiguration: mocks.getConfiguration,
  },
}));

import { ConfigManager } from '../../src/services/config/ConfigManager';

beforeEach(() => {
  mocks.inspect.mockReset();
  mocks.updateSetting.mockReset();
  mocks.getConfiguration.mockClear();
  mocks.workspaceState.get.mockReset();
  mocks.workspaceState.update.mockReset();
});

describe('ConfigManager', () => {
  it('reads the adapter from workspace settings when nothing is stored yet', async () => {
    mocks.workspaceState.get.mockReturnValue(undefined);
    mocks.inspect.mockImplementation((key: string) => {
      const values: Record<string, string | undefined> = {
        importPath: '/specs/openapi.yaml',
        outputPath: '/workspace/sdk',
        baseURL: 'https://api.example.com',
        adapter: 'axios',
      };

      return {
        workspaceValue: values[key],
        workspaceFolderValue: values[key],
      };
    });

    const manager = new ConfigManager(mocks.workspaceState as never, '/workspace/default-sdk');
    const config = await manager.getConfig();

    expect(config).toMatchObject<Partial<Config>>({
      importPath: '/specs/openapi.yaml',
      outputPath: '/workspace/sdk',
      baseURL: 'https://api.example.com',
      adapter: 'axios' satisfies AdapterKind,
    });
  });

  it('persists the selected adapter to workspace state and settings', async () => {
    mocks.workspaceState.get.mockReturnValue(undefined);
    mocks.inspect.mockReturnValue(undefined);
    mocks.workspaceState.update.mockResolvedValue(undefined);
    mocks.updateSetting.mockResolvedValue(undefined);

    const manager = new ConfigManager(mocks.workspaceState as never, '/workspace/default-sdk');

    await manager.setConfig({
      adapter: 'axios',
      baseURL: 'https://api.example.com',
      outputPath: '/workspace/sdk',
      importPath: '/specs/openapi.yaml',
    });

    expect(mocks.workspaceState.update).toHaveBeenCalledWith(
      'plf-es-extension.config',
      expect.objectContaining({
        adapter: 'axios',
        outputPath: '/workspace/sdk',
      })
    );

    expect(mocks.updateSetting).toHaveBeenCalledWith('adapter', 'axios', 1);
    expect(mocks.updateSetting).toHaveBeenCalledWith('outputPath', '/workspace/sdk', 1);
  });

  it('normalizes and persists react-query as a supported adapter', async () => {
    mocks.workspaceState.get.mockReturnValue(undefined);
    mocks.inspect.mockReturnValue(undefined);
    mocks.workspaceState.update.mockResolvedValue(undefined);
    mocks.updateSetting.mockResolvedValue(undefined);

    const manager = new ConfigManager(mocks.workspaceState as never, '/workspace/default-sdk');

    await manager.setConfig({
      adapter: 'react-query',
      outputPath: '/workspace/sdk',
    });

    expect(mocks.workspaceState.update).toHaveBeenCalledWith(
      'plf-es-extension.config',
      expect.objectContaining({
        adapter: 'react-query' satisfies AdapterKind,
      })
    );

    expect(mocks.updateSetting).toHaveBeenCalledWith('adapter', 'react-query', 1);
  });
});
