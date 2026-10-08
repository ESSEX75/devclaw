/** Creates isolated resilience policies; only reads and declared idempotent mutations may replay. */

import { circuitBreaker, ConsecutiveBreaker, ExponentialBackoff, handleWhen, type IPolicy, retry, wrap } from "cockatiel";

import { PROVIDER_OPERATION_ERROR } from "../errors/index.js";
import { classifyProviderOperationError } from "../errors/index.js";
import { PROVIDER_COMMAND_MODE, PROVIDER_TRANSPORT_POLICY } from "./const.js";
import type { ProviderCommandMode } from "./types.js";

/** Create a policy owned by one adapter instance; permanent failures never open its breaker. */
export function createProviderPolicy(): IPolicy {
  const retryPolicy = retry(handleWhen(error => classifyProviderOperationError(error).retryable), {
    maxAttempts: PROVIDER_TRANSPORT_POLICY.RETRIES,
    backoff: new ExponentialBackoff({ initialDelay: PROVIDER_TRANSPORT_POLICY.INITIAL_DELAY_MS, maxDelay: PROVIDER_TRANSPORT_POLICY.MAX_DELAY_MS }),
  });
  const breakerPolicy = circuitBreaker(handleWhen(error => classifyProviderOperationError(error).code === PROVIDER_OPERATION_ERROR.TRANSIENT), {
    halfOpenAfter: PROVIDER_TRANSPORT_POLICY.BREAKER_RESET_MS,
    breaker: new ConsecutiveBreaker(PROVIDER_TRANSPORT_POLICY.BREAKER_FAILURES),
  });

  return wrap(breakerPolicy, retryPolicy);
}

/** Apply replay policy only to operations with explicit replay safety.
 * @param mode - Read, idempotent mutation, or one non-replayable mutation.
 * @param policy - Policy owned by this adapter, never a global breaker.
 * @param fn - Single transport attempt.
 */
export function withResilience<T>(mode: ProviderCommandMode, policy: IPolicy, fn: () => Promise<T>): Promise<T> {
  return mode === PROVIDER_COMMAND_MODE.ONCE ? fn() : policy.execute(() => fn());
}
