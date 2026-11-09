const { createScheduler } = require('../src/services/backgroundJob.service');
describe('background scheduler lifecycle', () => {
  let log;
  let clock;
  beforeEach(() => {
    jest.useFakeTimers();
    clock = { scheduleTimeout: globalThis.setTimeout, cancelTimeout: globalThis.clearTimeout };
    log = { info: jest.fn(), error: jest.fn() };
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('starts immediately, never overlaps slow runs and waits for work during shutdown', async () => {
    let release;
    const execute = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const scheduler = createScheduler([{ name: 'slow', intervalMs: 1000 }], {
      execute,
      log,
      ...clock,
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(execute).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(10000);
    expect(execute).toHaveBeenCalledTimes(1);
    let stopped = false;
    const closing = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release({ skipped: false, result: { processed: 1 } });
    await closing;
    await jest.advanceTimersByTimeAsync(10000);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('retries failures, isolates notification delivery from maintenance and clears future timers', async () => {
    const execute = jest.fn(async ({ name }) => {
      if (name === 'maintenance') throw new Error('provider error must not be logged verbatim');
      return { skipped: false, result: { processed: 1 } };
    });
    const scheduler = createScheduler(
      [
        { name: 'maintenance', intervalMs: 1000 },
        { name: 'notifications', intervalMs: 500 },
      ],
      { execute, log, ...clock },
    );
    await jest.advanceTimersByTimeAsync(1000);
    expect(execute.mock.calls.filter(([job]) => job.name === 'maintenance')).toHaveLength(2);
    expect(execute.mock.calls.filter(([job]) => job.name === 'notifications')).toHaveLength(3);
    expect(log.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('provider error must');
    await scheduler.stop();
    const calls = execute.mock.calls.length;
    await jest.advanceTimersByTimeAsync(10000);
    expect(execute).toHaveBeenCalledTimes(calls);
  });
});
