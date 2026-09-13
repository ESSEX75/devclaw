/**
 * Provides atomic file replacement for state repositories without owning serialization policy.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Replace a file by renaming a uniquely named sibling temporary file.
 * The temporary file is removed when writing or renaming fails.
 *
 * @param filePath - Destination file owned by a state repository.
 * @param content - Complete content that should replace the destination.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, content, "utf-8");
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

/**
 * Serialize a value as formatted JSON and replace its destination atomically.
 *
 * @param filePath - Destination JSON file owned by a state repository.
 * @param value - Validated value to serialize.
 */
export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
