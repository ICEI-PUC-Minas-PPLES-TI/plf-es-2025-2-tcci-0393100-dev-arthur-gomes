"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const node_path_1 = require("node:path");
const vscode = require("vscode");
const ConfigManager_1 = require("./services/config/ConfigManager");
const FileWriter_1 = require("./services/generators/FileWriter");
const OperationNameResolver_1 = require("./services/generators/OperationNameResolver");
const ReactQueryGenerator_1 = require("./services/generators/ReactQueryGenerator");
const TypeGenerator_1 = require("./services/generators/TypeGenerator");
const OpenAPILoader_1 = require("./services/parsers/OpenAPILoader");
const OpenAPIValidator_1 = require("./services/parsers/OpenAPIValidator");
const PathParser_1 = require("./services/parsers/PathParser");
const SchemaParser_1 = require("./services/parsers/SchemaParser");
const ExtensionController_1 = require("./ui/ExtensionController");
class SidebarViewProvider {
    constructor(extensionUri, controller, outputChannel, workspaceRoot) {
        this.extensionUri = extensionUri;
        this.controller = controller;
        this.outputChannel = outputChannel;
        this.workspaceRoot = workspaceRoot;
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        this.logInfo('Resolving sidebar webview.');
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        webviewView.webview.onDidReceiveMessage(async (message) => {
            this.logInfo(`Received UI message: ${message.type}`);
            await this.handleMessage(message);
        });
        void this.pushConfig();
    }
    async postMessage(message) {
        if (!this.view) {
            return;
        }
        await this.view.webview.postMessage(message);
    }
    async pushConfig() {
        if (!this.view) {
            return;
        }
        const config = await this.controller.getUIConfig();
        await this.view.webview.postMessage({
            type: 'config:loaded',
            payload: config,
        });
    }
    async handleMessage(message) {
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
                    }
                    else {
                        this.logInfo(`Webview: ${message.payload.message}`);
                    }
                    break;
                }
                case 'ui:updateConfig': {
                    this.logInfo('Updating persisted config from webview.');
                    await this.controller.updateConfig({
                        outputPath: message.payload.outputPath,
                        baseURL: message.payload.baseURL,
                        adapter: message.payload.adapter,
                    });
                    await this.pushConfig();
                    break;
                }
                case 'ui:pickOutputPath': {
                    this.logInfo('Opening folder picker for output path.');
                    const currentConfig = await this.controller.getConfig();
                    const selected = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Select output folder',
                        defaultUri: message.payload?.currentPath
                            ? vscode.Uri.file(message.payload.currentPath)
                            : currentConfig.outputPath
                                ? vscode.Uri.file(currentConfig.outputPath)
                                : vscode.Uri.file(this.workspaceRoot),
                    });
                    if (!selected || !selected[0]) {
                        this.logInfo('Folder picker dismissed without selection.');
                        break;
                    }
                    await this.controller.updateConfig({
                        outputPath: selected[0].fsPath,
                    });
                    await this.pushConfig();
                    this.logInfo(`Output folder selected: ${selected[0].fsPath}`);
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
                        adapter: message.payload?.adapter,
                    });
                    this.logInfo(`Generation completed with message: ${result.type}`);
                    await this.postMessage(result);
                    await this.pushConfig();
                    break;
                }
            }
        }
        catch (error) {
            this.logError(`Unhandled sidebar error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            await this.postMessage({
                type: 'generate:error',
                payload: {
                    errors: [error instanceof Error ? error.message : 'Unexpected extension error.'],
                },
            });
        }
    }
    getHtmlContent(webview) {
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-sideBar-background);
      --panel: var(--vscode-sideBar-background);
      --line: var(--vscode-sideBarSectionHeader-border);
      --line-strong: var(--vscode-sideBarSectionHeader-border);
      --muted: var(--vscode-descriptionForeground);
      --text: var(--vscode-foreground);
      --accent: var(--vscode-focusBorder);
      --danger: var(--vscode-inputValidation-errorBorder);
      --success: var(--vscode-testing-iconPassed);
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: var(--vscode-font-family);
      background: var(--bg);
      overflow: hidden;
    }

    .shell {
      height: 100vh;
      overflow-y: auto;
      padding: 0;
    }

    .app {
      display: grid;
      gap: 0;
      width: 100%;
      min-height: 100%;
      padding: 0;
    }

    .section {
      display: grid;
      gap: 10px;
      padding: 12px 12px 14px;
      border-bottom: 1px solid var(--line);
    }

    .section:first-child {
      padding-top: 10px;
    }

    .section:last-child {
      border-bottom: 0;
    }

    .section-title {
      display: grid;
      gap: 0;
      padding-left: 12px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text);
    }

    .field {
      display: grid;
      gap: 6px;
    }

    .field-row {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }

    .field-row input {
      flex: 1;
      min-width: 0;
    }

    .field-row button {
      width: auto;
      min-width: 76px;
      text-align: center;
      padding-inline: 12px;
    }

    label {
      font-size: 11px;
      color: var(--muted);
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--text);
      font-size: 11px;
      outline: none;
      transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
    }

    input::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }

    select {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 11px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--vscode-input-background);
      color: var(--text);
      font-size: 11px;
      outline: none;
      transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
    }

    select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }

    .field-meta {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      color: var(--muted);
    }

    .actions {
      display: grid;
      gap: 8px;
    }

    button {
      position: relative;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      cursor: pointer;
      background: var(--vscode-button-background);
      color: var(--text);
      font-size: 11px;
      text-align: left;
      transition: border-color 120ms ease;
    }

    button:hover {
      border-color: var(--accent);
    }

    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-weight: 600;
    }

    .status-shell {
      display: grid;
      gap: 8px;
    }

    .status-toolbar {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 12px 0 24px;
    }

    .status-main {
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .status-mark {
      width: 14px;
      height: 14px;
      margin-top: 2px;
      border-radius: 999px;
      background: var(--vscode-descriptionForeground);
      flex: 0 0 auto;
    }

    .status-mark.is-loading {
      background: var(--vscode-descriptionForeground);
    }

    .status-mark.is-success {
      background: var(--success);
    }

    .status-mark.is-error {
      background: var(--danger);
    }

    .status-copy {
      display: grid;
      gap: 4px;
    }

    .status-copy strong {
      font-size: 11px;
      font-weight: 600;
    }

    .status-copy span {
      font-size: 10px;
      line-height: 1.5;
      color: var(--muted);
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: var(--vscode-badge-background);
      color: var(--muted);
    }

    .status-chip::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--vscode-descriptionForeground);
    }

    .status-chip.is-success::before,
    .status-chip.is-loading::before {
      background: var(--success);
    }

    .status-chip.is-error::before {
      background: var(--danger);
    }

    .status-list {
      display: grid;
      gap: 6px;
      max-height: 180px;
      overflow-y: auto;
      padding-right: 12px;
    }

    .status-item {
      display: grid;
      gap: 4px;
      padding: 9px 10px;
      border-radius: 6px;
      border: 1px solid var(--line);
      background: var(--vscode-editor-background);
    }

    .status-item-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 10px;
      color: var(--muted);
    }

    .status-item-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--text);
    }

    .status-item p {
      margin: 0;
      font-size: 10px;
      line-height: 1.5;
      color: var(--muted);
    }

    .empty-state {
      margin: 0;
      padding: 10px;
      border-radius: 6px;
      border: 1px dashed var(--line);
      color: var(--muted);
      font-size: 10px;
      line-height: 1.5;
      background: transparent;
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="app">
      <section class="section">
        <div class="section-title">Inputs</div>
          <div class="field">
            <label for="source">OpenAPI source</label>
            <input id="source" type="text" placeholder="/path/openapi.yaml or https://..." />
            <div class="field-meta">
              <span>File path or URL</span>
              <span id="sourceMeta">No source loaded</span>
            </div>
          </div>

        <div class="field">
          <label for="outputPath">Output path</label>
          <div class="field-row">
            <input id="outputPath" type="text" placeholder="/workspace/generated-sdk" />
            <button id="pickOutputButton" type="button">Browse</button>
          </div>
          <div class="field-meta">
            <span>Workspace target</span>
            <span id="outputMeta">SDK will be written here</span>
          </div>
        </div>

          <div class="field">
            <label for="baseURL">Base URL</label>
            <input id="baseURL" type="text" placeholder="https://api.example.com" />
            <div class="field-meta">
              <span>Optional prefix for requests</span>
              <span id="baseURLMeta">Can stay blank</span>
            </div>
          </div>

          <div class="field">
            <label for="adapter">Adapter</label>
            <select id="adapter">
              <option value="fetch">Native fetch</option>
              <option value="axios">Axios</option>
              <option value="react-query">React Query</option>
            </select>
          </div>
      </section>

      <section class="section">
        <div class="section-title">Actions</div>
          <div class="actions">
            <button id="saveConfigButton">Save settings</button>
            <button id="importButton" class="primary">Import OpenAPI</button>
            <button id="generateButton">Generate SDK</button>
          </div>
      </section>

      <section class="section status-shell">
        <div class="section-title">Status</div>
          <div class="status-toolbar">
            <div class="status-main">
              <div id="statusMark" class="status-mark"></div>
              <div class="status-copy">
                <strong id="statusTitle">Ready</strong>
                <span id="statusSubtitle">Import a spec or generate files from the latest config.</span>
              </div>
            </div>
            <button id="clearStatusButton">Clear</button>
          </div>

          <div id="statusChip" class="status-chip">Idle</div>

          <div class="status-list" id="statusFeed">
            <div class="empty-state">No activity yet.</div>
          </div>
      </section>
    </div>
  </div>

  <script nonce="${nonce}">
    (() => {
      const vscode = acquireVsCodeApi();
      const sourceInput = document.getElementById('source');
      const outputPathInput = document.getElementById('outputPath');
      const baseURLInput = document.getElementById('baseURL');
      const adapterSelect = document.getElementById('adapter');
      const sourceMeta = document.getElementById('sourceMeta');
      const outputMeta = document.getElementById('outputMeta');
      const baseURLMeta = document.getElementById('baseURLMeta');
      const statusFeed = document.getElementById('statusFeed');
      const statusChip = document.getElementById('statusChip');
      const statusMark = document.getElementById('statusMark');
      const statusTitle = document.getElementById('statusTitle');
      const statusSubtitle = document.getElementById('statusSubtitle');

      const defaultState = {
        inputs: {
          source: '',
          outputPath: '',
          baseURL: '',
          adapter: 'fetch',
        },
        status: {
          tone: 'idle',
          title: 'Ready',
          subtitle: 'Import a spec or generate files from the latest config.',
        },
        feed: [],
      };

      let state = hydrateState(vscode.getState());

      function log(level, message) {
        console[level === 'error' ? 'error' : 'log']('[Swagger to SDK]', message);
        vscode.postMessage({
          type: 'ui:log',
          payload: { level, message },
        });
      }

      function hydrateState(savedState) {
        const next = savedState || {};
        return {
          inputs: {
            source: (next.inputs && next.inputs.source) || defaultState.inputs.source,
            outputPath: (next.inputs && next.inputs.outputPath) || defaultState.inputs.outputPath,
            baseURL: (next.inputs && next.inputs.baseURL) || defaultState.inputs.baseURL,
            adapter: (next.inputs && next.inputs.adapter) || defaultState.inputs.adapter,
          },
          status: {
            tone: (next.status && next.status.tone) || defaultState.status.tone,
            title: (next.status && next.status.title) || defaultState.status.title,
            subtitle: (next.status && next.status.subtitle) || defaultState.status.subtitle,
          },
          feed: Array.isArray(next.feed) ? next.feed.slice(0, 5) : [],
        };
      }

      function saveState() {
        vscode.setState(state);
      }

      function isRemoteSource(value) {
        return /^https?:\\/\\//i.test(String(value || '').trim());
      }

      function kindClass(kind) {
        if (kind === 'success') {
          return 'is-success';
        }

        if (kind === 'error') {
          return 'is-error';
        }

        if (kind === 'loading') {
          return 'is-loading';
        }

        return '';
      }

      function renderInputs() {
        sourceInput.value = state.inputs.source || '';
        outputPathInput.value = state.inputs.outputPath || '';
        baseURLInput.value = state.inputs.baseURL || '';
        adapterSelect.value = state.inputs.adapter || 'fetch';

        sourceMeta.textContent = state.inputs.source
          ? (isRemoteSource(state.inputs.source) ? 'Remote spec' : 'Local file')
          : 'No source loaded';
        outputMeta.textContent = state.inputs.outputPath ? 'Custom output' : 'Default output';
        baseURLMeta.textContent = state.inputs.baseURL ? 'Included' : 'Optional';
      }

      function renderStatus() {
        statusTitle.textContent = state.status.title;
        statusSubtitle.textContent = state.status.subtitle;
        statusChip.textContent = state.status.tone === 'success'
          ? 'Success'
          : state.status.tone === 'error'
            ? 'Error'
            : state.status.tone === 'loading'
              ? 'Working'
              : 'Idle';
        statusChip.className = 'status-chip ' + kindClass(state.status.tone);
        statusMark.className = 'status-mark ' + kindClass(state.status.tone);
      }

      function renderFeed() {
        statusFeed.innerHTML = '';

        if (!state.feed.length) {
          const empty = document.createElement('div');
          empty.className = 'empty-state';
          empty.textContent = 'No activity yet.';
          statusFeed.appendChild(empty);
          return;
        }

        state.feed.forEach((entry) => {
          const item = document.createElement('article');
          item.className = 'status-item';

          const head = document.createElement('div');
          head.className = 'status-item-head';

          const title = document.createElement('div');
          title.className = 'status-item-title';

          const chip = document.createElement('span');
          chip.className = 'status-chip ' + kindClass(entry.kind);
          chip.textContent = entry.kind;

          const heading = document.createElement('strong');
          heading.textContent = entry.title;

          title.appendChild(chip);
          title.appendChild(heading);

          const time = document.createElement('span');
          time.textContent = entry.time;

          head.appendChild(title);
          head.appendChild(time);

          const subtitle = document.createElement('p');
          subtitle.textContent = entry.subtitle;

          item.appendChild(head);
          item.appendChild(subtitle);

          if (entry.details && entry.details.length) {
            const details = document.createElement('p');
            details.textContent = entry.details.join(' · ');
            item.appendChild(details);
          }

          statusFeed.appendChild(item);
        });
      }

      function pushStatus(kind, title, subtitle, details) {
        state.status = {
          tone: kind,
          title,
          subtitle,
        };

        state.feed = [
          {
            kind,
            title,
            subtitle,
            details: Array.isArray(details) ? details : [],
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
          ...state.feed,
        ].slice(0, 5);

        renderStatus();
        renderFeed();
        saveState();
      }

      function syncInputsToState() {
        state.inputs.source = sourceInput.value.trim();
        state.inputs.outputPath = outputPathInput.value.trim();
        state.inputs.baseURL = baseURLInput.value.trim();
        if (adapterSelect.value === 'axios') {
          state.inputs.adapter = 'axios';
        } else if (adapterSelect.value === 'react-query') {
          state.inputs.adapter = 'react-query';
        } else {
          state.inputs.adapter = 'fetch';
        }
        renderInputs();
        saveState();
      }

      function applyConfigPayload(payload) {
        if (payload.importPath !== undefined) {
          state.inputs.source = payload.importPath;
        }

        if (payload.outputPath !== undefined) {
          state.inputs.outputPath = payload.outputPath;
        }

        if (payload.baseURL !== undefined) {
          state.inputs.baseURL = payload.baseURL;
        }

        if (payload.adapter !== undefined) {
          state.inputs.adapter = payload.adapter;
        }

        renderInputs();
        saveState();
      }

      window.addEventListener('error', (event) => {
        log('error', 'Webview error: ' + event.message);
        pushStatus('error', 'Webview error', event.message || 'A script issue interrupted the sidebar.', []);
      });

      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
        log('error', 'Unhandled promise rejection: ' + reason);
        pushStatus('error', 'Promise rejected', reason, []);
      });

      document.getElementById('saveConfigButton').addEventListener('click', () => {
        log('info', 'Save Settings button clicked.');
        syncInputsToState();
        vscode.postMessage({
          type: 'ui:updateConfig',
          payload: {
            outputPath: outputPathInput.value,
            baseURL: baseURLInput.value,
            adapter: state.inputs.adapter,
          },
        });
        pushStatus('success', 'Saved', 'Workspace settings updated.', []);
      });

      document.getElementById('pickOutputButton').addEventListener('click', () => {
        log('info', 'Browse output path button clicked.');
        vscode.postMessage({
          type: 'ui:pickOutputPath',
          payload: {
            currentPath: state.inputs.outputPath,
          },
        });
      });

      document.getElementById('importButton').addEventListener('click', () => {
        log('info', 'Import OpenAPI button clicked.');
        syncInputsToState();

        if (!state.inputs.source) {
          pushStatus('error', 'Source required', 'Add a file path or URL first.', []);
          return;
        }
        vscode.postMessage({
          type: 'ui:import',
          payload: {
            source: state.inputs.source,
            outputPath: outputPathInput.value,
            baseURL: baseURLInput.value,
          },
        });
      });

      document.getElementById('generateButton').addEventListener('click', () => {
        log('info', 'Generate SDK button clicked.');
        syncInputsToState();
        pushStatus('loading', 'Generating', 'Writing SDK files.', []);
        vscode.postMessage({
          type: 'ui:generate',
          payload: {
            outputPath: state.inputs.outputPath,
            baseURL: state.inputs.baseURL,
            adapter: state.inputs.adapter,
          },
        });
      });

      window.addEventListener('message', (event) => {
        const message = event.data;
        log('info', 'Received extension message: ' + message.type);

        if (message.type === 'config:loaded') {
          applyConfigPayload(message.payload);
          return;
        }

        if (message.type === 'import:success') {
          pushStatus('success', 'Imported', 'Ready to generate.', []);
          return;
        }

        if (message.type === 'import:error') {
          pushStatus('error', 'Import failed', message.payload.errors[0] || 'Check the source and try again.', []);
          return;
        }

        if (message.type === 'generate:success') {
          pushStatus('success', 'Generated', 'Files written successfully.', []);
          return;
        }

        if (message.type === 'generate:error') {
          pushStatus('error', 'Generation failed', message.payload.errors[0] || 'Something blocked file generation.', []);
        }
      });

      document.getElementById('clearStatusButton').addEventListener('click', () => {
        state.feed = [];
        state.status = {
          tone: 'idle',
          title: 'Ready',
          subtitle: 'Import a spec or generate files from the latest config.',
        };
        renderStatus();
        renderFeed();
        saveState();
      });

      sourceInput.addEventListener('input', syncInputsToState);
      outputPathInput.addEventListener('input', syncInputsToState);
      baseURLInput.addEventListener('input', syncInputsToState);
      adapterSelect.addEventListener('change', syncInputsToState);

      renderInputs();
      renderStatus();
      renderFeed();
      log('info', 'Webview script initialized.');
      vscode.postMessage({ type: 'ui:ready' });
    })();
  </script>
</body>
</html>`;
    }
    logInfo(message) {
        this.outputChannel.appendLine(`[info] ${message}`);
    }
    logError(message) {
        this.outputChannel.appendLine(`[error] ${message}`);
    }
}
SidebarViewProvider.viewType = 'plf-es-view';
function activate(context) {
    const outputChannel = vscode.window.createOutputChannel('Swagger to SDK');
    outputChannel.appendLine('[info] Activating Swagger to SDK extension.');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.globalStorageUri.fsPath;
    const defaultOutputPath = (0, node_path_1.join)(workspaceRoot, 'generated-sdk');
    const configManager = new ConfigManager_1.ConfigManager(context.workspaceState, defaultOutputPath);
    const operationNameResolver = new OperationNameResolver_1.OperationNameResolver();
    const schemaParser = new SchemaParser_1.SchemaParser();
    const pathParser = new PathParser_1.PathParser(schemaParser);
    const validator = new OpenAPIValidator_1.OpenAPIValidator();
    const openAPILoader = new OpenAPILoader_1.OpenAPILoader(validator, pathParser, schemaParser, operationNameResolver);
    const typeGenerator = new TypeGenerator_1.TypeGenerator();
    const reactQueryGenerator = new ReactQueryGenerator_1.ReactQueryGenerator();
    const fileWriter = new FileWriter_1.FileWriter();
    const controller = new ExtensionController_1.ExtensionController(configManager, openAPILoader, operationNameResolver, typeGenerator, reactQueryGenerator, fileWriter, workspaceRoot);
    const sidebarProvider = new SidebarViewProvider(context.extensionUri, controller, outputChannel, workspaceRoot);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider));
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
function notifyResult(message) {
    switch (message.type) {
        case 'import:success':
            vscode.window.showInformationMessage(`OpenAPI imported successfully (${message.payload.operations} operations, ${message.payload.schemas} schemas).`);
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
function getNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i += 1) {
        nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return nonce;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map