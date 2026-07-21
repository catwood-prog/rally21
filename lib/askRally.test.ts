import { AskRallyFetch, AskRallyTransportResponse, streamAskRally } from './askRally';
import { supabase } from './supabase';

/**
 * AR1 (21 July): React Native's built-in fetch has no streaming response
 * body, so the old getReader()-only read failed after a successful 200
 * ("Ask Rally request failed (200)" for a reply that existed). The
 * transport now streams when the response provides a body stream and
 * falls back to one buffered read when it doesn't — both branches pinned
 * here with mocked responses, per the section's VERIFY.
 */

function makeResponse(overrides: Partial<AskRallyTransportResponse>): AskRallyTransportResponse {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    body: null,
    text: async () => '',
    ...overrides,
  };
}

function streamingBody(chunks: string[]): AskRallyTransportResponse['body'] {
  const encoder = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () =>
        i < chunks.length
          ? { done: false, value: encoder.encode(chunks[i++]) }
          : { done: true, value: undefined },
    }),
  };
}

describe('streamAskRally — platform transport branches', () => {
  const getSession = supabase.auth.getSession as jest.Mock;

  beforeEach(() => {
    getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } } });
  });

  it('sends the request with auth headers and the startFresh flag', async () => {
    const fetchImpl = jest.fn(async () => makeResponse({ body: streamingBody(['hi']) }));
    await streamAskRally('hello', () => {}, { startFresh: true }, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as Parameters<AskRallyFetch>;
    expect(url).toMatch(/\/functions\/v1\/ask-rally$/);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(init.body)).toEqual({ message: 'hello', startFresh: true });
  });

  it('streams chunk-by-chunk when the response has a body stream', async () => {
    const chunks: string[] = [];
    const fetchImpl: AskRallyFetch = async () =>
      makeResponse({ body: streamingBody(['you showed ', 'up today', ' — that counts']) });

    await streamAskRally('hello', (t) => chunks.push(t), undefined, { fetchImpl });

    expect(chunks).toEqual(['you showed ', 'up today', ' — that counts']);
  });

  it('falls back to one buffered read when the transport has no body stream', async () => {
    const chunks: string[] = [];
    const fetchImpl: AskRallyFetch = async () =>
      makeResponse({ body: null, text: async () => 'the whole reply at once' });

    await streamAskRally('hello', (t) => chunks.push(t), undefined, { fetchImpl });

    expect(chunks).toEqual(['the whole reply at once']);
  });

  it('surfaces the crisis and limited headers before the body is read', async () => {
    let seen: Headers | null = null;
    const fetchImpl: AskRallyFetch = async () =>
      makeResponse({
        headers: new Headers({ 'X-Ask-Rally-Crisis': 'true', 'X-Ask-Rally-Limited': 'true' }),
        body: streamingBody(['crisis copy']),
      });

    const chunks: string[] = [];
    await streamAskRally('hello', (t) => chunks.push(t), { onHeaders: (h) => (seen = h) }, { fetchImpl });

    expect(seen!.get('X-Ask-Rally-Crisis')).toBe('true');
    expect(seen!.get('X-Ask-Rally-Limited')).toBe('true');
    // the crisis reply still arrives as the message body — it must never
    // be swallowed into an error path (AR1's one unacceptable outcome)
    expect(chunks).toEqual(['crisis copy']);
  });

  it('throws on a non-2xx response without calling onChunk', async () => {
    const onChunk = jest.fn();
    const fetchImpl: AskRallyFetch = async () => makeResponse({ ok: false, status: 500 });

    await expect(streamAskRally('hello', onChunk, undefined, { fetchImpl })).rejects.toThrow();
    expect(onChunk).not.toHaveBeenCalled();
  });

  it('throws before fetching when there is no session', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const fetchImpl = jest.fn();

    await expect(streamAskRally('hello', () => {}, undefined, { fetchImpl })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
