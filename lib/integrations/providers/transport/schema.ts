/** Validates shared provider identities and JSON boundaries without applying operation or retry policy. */

import { z } from "zod";

/** Provider-local identities must remain representable as exact positive integers. */
export const ProviderIdentitySchema = z.number().int().positive().safe();

/** Minimal creation acknowledgement for a provider resource with an independent numeric namespace. */
export const ProviderResourceIdentitySchema = z.object({ id: ProviderIdentitySchema });

/** Decode one JSON response as unknown and validate it through its owning boundary schema.
 * @param output - External command response requiring JSON decoding.
 * @param schema - Owning provider response contract.
 */
export function parseProviderJson<T>(output: string, schema: z.ZodType<T>): T {
  const response: unknown = JSON.parse(output);

  return schema.parse(response);
}
