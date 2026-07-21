import { Platform } from 'react-native';

import { supabase } from './supabase';

// Ask Rally, part 1 — the real thing (Rally21-Ask-Rally-Spec.md). Every
// authenticated user now (A0's founder allowlist is gone); conversations
// persist server-side (ask_conversations/ask_messages, owner-only RLS)
// for continuity, one active thread at a time, one-tap hard delete.

export type AskRallyMessage = { role: 'user' | 'assistant'; content: string };

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

/** The slice of the fetch/Response contract the transport actually uses —
 * lets tests inject a mock and lets web fetch and expo/fetch share one
 * signature without fighting their divergent nominal types. */
export type AskRallyTransportResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  body: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } | null;
  text(): Promise<string>;
};
export type AskRallyFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<AskRallyTransportResponse>;

/** AR1 (21 July): React Native's built-in fetch is the whatwg-fetch XHR
 * polyfill, which exposes NO streaming response body — `res.body` is
 * undefined — so the old getReader() path failed client-side AFTER a
 * successful 200, showing an error for a reply that existed (and was
 * already persisted server-side). Native now uses expo/fetch (WinterCG,
 * SDK 54), whose response genuinely streams; on web `expo/fetch` IS the
 * browser's own global fetch (expo resolves fetch.web.ts), so the
 * always-working browser path is unchanged — the gate below keeps that
 * explicit rather than implicit in Metro's platform resolution. */
function defaultFetch(): AskRallyFetch {
  if (Platform.OS === 'web') return globalThis.fetch as unknown as AskRallyFetch;
  // Lazy require: expo/fetch's module resolves its native ExpoFetchModule
  // at import time, so requiring it here (first send) instead of at
  // module scope means a binary somehow missing that native module could
  // only ever break this send — never every screen that transitively
  // imports this lib, at launch, via the OTA lane.
  const { fetch: expoFetch } = require('expo/fetch') as { fetch: unknown };
  return expoFetch as AskRallyFetch;
}

/** Reads the reply off the response: chunk-by-chunk when the transport
 * provides a body stream (browser fetch, expo/fetch), or one buffered
 * read when it doesn't — a streamless transport renders the full reply
 * at once rather than failing. */
async function readAskRallyReply(
  res: AskRallyTransportResponse,
  onChunk: (text: string) => void
): Promise<void> {
  if (!res.body) {
    const text = await res.text();
    if (text) onChunk(text);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = value ? decoder.decode(value, { stream: true }) : '';
    if (text) onChunk(text);
  }
}

/** The caller's own currently-open conversation, oldest message first —
 * null if there isn't one yet (first-ever visit, or 'start fresh'/delete
 * left nothing open). RLS already scopes both tables to the caller. */
export async function getActiveConversation(): Promise<{ id: string; messages: AskRallyMessage[] } | null> {
  const { data: conversation, error: conversationError } = await supabase
    .from('ask_conversations')
    .select('id')
    .is('closed_at', null)
    .maybeSingle<{ id: string }>();
  if (conversationError) throw conversationError;
  if (!conversation) return null;

  const { data: messages, error: messagesError } = await supabase
    .from('ask_messages')
    .select('role, content')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });
  if (messagesError) throw messagesError;

  return {
    id: conversation.id,
    messages: (messages ?? []).map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
  };
}

/** One-tap delete (spec §6): a real hard delete via FK cascade, not a
 * soft flag — this row and every message under it are simply gone. */
export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase.from('ask_conversations').delete().eq('id', conversationId);
  if (error) throw error;
}

/** Streams a reply from ask-rally, calling onChunk as each piece of text
 * arrives. Resolves once the stream ends. Throws on a non-2xx response.
 * `startFresh` closes any currently-open thread server-side before this
 * message opens a new one. The response carries `X-Ask-Rally-Crisis` or
 * `X-Ask-Rally-Limited` headers when applicable — surfaced via
 * `onHeaders` so the UI can render those states distinctly if it wants. */
export async function streamAskRally(
  message: string,
  onChunk: (text: string) => void,
  options?: { startFresh?: boolean; onHeaders?: (headers: Headers) => void },
  deps: { fetchImpl?: AskRallyFetch } = {}
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('not signed in');

  const fetchImpl = deps.fetchImpl ?? defaultFetch();
  const res = await fetchImpl(`${SUPABASE_URL}/functions/v1/ask-rally`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, startFresh: !!options?.startFresh }),
  });

  if (!res.ok) {
    // Diagnostic only — the screen renders warm strings.ts copy for every
    // failure, never this message (no user ever sees a status code).
    throw new Error(`ask-rally responded ${res.status}`);
  }

  options?.onHeaders?.(res.headers);
  await readAskRallyReply(res, onChunk);
}
