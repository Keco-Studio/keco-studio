const defaultSleep = (durationMs) => new Promise((resolve) => setTimeout(resolve, durationMs));

function watchRuntime(child) {
  return new Promise((resolve) => {
    child.once('error', (error) => resolve({ type: 'error', error }));
    child.once('exit', (code, signal) => resolve({ type: 'exit', code, signal }));
  });
}

function describeExit(event) {
  if (event.type === 'error') return event.error.message;
  if (event.signal) return `signal ${event.signal}`;
  return `code ${event.code ?? 1}`;
}

export async function startRuntimeWithRetry({
  spawnRuntime,
  stopRuntime,
  probeReady,
  onAttempt = () => {},
  sleep = defaultSleep,
  timeoutMs = 110_000,
  retryDelayMs = 1_000,
  pollIntervalMs = 250,
  maxAttempts = 2,
  log = console.warn,
}) {
  const deadline = Date.now() + timeoutMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const child = spawnRuntime();
    onAttempt(child);
    const exitPromise = watchRuntime(child);
    let earlyExit = null;

    while (Date.now() < deadline) {
      const state = await Promise.race([
        exitPromise.then((event) => ({ type: 'exit', event })),
        Promise.resolve()
          .then(probeReady)
          .catch(() => false)
          .then(async (ready) => {
            if (!ready) await sleep(pollIntervalMs);
            return { type: 'probe', ready };
          }),
      ]);

      if (state.type === 'exit') {
        earlyExit = state.event;
        break;
      }
      if (state.ready) return { child, exitPromise };
    }

    if (!earlyExit) {
      child.kill('SIGTERM');
      stopRuntime();
      throw new Error('Local MCP Edge runtime did not become ready');
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `Local MCP Edge runtime exited before readiness after ${attempt} attempts (${describeExit(earlyExit)})`,
      );
    }

    log(
      `Local MCP Edge runtime exited before readiness (${describeExit(earlyExit)}); `
      + `cleaning and retrying (${attempt + 1}/${maxAttempts})...`,
    );
    stopRuntime();
    await sleep(retryDelayMs);
  }

  throw new Error('Local MCP Edge runtime failed to start');
}
