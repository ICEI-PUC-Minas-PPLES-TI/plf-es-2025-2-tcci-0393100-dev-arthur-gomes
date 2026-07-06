import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const commandCallbacks = new Map<string, () => Promise<void>>();
  return {
    commandCallbacks,
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
    showInputBox: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommand: vi.fn((id: string, cb: () => Promise<void>) => {
      commandCallbacks.set(id, cb);
      return { id, dispose: vi.fn() };
    }),
    workspaceFolders: undefined as Array<{ uri: { fsPath: string } }> | undefined,
    // Controller/provider instances captured from the mocked constructors.
    controller: {
      runImportOpenAPI: vi.fn(),
      runGenerateMethods: vi.fn(),
    },
    provider: {
      postMessage: vi.fn(async () => undefined),
      pushConfig: vi.fn(async () => undefined),
      changeToExtensionTab: vi.fn(async () => undefined),
    },
  };
});

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: mocks.createOutputChannel,
    showInputBox: mocks.showInputBox,
    showInformationMessage: mocks.showInformationMessage,
    showErrorMessage: mocks.showErrorMessage,
    registerWebviewViewProvider: mocks.registerWebviewViewProvider,
  },
  commands: { registerCommand: mocks.registerCommand },
  get workspace() {
    return { workspaceFolders: mocks.workspaceFolders };
  },
}));

vi.mock('../src/ui/ExtensionController', () => ({
  ExtensionController: class {
    constructor() {
      return mocks.controller;
    }
  },
}));

vi.mock('../src/ui/SidebarViewProvider', () => ({
  SidebarViewProvider: class {
    static viewType = 'plf-es-view';
    constructor() {
      return mocks.provider;
    }
  },
}));

// The remaining service constructors are cheap/pure; let them run for real.
import { activate, deactivate } from '../src/extension';

function createContext() {
  return {
    subscriptions: [] as unknown[],
    workspaceState: { get: vi.fn(), update: vi.fn() },
    extensionUri: { fsPath: '/ext' },
    globalStorageUri: { fsPath: '/global-storage' },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.commandCallbacks.clear();
  mocks.workspaceFolders = undefined;
});

describe('activate', () => {
  it('creates the output channel and logs activation', () => {
    activate(createContext());
    expect(mocks.createOutputChannel).toHaveBeenCalledWith('Swagger to SDK');
  });

  it('registers the webview provider under the view type', () => {
    activate(createContext());
    expect(mocks.registerWebviewViewProvider).toHaveBeenCalledWith('plf-es-view', mocks.provider);
  });

  it('registers exactly three commands', () => {
    activate(createContext());
    expect([...mocks.commandCallbacks.keys()]).toEqual([
      'plf-es-extension.importOpenAPI',
      'plf-es-extension.generateSDK',
      'plf-es-extension.changeToExtensionTab',
    ]);
  });

  it('pushes five disposables across the two push calls', () => {
    const context = createContext();
    activate(context);
    expect(context.subscriptions).toHaveLength(5);
  });

  it('uses the first workspace folder path when present', () => {
    mocks.workspaceFolders = [{ uri: { fsPath: '/repo' } }];
    // No direct assertion hook on the path; smoke-check activation still succeeds.
    expect(() => activate(createContext())).not.toThrow();
  });
});

describe('import command', () => {
  it('aborts when the input box is dismissed (undefined or empty)', async () => {
    activate(createContext());
    const importCmd = mocks.commandCallbacks.get('plf-es-extension.importOpenAPI')!;

    mocks.showInputBox.mockResolvedValueOnce(undefined);
    await importCmd();
    mocks.showInputBox.mockResolvedValueOnce('');
    await importCmd();

    expect(mocks.controller.runImportOpenAPI).not.toHaveBeenCalled();
  });

  it('imports, posts the result, pushes config and shows the success toast', async () => {
    activate(createContext());
    const importCmd = mocks.commandCallbacks.get('plf-es-extension.importOpenAPI')!;

    mocks.showInputBox.mockResolvedValueOnce('/spec.yaml');
    mocks.controller.runImportOpenAPI.mockResolvedValueOnce({
      type: 'import:success',
      payload: { operations: 3, schemas: 2 },
    });

    await importCmd();

    expect(mocks.controller.runImportOpenAPI).toHaveBeenCalledWith('/spec.yaml');
    expect(mocks.provider.postMessage).toHaveBeenCalled();
    expect(mocks.provider.pushConfig).toHaveBeenCalled();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      'OpenAPI imported successfully (3 operations, 2 schemas).'
    );
  });

  it('joins import errors with " | "', async () => {
    activate(createContext());
    const importCmd = mocks.commandCallbacks.get('plf-es-extension.importOpenAPI')!;

    mocks.showInputBox.mockResolvedValueOnce('/spec.yaml');
    mocks.controller.runImportOpenAPI.mockResolvedValueOnce({
      type: 'import:error',
      payload: { errors: ['a', 'b'] },
    });

    await importCmd();
    expect(mocks.showErrorMessage).toHaveBeenCalledWith('OpenAPI import failed: a | b');
  });
});

describe('generate command', () => {
  it('joins generated files with ", " on success', async () => {
    activate(createContext());
    const generateCmd = mocks.commandCallbacks.get('plf-es-extension.generateSDK')!;

    mocks.controller.runGenerateMethods.mockResolvedValueOnce({
      type: 'generate:success',
      payload: { files: ['types.ts', 'api.ts'] },
    });

    await generateCmd();
    expect(mocks.showInformationMessage).toHaveBeenCalledWith('SDK generated: types.ts, api.ts');
  });
});

describe('changeToExtensionTab command', () => {
  it('delegates to the sidebar provider', async () => {
    activate(createContext());
    const cmd = mocks.commandCallbacks.get('plf-es-extension.changeToExtensionTab')!;
    await cmd();
    expect(mocks.provider.changeToExtensionTab).toHaveBeenCalled();
  });
});

describe('deactivate', () => {
  it('is a no-op that does not throw', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
