/**
 * HY1 job 6 (R8) — lib/account.ts, first test. Ten lines of code, and the
 * most destructive path in the app: it is irreversible, it is the only
 * caller of the service-role `delete-account` edge function, and its
 * caller (your-data.tsx) signs the person OUT and routes to /sign-in the
 * instant it resolves.
 *
 * SO THE ONE THING THAT MATTERS HERE IS THE FAILURE SHAPE. `functions
 * .invoke` does NOT reject on a non-2xx — it resolves with `{ data: null,
 * error }`, which is exactly the shape a `return` instead of a `throw`
 * would swallow. Swallowing it would resolve the promise, sign the person
 * out and send them to /sign-in with their account fully intact and no
 * error shown: they would believe they had deleted everything. DEL1 is
 * the reason this is not theoretical — a missing CORS header made every
 * browser delete fail for real, and it took a debug session to find.
 *
 * The deletion itself (cascades, hosted-circle transfer, the auth user)
 * belongs to the edge function and is proven against the live project on
 * disposable accounts, never here.
 */
import { deleteMyAccount } from './account';
import { supabase } from './supabase';

const invoke = jest.fn();

beforeEach(() => {
  invoke.mockReset();
  (supabase as unknown as { functions: { invoke: jest.Mock } }).functions = { invoke };
});

test('calls the delete-account edge function by name, as a POST', async () => {
  // Pinned because the function name and method are a contract with
  // supabase/functions/delete-account: a rename on either side that this
  // test does not catch fails only in production, on the one action that
  // cannot be undone.
  invoke.mockResolvedValue({ data: { ok: true }, error: null });

  await expect(deleteMyAccount()).resolves.toBeUndefined();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' });
});

test('THROWS on a returned error — never resolves a delete that did not happen', async () => {
  // THE REGRESSION THIS EXISTS FOR. `functions.invoke` resolves with
  // `{ error }` rather than rejecting, so any refactor that stops
  // re-throwing turns a failed delete into a silent success: the caller
  // signs the person out and routes to /sign-in with everything still
  // there.
  invoke.mockResolvedValue({ data: null, error: new Error('FunctionsHttpError: 500') });

  await expect(deleteMyAccount()).rejects.toThrow('FunctionsHttpError: 500');
});

test('the DEL1 shape specifically — a CORS/network failure is a failure, not a delete', async () => {
  // 20 July: `delete-account`'s CORS allow-list was missing
  // x-client-info, so every browser delete failed as a FunctionsFetchError
  // while the UI had no way to know. That arrives here as `{ error }` too.
  invoke.mockResolvedValue({
    data: null,
    error: Object.assign(new Error('Failed to send a request to the Edge Function'), {
      name: 'FunctionsFetchError',
    }),
  });

  await expect(deleteMyAccount()).rejects.toThrow(/Failed to send a request/);
});

test('a non-Error error object still throws rather than passing silently', async () => {
  // Supabase failures are not always Error instances. The screen's own
  // handler falls back to the warm line for anything without `.message`
  // (your-data.tsx), so the only requirement here is that it throws.
  invoke.mockResolvedValue({ data: null, error: { message: 'nope', status: 401 } });

  await expect(deleteMyAccount()).rejects.toEqual({ message: 'nope', status: 401 });
});

test('a rejected invoke propagates untouched — no catch may soften it', async () => {
  invoke.mockRejectedValue(new Error('network down'));

  await expect(deleteMyAccount()).rejects.toThrow('network down');
});
