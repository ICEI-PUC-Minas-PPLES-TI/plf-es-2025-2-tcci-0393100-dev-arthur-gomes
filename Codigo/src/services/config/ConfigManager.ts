import * as vscode from 'vscode';
import type { Config } from '../../models/config';

const CONFIG_STORAGE_KEY = 'plf-es-extension.config';
const SETTINGS_NAMESPACE = 'plfEs';
const SETTINGS_KEYS = {
  importPath: 'importPath',
  outputPath: 'outputPath',
  baseURL: 'baseURL',
  adapter: 'adapter',
} as const;

export class ConfigManager {
  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly defaultOutputPath: string
  ) {}

  async getConfig(): Promise<Config> {
    const stored = this.workspaceState.get<Config>(CONFIG_STORAGE_KEY);
    const workspaceConfig = this.getWorkspaceConfig();

    return {
      ...workspaceConfig,
      ...stored,
      outputPath: stored?.outputPath ?? workspaceConfig.outputPath ?? this.defaultOutputPath,
      adapter: 'fetch',
    };
  }

  async setConfig(configuration: Config): Promise<void> {
    const normalized: Config = {
      ...configuration,
      outputPath: configuration.outputPath ?? this.defaultOutputPath,
      adapter: 'fetch',
    };

    await this.workspaceState.update(CONFIG_STORAGE_KEY, normalized);
    await this.syncVisibleFieldsToWorkspaceSettings(normalized);
  }

  async mergeConfig(partial: Partial<Config>): Promise<Config> {
    const current = await this.getConfig();
    const next = {
      ...current,
      ...partial,
      adapter: 'fetch' as const,
    };

    await this.setConfig(next);
    return next;
  }

  private getWorkspaceConfig(): Partial<Config> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return {};
    }

    const configuration = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);

    return {
      importPath: this.getWorkspaceValue<string>(configuration, SETTINGS_KEYS.importPath),
      outputPath: this.getWorkspaceValue<string>(configuration, SETTINGS_KEYS.outputPath),
      baseURL: this.getWorkspaceValue<string>(configuration, SETTINGS_KEYS.baseURL),
      adapter: 'fetch',
    };
  }

  private getWorkspaceValue<T>(
    configuration: vscode.WorkspaceConfiguration,
    key: string
  ): T | undefined {
    const inspected = configuration.inspect<T>(key);
    if (!inspected) {
      return undefined;
    }

    return (inspected.workspaceFolderValue as T | undefined) ?? (inspected.workspaceValue as T | undefined);
  }

  private async syncVisibleFieldsToWorkspaceSettings(configuration: Config): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) {
      return;
    }

    const workspaceConfiguration = vscode.workspace.getConfiguration(SETTINGS_NAMESPACE);

    await Promise.all([
      workspaceConfiguration.update(
        SETTINGS_KEYS.importPath,
        configuration.importPath,
        vscode.ConfigurationTarget.Workspace
      ),
      workspaceConfiguration.update(
        SETTINGS_KEYS.outputPath,
        configuration.outputPath,
        vscode.ConfigurationTarget.Workspace
      ),
      workspaceConfiguration.update(
        SETTINGS_KEYS.baseURL,
        configuration.baseURL,
        vscode.ConfigurationTarget.Workspace
      ),
      workspaceConfiguration.update(
        SETTINGS_KEYS.adapter,
        'fetch',
        vscode.ConfigurationTarget.Workspace
      ),
    ]);
  }
}
