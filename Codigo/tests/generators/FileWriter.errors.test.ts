import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

import { mkdir, writeFile } from 'node:fs/promises';
import { FileWriter } from '../../src/services/generators/FileWriter';

const mkdirMock = vi.mocked(mkdir);
const writeFileMock = vi.mocked(writeFile);

describe('FileWriter (error paths)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
  });

  it('short-circuits when mkdir rejects (writeFile never called)', async () => {
    mkdirMock.mockRejectedValueOnce(new Error('EACCES'));

    await expect(
      new FileWriter().writeArtifacts('/out', { 'a.ts': 'x' })
    ).rejects.toThrow('EACCES');
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it('aborts the loop when writeFile rejects mid-way', async () => {
    writeFileMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(
      new FileWriter().writeArtifacts('/out', { 'a.ts': '1', 'b.ts': '2', 'c.ts': '3' })
    ).rejects.toThrow('disk full');

    // Wrote a.ts, threw on b.ts, never reached c.ts.
    expect(writeFileMock).toHaveBeenCalledTimes(2);
  });
});
