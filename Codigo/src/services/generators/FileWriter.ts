import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class FileWriter {
  async writeArtifacts(outputPath: string, files: Record<string, string>): Promise<string[]> {
    await mkdir(outputPath, { recursive: true });

    const writtenFiles: string[] = [];

    for (const [fileName, content] of Object.entries(files)) {
      const targetPath = join(outputPath, fileName);
      await writeFile(targetPath, content, 'utf8');
      writtenFiles.push(resolve(targetPath));
    }

    return writtenFiles;
  }
}
