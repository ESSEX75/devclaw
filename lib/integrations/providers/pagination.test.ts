/** Exercises complete CLI page decoding and rejects partial or malformed observations. */

import assert from "node:assert/strict";
import { it } from "node:test";
import { z } from "zod";

import { parseProviderPages } from "./pagination.js";

it("decodes every gh slurped page and glab concatenated page without splitting escaped text", () => {
  const schema = z.object({ id: z.number(), text: z.string() });
  const pages = [[{ id: 1, text: 'nested [ ] { } and "quotes"' }], [{ id: 2, text: "line\nbreak" }]];
  assert.deepEqual(parseProviderPages(JSON.stringify(pages), schema, true), pages.flat());
  assert.deepEqual(parseProviderPages(pages.map(page => JSON.stringify(page)).join("\n"), schema, false), pages.flat());
  assert.deepEqual(parseProviderPages("[]", schema, false), []);
});

it("never publishes a prefix of truncated pages or malformed element shapes", () => {
  const schema = z.object({ id: z.number() });
  for (const output of ["", '[{"id":1}]\n[{"id":2}', '[{"id":1}]\n{"id":2}', '[{"id":"wrong"}]']) {
    assert.throws(() => parseProviderPages(output, schema, false));
  }
  assert.throws(() => parseProviderPages('[[{"id":1}],', schema, true));
  assert.throws(() => parseProviderPages("[]", schema, true));
});
