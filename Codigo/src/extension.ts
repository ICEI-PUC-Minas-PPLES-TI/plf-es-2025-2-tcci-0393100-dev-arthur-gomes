import { join } from 'node:path';
import * as vscode from 'vscode';
import { ConfigManager } from './services/config/ConfigManager';
import { FileWriter } from './services/generators/FileWriter';
import { OperationNameResolver } from './services/generators/OperationNameResolver';
import { ReactQueryGenerator } from './services/generators/ReactQueryGenerator';
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
    private readonly outputChannel: vscode.OutputChannel,
    private readonly workspaceRoot: string
  ) { }

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
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-sideBar-background);
      --line: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
      --muted: var(--vscode-descriptionForeground);
      --text: var(--vscode-foreground);
      --accent: var(--vscode-focusBorder);
      --brand: var(--vscode-button-background);
      --brand-fg: var(--vscode-button-foreground);
      --danger: var(--vscode-inputValidation-errorBorder, var(--vscode-errorForeground));
      --success: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
      --radius: 8px;
      --surface: color-mix(in srgb, var(--text) 4%, transparent);
      --surface-strong: color-mix(in srgb, var(--text) 7%, transparent);
      --tint-brand: color-mix(in srgb, var(--brand) 22%, transparent);
      --tint-success: color-mix(in srgb, var(--success) 20%, transparent);
      --tint-danger: color-mix(in srgb, var(--danger) 16%, transparent);
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
      padding: 0 0 4px;
    }

    .masthead {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 14px 12px;
    }

    .masthead-mark {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      border-radius: 7px;
      background: var(--tint-brand);
      color: var(--brand);
    }

    .masthead-mark svg { width: 15px; height: 15px; }

    .masthead-copy { display: grid; gap: 1px; }

    .masthead-copy h1 {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .masthead-copy p {
      margin: 0;
      font-size: 10.5px;
      color: var(--muted);
    }

    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      border-top: 1px solid var(--line);
    }

    .step { border-bottom: 1px solid var(--line); }

    .step-head {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 11px 14px;
      border: 0;
      border-radius: 0;
      background: transparent;
      color: var(--text);
      text-align: left;
      cursor: pointer;
      transition: background 120ms ease;
    }

    .step-head:hover,
    .step.is-open .step-head { background: var(--surface); }

    .step-badge {
      position: relative;
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      border: 1.5px solid var(--line);
      background: transparent;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
    }

    .step.is-open .step-badge {
      background: var(--brand);
      border-color: var(--brand);
      color: var(--brand-fg);
    }

    .step.is-done .step-badge {
      background: var(--tint-success);
      border-color: transparent;
      color: transparent;
    }

    .step.is-done .step-badge::after {
      content: '\\2713';
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: var(--success);
      font-size: 12px;
      font-weight: 700;
    }

    .step-headings {
      display: grid;
      gap: 1px;
      flex: 1;
      min-width: 0;
    }

    .step-title { font-size: 12px; font-weight: 600; }

    .step-summary {
      font-size: 10px;
      color: var(--muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .step.is-open .step-summary { display: none; }

    .step-caret {
      flex: 0 0 auto;
      display: grid;
      place-items: center;
      color: var(--muted);
      transition: transform 160ms ease;
    }

    .step.is-open .step-caret { transform: rotate(90deg); }

    .step-caret svg { width: 12px; height: 12px; }

    .step-body { display: none; padding: 2px 14px 16px 46px; }

    .step.is-open .step-body { display: grid; gap: 12px; }

    .step-hint {
      margin: 0;
      font-size: 10.5px;
      line-height: 1.5;
      color: var(--muted);
    }

    .step-footer { display: flex; justify-content: flex-end; }

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

    .btn {
      position: relative;
      width: 100%;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 9px 12px;
      cursor: pointer;
      background: var(--surface);
      color: var(--text);
      font-size: 11.5px;
      font-weight: 500;
      text-align: center;
      transition: background 120ms ease, border-color 120ms ease;
    }

    .btn:hover {
      border-color: var(--accent);
      background: var(--surface-strong);
    }

    .btn:focus-visible {
      outline: 1px solid var(--accent);
      outline-offset: 1px;
    }

    .btn-primary {
      border-color: transparent;
      background: var(--brand);
      color: var(--brand-fg);
      font-weight: 600;
    }

    .btn-primary:hover {
      border-color: transparent;
      background: color-mix(in srgb, var(--brand) 88%, var(--text));
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .link-button {
      width: auto;
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 10.5px;
      padding: 2px;
      cursor: pointer;
    }

    .link-button:hover {
      color: var(--text);
      text-decoration: underline;
    }

    .statusbar {
      display: grid;
      gap: 10px;
      padding: 12px 14px 14px;
      border-top: 1px solid var(--line);
    }

    .statusbar-row {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .status-mark {
      flex: 0 0 auto;
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--muted);
    }

    .status-mark.is-loading {
      background: var(--brand);
      animation: pulse 1.2s ease-in-out infinite;
    }

    .status-mark.is-success { background: var(--success); }
    .status-mark.is-error { background: var(--danger); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .statusbar-text {
      display: grid;
      gap: 1px;
      flex: 1;
      min-width: 0;
    }

    .statusbar-text strong {
      font-size: 11px;
      font-weight: 600;
    }

    .statusbar-text span {
      font-size: 10px;
      line-height: 1.45;
      color: var(--muted);
    }

    .status-feed-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
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
    <header class="masthead">
      <span class="masthead-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10"/><path d="M4 12h7"/><path d="M4 17h10"/><path d="m16 9 4 3-4 3"/></svg>
      </span>
      <span class="masthead-copy">
        <h1>Swagger to SDK</h1>
        <p>Spec in, typed client out.</p>
      </span>
    </header>

    <ol class="steps">
      <li class="step is-open" data-step="1">
        <button class="step-head" type="button" aria-expanded="true" aria-controls="step-body-1">
          <span class="step-badge">1</span>
          <span class="step-headings">
            <span class="step-title">Configure</span>
            <span class="step-summary" id="summary-1">Source, output &amp; adapter</span>
          </span>
          <span class="step-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
        </button>
        <div class="step-body" id="step-body-1">
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
              <button id="pickOutputButton" class="btn" type="button">Browse</button>
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

          <div class="step-footer">
            <button id="saveConfigButton" class="link-button" type="button">Save configuration</button>
          </div>
        </div>
      </li>

      <li class="step" data-step="2">
        <button class="step-head" type="button" aria-expanded="false" aria-controls="step-body-2">
          <span class="step-badge">2</span>
          <span class="step-headings">
            <span class="step-title">Import spec</span>
            <span class="step-summary" id="summary-2">Load &amp; validate the document</span>
          </span>
          <span class="step-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
        </button>
        <div class="step-body" id="step-body-2">
          <p class="step-hint">Fetch and parse the spec from the source above before generating.</p>
          <button id="importButton" class="btn btn-primary" type="button">Import OpenAPI</button>
        </div>
      </li>

      <li class="step" data-step="3">
        <button class="step-head" type="button" aria-expanded="false" aria-controls="step-body-3">
          <span class="step-badge">3</span>
          <span class="step-headings">
            <span class="step-title">Generate SDK</span>
            <span class="step-summary" id="summary-3">Write typed client to output</span>
          </span>
          <span class="step-caret" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg></span>
        </button>
        <div class="step-body" id="step-body-3">
          <p class="step-hint">Generates types and request methods using the selected adapter.</p>
          <button id="generateButton" class="btn btn-primary" type="button">Generate SDK</button>
        </div>
      </li>
    </ol>

    <section class="statusbar" aria-live="polite">
      <div class="statusbar-row">
        <span id="statusMark" class="status-mark"></span>
        <span class="statusbar-text">
          <strong id="statusTitle">Ready</strong>
          <span id="statusSubtitle">Import a spec or generate files from the latest config.</span>
        </span>
        <span id="statusChip" class="status-chip">Idle</span>
      </div>

      <div class="status-feed-head">
        <span>Activity</span>
        <button id="clearStatusButton" class="link-button" type="button">Clear</button>
      </div>

      <div class="status-list" id="statusFeed">
        <div class="empty-state">No activity yet.</div>
      </div>
    </section>
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
      const stepEls = Array.from(document.querySelectorAll('.step'));
      const summary1 = document.getElementById('summary-1');
      const summary2 = document.getElementById('summary-2');
      const summary3 = document.getElementById('summary-3');

      function findStep(n) {
        return stepEls.find((el) => Number(el.dataset.step) === n);
      }

      function openStep(n) {
        stepEls.forEach((el) => {
          const isTarget = Number(el.dataset.step) === n;
          el.classList.toggle('is-open', isTarget);
          const head = el.querySelector('.step-head');
          if (head) {
            head.setAttribute('aria-expanded', String(isTarget));
          }
        });
      }

      function markStepDone(n, done) {
        const el = findStep(n);
        if (el) {
          el.classList.toggle('is-done', Boolean(done));
        }
      }

      function basename(value) {
        const parts = String(value || '').replace(/\\\\/g, '/').split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
      }

      function adapterLabel(value) {
        if (value === 'axios') {
          return 'Axios';
        }
        if (value === 'react-query') {
          return 'React Query';
        }
        return 'fetch';
      }

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

        summary1.textContent = state.inputs.source
          ? basename(state.inputs.source) + ' · ' + adapterLabel(state.inputs.adapter)
          : 'Source, output & adapter';
        markStepDone(1, Boolean(state.inputs.source && state.inputs.outputPath));
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
          markStepDone(2, true);
          summary2.textContent = 'Spec imported';
          openStep(3);
          pushStatus('success', 'Imported', 'Ready to generate.', []);
          return;
        }

        if (message.type === 'import:error') {
          markStepDone(2, false);
          pushStatus('error', 'Import failed', message.payload.errors[0] || 'Check the source and try again.', []);
          return;
        }

        if (message.type === 'generate:success') {
          markStepDone(3, true);
          summary3.textContent = 'SDK generated';
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
        markStepDone(2, false);
        markStepDone(3, false);
        summary2.textContent = 'Load & validate the document';
        summary3.textContent = 'Write typed client to output';
        renderStatus();
        renderFeed();
        saveState();
      });

      stepEls.forEach((el) => {
        const head = el.querySelector('.step-head');
        if (!head) {
          return;
        }
        head.addEventListener('click', () => {
          openStep(el.classList.contains('is-open') ? 0 : Number(el.dataset.step));
        });
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

  private logInfo(message: string): void {
    this.outputChannel.appendLine(`[info] ${message}`);
  }

  private logError(message: string): void {
    this.outputChannel.appendLine(`[error] ${message}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Swagger to SDK');
  outputChannel.appendLine('[info] Activating Swagger to SDK extension.');
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
  const reactQueryGenerator = new ReactQueryGenerator();
  const fileWriter = new FileWriter();

  const controller = new ExtensionController(
    configManager,
    openAPILoader,
    operationNameResolver,
    typeGenerator,
    reactQueryGenerator,
    fileWriter,
    workspaceRoot
  );

  const sidebarProvider = new SidebarViewProvider(
    context.extensionUri,
    controller,
    outputChannel,
    workspaceRoot
  );
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

export function deactivate(): void { }
