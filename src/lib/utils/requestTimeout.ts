/**
 * Wrap a promise with a timeout. Rejects if the promise does not resolve within ms.
 * Used to avoid indefinite loading when requests hang (e.g. auth/session not ready, slow network).
 */

const TIMEOUT_ERROR = new Error('Request timed out');

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(TIMEOUT_ERROR);
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function isTimeoutError(err: unknown): boolean {
  return err === TIMEOUT_ERROR || (err instanceof Error && err.message === 'Request timed out');
}
