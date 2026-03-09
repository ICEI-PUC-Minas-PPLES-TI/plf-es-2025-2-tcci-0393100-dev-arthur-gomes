"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
class SidebarViewProvider {
    constructor(_extensionUri) {
        this._extensionUri = _extensionUri;
    }
    resolveWebviewView(webviewView, _context, _token) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };
        webviewView.webview.html = this._getHtmlContent();
    }
    _getHtmlContent() {
        return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<style>
				body {
					padding: 10px;
					color: var(--vscode-foreground);
					font-family: var(--vscode-font-family);
				}
				h2 {
					font-size: 14px;
					margin-bottom: 10px;
				}
				p {
					font-size: 13px;
					line-height: 1.5;
				}
				button {
					width: 100%;
					padding: 8px;
					margin-top: 10px;
					background: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					border-radius: 2px;
					cursor: pointer;
				}
				button:hover {
					background: var(--vscode-button-hoverBackground);
				}
			</style>
		</head>
		<body>
			<h2>Swagger to SDK</h2>
			<p>Welcome to the Swagger to SDK sidebar.</p>
		</body>
		</html>`;
    }
}
SidebarViewProvider.viewType = 'plf-es-view';
function activate(context) {
    console.log('Extension "plf-es-extension" is now active!');
    const sidebarProvider = new SidebarViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(SidebarViewProvider.viewType, sidebarProvider));
    const disposable = vscode.commands.registerCommand('plf-es-extension.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from PLF ES Extension!');
    });
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map