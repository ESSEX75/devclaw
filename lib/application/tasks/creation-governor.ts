/**
 * Coordinates managed-issue creation within one provider/project scope.
 * Serial execution prevents concurrent sagas from independently spending the same observed quota.
 */

const scopeTails = new Map<string, Promise<void>>();

/** Run one creation saga after prior work in the same provider scope has released its permit. */
export async function withCreationPermit<T>(scope: string, operation: () => Promise<T>): Promise<T> {
  const prior = scopeTails.get(scope) ?? Promise.resolve();
  let releasePermit: (() => void) | undefined;
  const permit = new Promise<void>((resolve) => {
    releasePermit = resolve;
  });
  const tail = prior.then(() => permit);

  scopeTails.set(scope, tail);
  await prior;
  try {
    return await operation();
  } finally {
    releasePermit?.();
    if (scopeTails.get(scope) === tail) scopeTails.delete(scope);
  }
}
