import { vi } from 'vitest';

/**
 * Shared vscode API surface stub for host-side unit tests. Import the pieces you
 * need and pass this object to `vi.mock('vscode', () => createVscodeMock())`, or
 * spread it and override specific members.
 *
 * NOTE: `vi.mock` is hoisted above imports, so the factory must not reference
 * outer-scope variables that are initialised later. Call this INSIDE the factory
 * (or build the mock with `vi.hoisted`) to stay hoist-safe.
 */
export function createVscodeMock() {
  return {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Uri: {
      file: vi.fn((p: string) => ({ fsPath: p, path: p, scheme: 'file' })),
      parse: vi.fn((p: string) => ({ fsPath: p, path: p })),
    },
    commands: {
      executeCommand: vi.fn(),
      registerCommand: vi.fn(),
    },
    window: {
      createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() })),
      showInputBox: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showOpenDialog: vi.fn(),
      registerWebviewViewProvider: vi.fn(),
    },
    workspace: {
      workspaceFolders: undefined as unknown[] | undefined,
      getConfiguration: vi.fn(() => ({ inspect: vi.fn(), update: vi.fn() })),
    },
  };
}
