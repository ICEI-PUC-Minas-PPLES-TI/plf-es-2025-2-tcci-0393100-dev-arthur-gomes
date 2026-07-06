import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileWriter } from '../../src/services/generators/FileWriter';

const directories: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'plf-es-filewriter-'));
  directories.push(dir);
  return dir;
}

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
    const dir = await makeDir();
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

  it('overwrite truncates old content (old value absent)', async () => {
    const dir = await makeDir();
    const writer = new FileWriter();

    await writer.writeArtifacts(dir, { 'a.ts': 'AAAAAAAAAAAAAAA old long content' });
    await writer.writeArtifacts(dir, { 'a.ts': 'new' });

    const content = await readFile(join(dir, 'a.ts'), 'utf8');
    expect(content).toBe('new');
    expect(content).not.toContain('old');
  });

  it('writes all files verbatim as utf8 and returns absolute paths in insertion order', async () => {
    const dir = await makeDir();
    const writer = new FileWriter();

    const written = await writer.writeArtifacts(dir, {
      'types.ts': 'T',
      'transport.ts': 'X',
      'api.ts': 'A',
    });

    expect(written).toEqual([
      resolve(join(dir, 'types.ts')),
      resolve(join(dir, 'transport.ts')),
      resolve(join(dir, 'api.ts')),
    ]);
    expect(await readFile(written[1], 'utf8')).toBe('X');
  });

  it('recursively creates a multi-segment output path', async () => {
    const base = await makeDir();
    const nested = join(base, 'deep', 'nested', 'out');
    const writer = new FileWriter();

    const written = await writer.writeArtifacts(nested, { 'x.ts': 'ok' });

    expect((await stat(nested)).isDirectory()).toBe(true);
    expect(await readFile(written[0], 'utf8')).toBe('ok');
  });

  it('round-trips unicode/emoji content', async () => {
    const dir = await makeDir();
    const writer = new FileWriter();
    const payload = '// café ☕ 🚀 éè\n';

    const [path] = await writer.writeArtifacts(dir, { 'u.ts': payload });
    expect(await readFile(path, 'utf8')).toBe(payload);
  });

  it('creates the directory and returns [] for an empty files map', async () => {
    const base = await makeDir();
    const target = join(base, 'created');
    const writer = new FileWriter();

    const written = await writer.writeArtifacts(target, {});

    expect(written).toEqual([]);
    expect((await stat(target)).isDirectory()).toBe(true);
  });

  it('writes nested file-name keys by creating their parent directories', async () => {
    const dir = await makeDir();
    const writer = new FileWriter();

    const [path] = await writer.writeArtifacts(dir, { 'sub/models/user.ts': 'export const x = 1;' });

    expect(path).toBe(resolve(join(dir, 'sub/models/user.ts')));
    expect(await readFile(path, 'utf8')).toBe('export const x = 1;');
  });
});
