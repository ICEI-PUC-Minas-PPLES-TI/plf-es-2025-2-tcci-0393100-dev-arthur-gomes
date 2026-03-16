import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWriter } from '../../src/services/generators/FileWriter';

const directories: string[] = [];

afterEach(async () => {
  while (directories.length > 0) {
    const dir = directories.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('FileWriter', () => {
  it('writes artifacts and overwrites existing files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plf-es-filewriter-'));
    directories.push(dir);

    const writer = new FileWriter();

    await writer.writeArtifacts(dir, {
      'types.ts': 'export type A = string;\n',
      'client.ts': 'export const a = 1;\n',
      'index.ts': "export * from './types';\n",
    });

    await writer.writeArtifacts(dir, {
      'types.ts': 'export type A = number;\n',
      'client.ts': 'export const a = 2;\n',
      'index.ts': "export * from './client';\n",
    });

    const content = await readFile(join(dir, 'types.ts'), 'utf8');
    expect(content).toContain('number');
  });
});
