import {
  isRequestTimeout,
  REQUEST_TIMEOUT_MS,
  STORAGE_TIMEOUT_MS,
  timeoutForUrl,
  withRequestTimeout,
} from './fetch-timeout';

const API_URL = 'https://example.supabase.co/rest/v1/circles?select=id';
const STORAGE_URL = 'https://example.supabase.co/storage/v1/object/avatars/u/avatar.jpeg';

/** A fetch that never answers — the SUP1 case. Rejects the way a real
 * fetch does once its signal aborts, and never otherwise. */
function hangingFetch() {
  return jest.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => {
        const aborted = new Error('Aborted');
        aborted.name = 'AbortError';
        reject(aborted);
      };
      // Real implementations check `aborted` up front as well as
      // listening (whatwg-fetch, which backs RN's fetch, rejects
      // immediately on an already-aborted signal) — the mock has to do
      // both or it tests something no platform actually does.
      if (init?.signal?.aborted) return abort();
      init?.signal?.addEventListener('abort', abort);
    });
  });
}

describe('timeoutForUrl', () => {
  it('gives API traffic the short ceiling', () => {
    expect(timeoutForUrl(API_URL)).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutForUrl('https://example.supabase.co/auth/v1/token')).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutForUrl('https://example.supabase.co/functions/v1/delete-account')).toBe(
      REQUEST_TIMEOUT_MS
    );
  });

  it('gives storage objects the upload ceiling, which is longer', () => {
    expect(timeoutForUrl(STORAGE_URL)).toBe(STORAGE_TIMEOUT_MS);
    expect(STORAGE_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });
});

describe('withRequestTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a successful response straight through', async () => {
    const ok = new Response('{}', { status: 200 });
    const wrapped = withRequestTimeout(jest.fn().mockResolvedValue(ok));

    await expect(wrapped(API_URL)).resolves.toBe(ok);
    // The deadline is cleared on settle, so a completed request leaves
    // nothing scheduled behind it.
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects a request that never returns, at the API ceiling', async () => {
    const impl = hangingFetch();
    const wrapped = withRequestTimeout(impl);
    const pending = wrapped(API_URL);
    const settled = jest.fn();
    pending.catch(settled);

    // Still waiting one tick before the deadline: a slow request is not
    // punished early.
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({
      name: 'AbortError',
      message: `Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    });
  });

  it('actually aborts the underlying request rather than just rejecting', async () => {
    const impl = hangingFetch();
    const wrapped = withRequestTimeout(impl);
    const pending = wrapped(API_URL);
    pending.catch(() => {});

    const passedSignal = impl.mock.calls[0][1]?.signal;
    expect(passedSignal?.aborted).toBe(false);

    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(passedSignal?.aborted).toBe(true);
    await expect(pending).rejects.toThrow();
  });

  it('holds a storage upload to the longer ceiling, not the API one', async () => {
    const impl = hangingFetch();
    const wrapped = withRequestTimeout(impl);
    const pending = wrapped(STORAGE_URL);
    const settled = jest.fn();
    pending.catch(settled);

    // A photo still uploading well past the API ceiling is not killed.
    await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS * 2);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(STORAGE_TIMEOUT_MS - REQUEST_TIMEOUT_MS * 2);
    await expect(pending).rejects.toMatchObject({
      message: `Supabase request timed out after ${STORAGE_TIMEOUT_MS}ms`,
    });
  });

  it("lets a caller's own cancellation still win, and keeps its error", async () => {
    const impl = hangingFetch();
    const wrapped = withRequestTimeout(impl);
    const caller = new AbortController();
    const pending = wrapped(API_URL, { signal: caller.signal });
    pending.catch(() => {});

    caller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Aborted' });
    // Ours, not the caller's, is the one that carries the timeout text.
    await expect(pending).rejects.not.toMatchObject({
      message: `Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not hang when the caller hands it an already-aborted signal', async () => {
    const impl = hangingFetch();
    const wrapped = withRequestTimeout(impl);
    const caller = new AbortController();
    caller.abort();

    await expect(wrapped(API_URL, { signal: caller.signal })).rejects.toThrow();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('leaves the caller-supplied init otherwise untouched', async () => {
    const impl = jest.fn().mockResolvedValue(new Response('{}'));
    const wrapped = withRequestTimeout(impl);

    await wrapped(API_URL, { method: 'POST', body: '{"a":1}', headers: { apikey: 'k' } });

    expect(impl).toHaveBeenCalledWith(
      API_URL,
      expect.objectContaining({
        method: 'POST',
        body: '{"a":1}',
        headers: { apikey: 'k' },
        signal: expect.anything(),
      })
    );
  });
});

/**
 * HY1 job 7 — the deadline is only useful to a screen if the screen can
 * RECOGNISE it, and there are two different shapes to recognise.
 */
describe('isRequestTimeout', () => {
  it('matches the real AbortError the wrapper throws', () => {
    const e = new Error(`Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    e.name = 'AbortError';
    expect(isRequestTimeout(e)).toBe(true);
  });

  it('matches postgrest-js\u2019s CONVERTED shape — the one screens actually see', () => {
    // THE POINT OF THE FUNCTION. PostgrestBuilder catches the fetch
    // rejection and resolves with `{ error }` instead, so what reaches a
    // screen is a plain object with no `name` at all — every PostgREST
    // read, RPC and write in the app arrives this way. A `name`-only
    // check would have matched nothing that matters.
    expect(
      isRequestTimeout({
        message: `AbortError: Supabase request timed out after ${REQUEST_TIMEOUT_MS}ms`,
        details: '',
        hint: 'Request was aborted (timeout or manual cancellation)',
        code: '',
      })
    ).toBe(true);
  });

  it('matches the ABORT_ERR code variant', () => {
    expect(isRequestTimeout({ code: 'ABORT_ERR' })).toBe(true);
  });

  it('does NOT match an ordinary failure — the screen must still say "couldn\u2019t load"', () => {
    expect(isRequestTimeout(new Error('permission denied for table circles'))).toBe(false);
    expect(isRequestTimeout({ message: 'JWT expired', code: 'PGRST301' })).toBe(false);
  });

  it('does not match a message that merely mentions an abort mid-sentence', () => {
    // `startsWith`, not `includes`: a user-facing P0001 message quoting
    // the word must never be mistaken for the deadline.
    expect(isRequestTimeout({ message: 'the practice was AbortError: renamed' })).toBe(false);
  });

  it('survives the shapes a catch block genuinely receives', () => {
    expect(isRequestTimeout(null)).toBe(false);
    expect(isRequestTimeout(undefined)).toBe(false);
    expect(isRequestTimeout('AbortError: timed out')).toBe(false);
    expect(isRequestTimeout(42)).toBe(false);
    expect(isRequestTimeout({})).toBe(false);
  });
});
