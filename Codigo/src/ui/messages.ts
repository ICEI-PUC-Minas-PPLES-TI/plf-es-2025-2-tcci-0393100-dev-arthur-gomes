export interface UIConfigPayload {
  baseURL?: string;
  importPath?: string;
  outputPath?: string;
  hasOpenAPI: boolean;
}

export type UIToExtensionMessage =
  | { type: 'ui:ready' }
  | {
      type: 'ui:log';
      payload: {
        level: 'info' | 'error';
        message: string;
      };
    }
  | {
      type: 'ui:import';
      payload: {
        source: string;
        baseURL?: string;
        outputPath?: string;
      };
    }
  | {
      type: 'ui:generate';
      payload?: {
        baseURL?: string;
        outputPath?: string;
      };
    }
  | {
      type: 'ui:updateConfig';
      payload: {
        baseURL?: string;
        outputPath?: string;
      };
    };

export type ExtensionToUIMessage =
  | {
      type: 'config:loaded';
      payload: UIConfigPayload;
    }
  | {
      type: 'import:success';
      payload: {
        operations: number;
        schemas: number;
        warnings?: string[];
      };
    }
  | {
      type: 'import:error';
      payload: {
        errors: string[];
        warnings?: string[];
      };
    }
  | {
      type: 'generate:success';
      payload: {
        files: string[];
        warnings?: string[];
      };
    }
  | {
      type: 'generate:error';
      payload: {
        errors: string[];
        warnings?: string[];
      };
    };
