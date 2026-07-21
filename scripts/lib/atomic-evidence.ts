import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';

export async function replaceEvidenceAtomically(
  output: string,
  produce: () => Promise<unknown>
): Promise<void> {
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`;
  await rm(output, { force: true });

  try {
    const evidence = await produce();
    await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    await rename(temporary, output);
  } catch (error) {
    await Promise.all([
      rm(temporary, { force: true }),
      rm(output, { force: true }),
    ]);
    throw error;
  }
}
