import { describe, expect, it } from 'vitest';
import type { Config } from '../../src/models/config';
import { programCheck, transpileCheck } from '../helpers/compileHarness';
import { buildBundle, emptyResponsesOperation, sampleOperations } from '../fixtures/sdk';

const fetchConfig: Config = { adapter: 'fetch', baseURL: 'https://api.example.com', outputPath: '/tmp/out' };
const axiosConfig: Config = { adapter: 'axios', baseURL: 'https://api.example.com', outputPath: '/tmp/out' };
const rqConfig: Config = { adapter: 'react-query', baseURL: 'https://api.example.com', outputPath: '/tmp/out' };

function diag(result: { ok: boolean; messages: string[] }): string {
  return result.messages.join('\n');
}

describe('Tier A — transpile smoke', () => {
  it('every generated file is syntactically valid (fetch + axios)', () => {
    for (const config of [fetchConfig, axiosConfig]) {
      const bundle = buildBundle(config);
      for (const [name, source] of Object.entries(bundle)) {
        const result = transpileCheck(source);
        expect(result.ok, `${config.adapter}/${name}: ${diag(result)}`).toBe(true);
      }
    }
  });

  it('react-query module is syntactically valid', () => {
    const bundle = buildBundle(rqConfig);
    const result = transpileCheck(bundle['react-query.ts']);
    expect(result.ok, diag(result)).toBe(true);
  });
});

describe('Tier B — whole-bundle type-check', () => {
  it('fetch bundle type-checks with zero diagnostics', () => {
    const result = programCheck(buildBundle(fetchConfig));
    expect(result.ok, diag(result)).toBe(true);
  });

  it('axios bundle type-checks against the stubbed axios module', () => {
    const result = programCheck(buildBundle(axiosConfig));
    expect(result.ok, diag(result)).toBe(true);
  });

  it('react-query bundle type-checks against the stubbed @tanstack module', () => {
    const result = programCheck(buildBundle(rqConfig));
    expect(result.ok, diag(result)).toBe(true);
  });
});

describe('Tier B — harness sanity (synthetic broken bundle)', () => {
  it('reports a missing-member error (TS2694), not a module-resolution error (TS2307)', () => {
    // Hand-crafted bundle: api.ts references a type the (empty) types.ts never declares.
    const result = programCheck({
      'types.ts': '// no types declared\nexport {};\n',
      'api.ts':
        "import type * as Types from './types';\n" +
        'export async function ping(): Promise<Types.PingResponse200> {\n' +
        '  return undefined as never;\n' +
        '}\n',
    });

    expect(result.ok).toBe(false);
    // TS2694: namespace has no exported member (referenced in a type position).
    expect(result.codes).toContain(2694);
    // Must NOT be TS2307 — that would mean the module stubs are broken, masking real bugs.
    expect(result.codes).not.toContain(2307);
    expect(diag(result)).toContain('PingResponse200');
  });
});

describe('Tier B — regression: empty-responses operation', () => {
  it('compiles cleanly now that generators fall back to `unknown` instead of a dangling response type', () => {
    const bundle = buildBundle(fetchConfig, [...sampleOperations, emptyResponsesOperation]);
    const result = programCheck(bundle);
    expect(result.ok, diag(result)).toBe(true);
  });

  it('emits Promise<unknown> for the empty-responses method', () => {
    const bundle = buildBundle(fetchConfig, [emptyResponsesOperation]);
    expect(bundle['api.ts']).toContain('export async function ping(args: Types.PingRequestArgs = {}): Promise<unknown>');
  });
});
