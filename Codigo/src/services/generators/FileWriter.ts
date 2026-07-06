import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export class FileWriter {
  async writeArtifacts(outputPath: string, files: Record<string, string>): Promise<string[]> {
    await mkdir(outputPath, { recursive: true });

    const writtenFiles: string[] = [];

    for (const [fileName, content] of Object.entries(files)) {
      const targetPath = join(outputPath, fileName);
      // Support nested file-name keys (e.g. "models/user.ts") by ensuring the
      // file's parent directory exists before writing.
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, 'utf8');
      writtenFiles.push(resolve(targetPath));
    }

    return writtenFiles;
  }
}
