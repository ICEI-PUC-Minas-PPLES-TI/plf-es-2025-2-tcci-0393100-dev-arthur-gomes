import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showOpenDialog: vi.fn(),
  uriFile: vi.fn((p: string) => ({ fsPath: p, path: p, scheme: 'file' })),
}));

vi.mock('vscode', () => ({
  commands: { executeCommand: mocks.executeCommand },
  window: { showOpenDialog: mocks.showOpenDialog },
  Uri: { file: mocks.uriFile },
}));

import type { UIToExtensionMessage } from '../../src/ui/messages';
import { SidebarViewProvider } from '../../src/ui/SidebarViewProvider';

function createController() {
  return {
    getUIConfig: vi.fn(async () => ({ adapter: 'fetch', hasOpenAPI: false, adapterOptions: [] })),
    getConfig: vi.fn(async () => ({ adapter: 'fetch' as const })),
    updateConfig: vi.fn(async () => ({ adapter: 'fetch' as const })),
    setBaseUrl: vi.fn(async () => ({ adapter: 'fetch' as const })),
    setDefaultAdapter: vi.fn(async () => ({ adapter: 'fetch' as const })),
    setOutputPath: vi.fn(async () => ({ adapter: 'fetch' as const })),
    runImportOpenAPI: vi.fn(async () => ({ type: 'import:success', payload: { operations: 0, schemas: 0 } })),
    runGenerateMethods: vi.fn(async () => ({ type: 'generate:success', payload: { files: [] } })),
    runGenerateTypes: vi.fn(async () => ({ type: 'generate:success', payload: { files: [] } })),
    reloadOpenAPI: vi.fn(async () => ({ type: 'import:success', payload: { operations: 0, schemas: 0 } })),
  };
}

function createView() {
  const postMessage = vi.fn(async () => true);
  let handler: ((m: UIToExtensionMessage) => Promise<void>) | undefined;
  const webview = {
    cspSource: 'vscode-webview://csp',
    options: {},
    html: '',
    postMessage,
    onDidReceiveMessage: vi.fn((cb: (m: UIToExtensionMessage) => Promise<void>) => {
      handler = cb;
    }),
  };
  return { view: { webview } as never, postMessage, dispatch: (m: UIToExtensionMessage) => handler!(m), getHtml: () => webview.html };
}

function setup() {
  const controller = createController();
  const outputChannel = { appendLine: vi.fn() };
  const provider = new SidebarViewProvider(
    { fsPath: '/ext' } as never,
    controller as never,
    outputChannel as never,
    '/workspace'
  );
  return { provider, controller, outputChannel };
}

beforeEach(() => vi.clearAllMocks());

describe('view guards', () => {
  it('postMessage/pushConfig are no-ops before the view resolves', async () => {
    const { provider, controller } = setup();
    await provider.postMessage({ type: 'ext:focusStep', payload: { step: 1 } });
    await provider.pushConfig();
    expect(controller.getUIConfig).not.toHaveBeenCalled();
  });
});

describe('resolveWebviewView', () => {
  it('wires options/html/listener and pushes config once', async () => {
    const { provider, controller } = setup();
    const { view, postMessage } = createView();

    provider.resolveWebviewView(view, {} as never, {} as never);
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.getUIConfig).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'config:loaded' }));
  });

  it('injects cspSource and a 32-char nonce that matches the script tag, unique per resolve', () => {
    const { provider } = setup();
    const a = createView();
    provider.resolveWebviewView(a.view, {} as never, {} as never);
    const htmlA = a.getHtml();

    const nonceMatch = htmlA.match(/script-src 'nonce-([A-Za-z0-9]+)'/);
    expect(nonceMatch).not.toBeNull();
    const nonce = nonceMatch![1];
    expect(nonce).toHaveLength(32);
    expect(htmlA).toContain(`<script nonce="${nonce}">`);
    expect(htmlA).toContain('vscode-webview://csp');

    const b = createView();
    provider.resolveWebviewView(b.view, {} as never, {} as never);
    const nonceB = b.getHtml().match(/script-src 'nonce-([A-Za-z0-9]+)'/)![1];
    expect(nonceB).not.toBe(nonce);
  });
});

