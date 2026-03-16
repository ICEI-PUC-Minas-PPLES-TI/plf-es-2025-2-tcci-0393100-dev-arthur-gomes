import { join } from 'node:path';
import * as vscode from 'vscode';
import { ConfigManager } from './services/config/ConfigManager';
import { FileWriter } from './services/generators/FileWriter';
import { OperationNameResolver } from './services/generators/OperationNameResolver';
import { TypeGenerator } from './services/generators/TypeGenerator';
import { OpenAPILoader } from './services/parsers/OpenAPILoader';
import { OpenAPIValidator } from './services/parsers/OpenAPIValidator';
import { PathParser } from './services/parsers/PathParser';
import { SchemaParser } from './services/parsers/SchemaParser';
import { ExtensionController } from './ui/ExtensionController';
import type { ExtensionToUIMessage, UIToExtensionMessage } from './ui/messages';

class SidebarViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'plf-es-view';

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly controller: ExtensionController,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.logInfo('Resolving sidebar webview.');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: UIToExtensionMessage) => {
      this.logInfo(`Received UI message: ${message.type}`);
      await this.handleMessage(message);
    });

    void this.pushConfig();
  }

  async postMessage(message: ExtensionToUIMessage): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage(message);
  }

  async pushConfig(): Promise<void> {
    if (!this.view) {
      return;
    }

    const config = await this.controller.getUIConfig();
    await this.view.webview.postMessage({
      type: 'config:loaded',
      payload: config,
    } satisfies ExtensionToUIMessage);
  }

  private async handleMessage(message: UIToExtensionMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ui:ready': {
          this.logInfo('Webview reported ready.');
          await this.pushConfig();
          break;
        }
        case 'ui:log': {
          if (message.payload.level === 'error') {
            this.logError(`Webview: ${message.payload.message}`);
          } else {
            this.logInfo(`Webview: ${message.payload.message}`);
          }
          break;
        }
        case 'ui:updateConfig': {
          this.logInfo('Updating persisted config from webview.');
          await this.controller.updateConfig({
            outputPath: message.payload.outputPath,
            baseURL: message.payload.baseURL,
          });
          await this.pushConfig();
          break;
        }
        case 'ui:import': {
          this.logInfo(`Starting import for source: ${message.payload.source}`);
          const result = await this.controller.runImportOpenAPI(message.payload.source, {
            outputPath: message.payload.outputPath,
            baseURL: message.payload.baseURL,
          });

          this.logInfo(`Import completed with message: ${result.type}`);
          await this.postMessage(result);
          await this.pushConfig();
          break;
        }
        case 'ui:generate': {
          this.logInfo('Starting SDK generation from webview action.');
          const result = await this.controller.runGenerateMethods({
            outputPath: message.payload?.outputPath,
            baseURL: message.payload?.baseURL,
          });

          this.logInfo(`Generation completed with message: ${result.type}`);
          await this.postMessage(result);
          await this.pushConfig();
          break;
        }
      }
    } catch (error) {
      this.logError(
        `Unhandled sidebar error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
      );
      await this.postMessage({
        type: 'generate:error',
        payload: {
          errors: [error instanceof Error ? error.message : 'Unexpected extension error.'],
        },
      });
    }
  }

  private getHtmlContent(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body {
      margin: 0;
      padding: 12px;
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      display: grid;
      gap: 10px;
    }
    h2 {
      margin: 0;
      font-size: 14px;
    }
    .field {
      display: grid;
      gap: 6px;
    }
    label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 8px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-size: 12px;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr;
      gap: 6px;
    }
    button {
      width: 100%;
      border: none;
      border-radius: 4px;
      padding: 8px 10px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 12px;
      text-align: left;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      font-size: 11px;
      line-height: 1.4;
      padding: 8px;
      border-radius: 4px;
      background: var(--vscode-textCodeBlock-background);
      min-height: 48px;
    }
    .status-title {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
  </style>
</head>
<body>
  <h2>Swagger to SDK</h2>

  <div class="field">
    <label for="source">OpenAPI Source (file path or URL)</label>
    <input id="source" type="text" placeholder="/path/openapi.yaml or https://..." />
  </div>

  <div class="field">
    <label for="outputPath">Output Path</label>
    <input id="outputPath" type="text" placeholder="/workspace/generated-sdk" />
  </div>

  <div class="field">
    <label for="baseURL">Base URL (optional)</label>
    <input id="baseURL" type="text" placeholder="https://api.example.com" />
  </div>

  <div class="actions">
    <button id="saveConfigButton">Save Settings</button>
    <button id="importButton">Import OpenAPI</button>
    <button id="generateButton">Generate SDK</button>
  </div>

  <div>
    <div class="status-title">Status</div>
    <pre id="status">Waiting for action...</pre>
  </div>

  <script nonce="${nonce}">
    (() => {
      const vscode = acquireVsCodeApi();
      const sourceInput = document.getElementById('source');
      const outputPathInput = document.getElementById('outputPath');
      const baseURLInput = document.getElementById('baseURL');
      const status = document.getElementById('status');

      function log(level, message) {
        console[level === 'error' ? 'error' : 'log']('[PLF ES]', message);
        vscode.postMessage({
          type: 'ui:log',
          payload: { level, message },
        });
      }

      function setStatus(lines) {
        status.textContent = lines.join('\\n');
      }

      window.addEventListener('error', (event) => {
        log('error', 'Webview error: ' + event.message);
      });

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        log('error', 'Unhandled promise rejection: ' + reason);
      });

      document.getElementById('saveConfigButton').addEventListener('click', () => {
        log('info', 'Save Settings button clicked.');
        vscode.postMessage({
          type: 'ui:updateConfig',
          payload: {
            outputPath: outputPathInput.value,
            baseURL: baseURLInput.value,
          },
        });
        setStatus(['Settings saved.']);
      });

      document.getElementById('importButton').addEventListener('click', () => {
        log('info', 'Import OpenAPI button clicked.');
        vscode.postMessage({
          type: 'ui:import',
          payload: {
            source: sourceInput.value,
            outputPath: outputPathInput.value,
            baseURL: baseURLInput.value,
          },
        });
        setStatus(['Importing OpenAPI...']);
      });

      document.getElementById('generateButton').addEventListener('click', () => {
        log('info', 'Generate SDK button clicked.');
        vscode.postMessage({
          type: 'ui:generate',
          payload: {
            outputPath: outputPathInput.value,
            baseURL: baseURLInput.value,
          },
        });
        setStatus(['Generating SDK files...']);
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        log('info', 'Received extension message: ' + message.type);

        if (message.type === 'config:loaded') {
          if (!sourceInput.value && message.payload.importPath) {
            sourceInput.value = message.payload.importPath;
          }

          if (message.payload.outputPath) {
            outputPathInput.value = message.payload.outputPath;
          }

          baseURLInput.value = message.payload.baseURL || '';
          return;
        }

        if (message.type === 'import:success') {
          const warningText = message.payload.warnings?.length
            ? ['Warnings:', ...message.payload.warnings]
            : [];

          setStatus([
            'OpenAPI imported successfully.',
            'Operations: ' + message.payload.operations,
            'Schemas: ' + message.payload.schemas,
            ...warningText,
          ]);
          return;
        }

        if (message.type === 'import:error') {
          setStatus(['Import failed:', ...message.payload.errors, ...(message.payload.warnings || [])]);
          return;
        }

        if (message.type === 'generate:success') {
          const warningText = message.payload.warnings?.length
            ? ['Warnings:', ...message.payload.warnings]
            : [];

          setStatus(['SDK generated successfully:', ...message.payload.files, ...warningText]);
          return;
        }

        if (message.type === 'generate:error') {
          setStatus(['Generation failed:', ...message.payload.errors, ...(message.payload.warnings || [])]);
        }
      });

      log('info', 'Webview script initialized.');
      vscode.postMessage({ type: 'ui:ready' });
    })();
  </script>
</body>
</html>`;
  }

  private logInfo(message: string): void {
    this.outputChannel.appendLine(`[info] ${message}`);
  }

  private logError(message: string): void {
    this.outputChannel.appendLine(`[error] ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('PLF ES');
  outputChannel.appendLine('[info] Activating PLF ES extension.');
  const workspaceRoot =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
  const defaultOutputPath = join(workspaceRoot, 'generated-sdk');

  const configManager = new ConfigManager(context.workspaceState, defaultOutputPath);
  const operationNameResolver = new OperationNameResolver();
  const schemaParser = new SchemaParser();
  const pathParser = new PathParser(schemaParser);
  const validator = new OpenAPIValidator();
  const openAPILoader = new OpenAPILoader(
    validator,
    pathParser,
    schemaParser,
    operationNameResolver
  );
  const typeGenerator = new TypeGenerator();
  const fileWriter = new FileWriter();

  const controller = new ExtensionController(
    configManager,
    openAPILoader,
    operationNameResolver,
    typeGenerator,
    fileWriter,
    workspaceRoot
  );

  const sidebarProvider = new SidebarViewProvider(context.extensionUri, controller, outputChannel);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider)
  );

  const importCommand = vscode.commands.registerCommand('plf-es-extension.importOpenAPI', async () => {
    outputChannel.appendLine('[info] Command palette import invoked.');
    const source = await vscode.window.showInputBox({
      prompt: 'Enter OpenAPI source (file path or URL)',
      placeHolder: '/path/openapi.yaml or https://example.com/openapi.json',
      ignoreFocusOut: true,
    });

    if (!source) {
      return;
    }

    const result = await controller.runImportOpenAPI(source);
    outputChannel.appendLine(`[info] Import command result: ${result.type}`);
    await sidebarProvider.postMessage(result);
    await sidebarProvider.pushConfig();
    notifyResult(result);
  });

  const generateCommand = vscode.commands.registerCommand('plf-es-extension.generateSDK', async () => {
    outputChannel.appendLine('[info] Command palette generation invoked.');
    const result = await controller.runGenerateMethods();
    outputChannel.appendLine(`[info] Generate command result: ${result.type}`);
    await sidebarProvider.postMessage(result);
    await sidebarProvider.pushConfig();
    notifyResult(result);
  });

  context.subscriptions.push(importCommand, generateCommand, outputChannel);
}

function notifyResult(message: ExtensionToUIMessage): void {
  switch (message.type) {
    case 'import:success':
      vscode.window.showInformationMessage(
        `OpenAPI imported successfully (${message.payload.operations} operations, ${message.payload.schemas} schemas).`
      );
      break;
    case 'import:error':
      vscode.window.showErrorMessage(`OpenAPI import failed: ${message.payload.errors.join(' | ')}`);
      break;
    case 'generate:success':
      vscode.window.showInformationMessage(`SDK generated: ${message.payload.files.join(', ')}`);
      break;
    case 'generate:error':
      vscode.window.showErrorMessage(`SDK generation failed: ${message.payload.errors.join(' | ')}`);
      break;
    case 'config:loaded':
      break;
  }
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}

export function deactivate(): void {}
