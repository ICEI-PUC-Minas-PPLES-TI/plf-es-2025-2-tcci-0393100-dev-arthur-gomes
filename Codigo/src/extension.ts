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
import { SidebarViewProvider } from './ui/SidebarViewProvider';
import type { ExtensionToUIMessage } from './ui/messages';

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

  const changeToExtensionTabCommand = vscode.commands.registerCommand(
    'plf-es-extension.changeToExtensionTab',
    async () => {
      outputChannel.appendLine('[info] Change to extension tab command invoked.');
      await sidebarProvider.changeToExtensionTab();
    }
  );

  context.subscriptions.push(
    importCommand,
    generateCommand,
    changeToExtensionTabCommand,
    outputChannel
  );
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

export function deactivate(): void { }