describe('handleMessage dispatch', () => {
  async function resolvedProvider() {
    const ctx = setup();
    const view = createView();
    ctx.provider.resolveWebviewView(view.view, {} as never, {} as never);
    await Promise.resolve();
    ctx.controller.getUIConfig.mockClear();
    view.postMessage.mockClear();
    return { ...ctx, ...view };
  }

  it('ui:ready pushes config', async () => {
    const { dispatch, controller } = await resolvedProvider();
    await dispatch({ type: 'ui:ready' });
    expect(controller.getUIConfig).toHaveBeenCalled();
  });

  it('ui:log routes info vs error to the output channel', async () => {
    const { dispatch, outputChannel } = await resolvedProvider();
    await dispatch({ type: 'ui:log', payload: { level: 'info', message: 'hi' } });
    await dispatch({ type: 'ui:log', payload: { level: 'error', message: 'boom' } });
    expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[info] Webview: hi'));
    expect(outputChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[error] Webview: boom'));
  });

  it('ui:updateConfig forwards fields then pushes config', async () => {
    const { dispatch, controller } = await resolvedProvider();
    await dispatch({ type: 'ui:updateConfig', payload: { baseURL: 'b', adapter: 'axios', outputPath: 'o' } });
    expect(controller.updateConfig).toHaveBeenCalledWith({ baseURL: 'b', adapter: 'axios', outputPath: 'o' });
    expect(controller.getUIConfig).toHaveBeenCalled();
  });

  it('ui:pickOutputPath uses payload path over config path over workspace root', async () => {
    const { dispatch, controller } = await resolvedProvider();
    mocks.showOpenDialog.mockResolvedValue([{ fsPath: '/picked' }]);

    await dispatch({ type: 'ui:pickOutputPath', payload: { currentPath: '/from-payload' } });
    expect(mocks.uriFile).toHaveBeenCalledWith('/from-payload');
    expect(controller.setOutputPath).toHaveBeenCalledWith('/picked');
  });

  it('ui:pickOutputPath falls back to config.outputPath then workspaceRoot', async () => {
    const { dispatch, controller } = await resolvedProvider();
    mocks.showOpenDialog.mockResolvedValue(undefined);

    controller.getConfig.mockResolvedValueOnce({ adapter: 'fetch', outputPath: '/cfg-out' });
    await dispatch({ type: 'ui:pickOutputPath', payload: undefined });
    expect(mocks.uriFile).toHaveBeenCalledWith('/cfg-out');

    controller.getConfig.mockResolvedValueOnce({ adapter: 'fetch' });
    await dispatch({ type: 'ui:pickOutputPath', payload: undefined });
    expect(mocks.uriFile).toHaveBeenCalledWith('/workspace');
  });

  it('ui:pickOutputPath dismissal does not set the path', async () => {
    const { dispatch, controller } = await resolvedProvider();
    mocks.showOpenDialog.mockResolvedValue(undefined);
    await dispatch({ type: 'ui:pickOutputPath', payload: {} });
    expect(controller.setOutputPath).not.toHaveBeenCalled();
  });

  it('ui:import delegates to the controller and posts the result', async () => {
    const { dispatch, controller, postMessage } = await resolvedProvider();
    await dispatch({ type: 'ui:import', payload: { source: '/s', baseURL: 'b', outputPath: 'o' } });
    expect(controller.runImportOpenAPI).toHaveBeenCalledWith('/s', { baseURL: 'b', outputPath: 'o' });
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'import:success' }));
  });

  it('ui:generate tolerates a missing payload (optional chaining)', async () => {
    const { dispatch, controller } = await resolvedProvider();
    await dispatch({ type: 'ui:generate' });
    expect(controller.runGenerateMethods).toHaveBeenCalledWith({
      outputPath: undefined,
      baseURL: undefined,
      adapter: undefined,
    });
  });

  it('ui:generateTypes / ui:reload delegate to their controller methods', async () => {
    const { dispatch, controller } = await resolvedProvider();
    await dispatch({ type: 'ui:generateTypes' });
    await dispatch({ type: 'ui:reload' });
    expect(controller.runGenerateTypes).toHaveBeenCalled();
    expect(controller.reloadOpenAPI).toHaveBeenCalled();
  });

  it('ui:setBaseUrl / ui:setAdapter / ui:setOutputPath forward their payloads', async () => {
    const { dispatch, controller } = await resolvedProvider();
    await dispatch({ type: 'ui:setBaseUrl', payload: { baseURL: 'b' } });
    await dispatch({ type: 'ui:setAdapter', payload: { adapter: 'axios' } });
    await dispatch({ type: 'ui:setOutputPath', payload: { outputPath: 'o' } });
    expect(controller.setBaseUrl).toHaveBeenCalledWith('b');
    expect(controller.setDefaultAdapter).toHaveBeenCalledWith('axios');
    expect(controller.setOutputPath).toHaveBeenCalledWith('o');
  });

  it('posts generate:error with the Error message when a handler throws', async () => {
    const { dispatch, controller, postMessage } = await resolvedProvider();
    controller.runGenerateMethods.mockRejectedValueOnce(new Error('kaboom'));
    await dispatch({ type: 'ui:generate' });
    expect(postMessage).toHaveBeenCalledWith({ type: 'generate:error', payload: { errors: ['kaboom'] } });
  });

  it('posts the generic message when a non-Error is thrown', async () => {
    const { dispatch, controller, postMessage } = await resolvedProvider();
    controller.reloadOpenAPI.mockRejectedValueOnce('nope');
    await dispatch({ type: 'ui:reload' });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'generate:error',
      payload: { errors: ['Unexpected extension error.'] },
    });
  });
});

describe('changeToExtensionTab', () => {
  it('focuses the view then posts ext:focusStep', async () => {
    const { provider, controller } = setup();
    const view = createView();
    provider.resolveWebviewView(view.view, {} as never, {} as never);
    await Promise.resolve();
    view.postMessage.mockClear();
    controller.getUIConfig.mockClear();

    await provider.changeToExtensionTab();
    expect(mocks.executeCommand).toHaveBeenCalledWith('plf-es-view.focus');
    expect(view.postMessage).toHaveBeenCalledWith({ type: 'ext:focusStep', payload: { step: 1 } });
  });
});
