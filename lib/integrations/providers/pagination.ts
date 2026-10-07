/** Decodes complete paginated CLI collections, rejecting truncated JSON and preserving every page. */

import { z } from "zod";

/** Decode gh's slurped pages or glab's concatenated array documents with boundary validation.
 * Partial transport output and malformed documents throw instead of yielding a partial collection.
 * @param output - Complete successful CLI stdout.
 * @param schema - Schema owned by the provider for each array element.
 * @param slurped - Whether the CLI wrapped page arrays into a single outer array.
 */
export function parseProviderPages<T>(output: string, schema: z.ZodType<T>, slurped: boolean): T[] {
  if (slurped) {
    const raw: unknown = JSON.parse(output);

    return z.array(z.array(schema)).min(1).parse(raw).flat();
  }

  const pages: T[][] = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;

  for (let index = 0; index < output.length; index++) {
    const char = output[index];

    if (start < 0) {
      if (/\s/.test(char)) continue;
      if (char !== "[") throw new Error("Provider page must be a JSON array.");
      start = index;
    }

    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;

    if (!quoted && depth === 0) {
      const raw: unknown = JSON.parse(output.slice(start, index + 1));

      pages.push(z.array(schema).parse(raw));
      start = -1;
    }
  }

  if (start >= 0 || quoted || !pages.length) throw new Error("Provider pagination returned incomplete JSON.");

  return pages.flat();
}
