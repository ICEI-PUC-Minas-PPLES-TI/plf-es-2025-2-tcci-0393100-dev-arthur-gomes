import { assertType, describe, expectTypeOf, it } from 'vitest';
import type { AdapterKind } from '../../src/models/config';
import type {
  ExtensionToUIMessage,
  UIConfigPayload,
  UIToExtensionMessage,
} from '../../src/ui/messages';

describe('UIToExtensionMessage contract', () => {
  it('ui:generate payload is optional but ui:updateConfig payload is required', () => {
    assertType<UIToExtensionMessage>({ type: 'ui:generate' });
    assertType<UIToExtensionMessage>({ type: 'ui:generate', payload: { adapter: 'axios' } });

    // @ts-expect-error ui:updateConfig requires a payload
    assertType<UIToExtensionMessage>({ type: 'ui:updateConfig' });
    assertType<UIToExtensionMessage>({ type: 'ui:updateConfig', payload: {} });
  });

  it('bare variants reject a payload once narrowed', () => {
    // @ts-expect-error ui:ready has no payload
    assertType<UIToExtensionMessage>({ type: 'ui:ready', payload: {} });
    // @ts-expect-error ui:reload has no payload
    assertType<UIToExtensionMessage>({ type: 'ui:reload', payload: {} });
  });

  it('ui:log.level is a closed union of info | error', () => {
    assertType<UIToExtensionMessage>({ type: 'ui:log', payload: { level: 'info', message: 'x' } });
    assertType<UIToExtensionMessage>({ type: 'ui:log', payload: { level: 'error', message: 'x' } });
    // @ts-expect-error 'warn' is not a valid level
    assertType<UIToExtensionMessage>({ type: 'ui:log', payload: { level: 'warn', message: 'x' } });
  });

  it('ui:import requires a source', () => {
    assertType<UIToExtensionMessage>({ type: 'ui:import', payload: { source: '/s' } });
    // @ts-expect-error source is required
    assertType<UIToExtensionMessage>({ type: 'ui:import', payload: {} });
  });

  it('ui:setAdapter enforces AdapterKind literals', () => {
    assertType<UIToExtensionMessage>({ type: 'ui:setAdapter', payload: { adapter: 'react-query' } });
    // @ts-expect-error 'ky' is not an AdapterKind
    assertType<UIToExtensionMessage>({ type: 'ui:setAdapter', payload: { adapter: 'ky' } });
  });
});

describe('UIConfigPayload contract', () => {
  it('requires adapter/hasOpenAPI/adapterOptions and keeps the rest optional', () => {
    expectTypeOf<UIConfigPayload>().toMatchTypeOf<{
      adapter: AdapterKind;
      hasOpenAPI: boolean;
      adapterOptions: AdapterKind[];
    }>();

    assertType<UIConfigPayload>({ adapter: 'fetch', hasOpenAPI: false, adapterOptions: [] });
    // @ts-expect-error hasOpenAPI is required
    assertType<UIConfigPayload>({ adapter: 'fetch', adapterOptions: [] });
  });
});

describe('ExtensionToUIMessage contract', () => {
  it('import:success carries numeric counts and optional warnings', () => {
    assertType<ExtensionToUIMessage>({
      type: 'import:success',
      payload: { operations: 1, schemas: 2 },
    });
    // @ts-expect-error operations must be a number
    assertType<ExtensionToUIMessage>({ type: 'import:success', payload: { operations: '1', schemas: 2 } });
  });

  it('generate:success files is string[]; ext:focusStep.step is number', () => {
    assertType<ExtensionToUIMessage>({ type: 'generate:success', payload: { files: ['a.ts'] } });
    assertType<ExtensionToUIMessage>({ type: 'ext:focusStep', payload: { step: 1 } });
    // @ts-expect-error step must be a number
    assertType<ExtensionToUIMessage>({ type: 'ext:focusStep', payload: { step: '1' } });
  });
});
