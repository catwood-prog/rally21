import { supabase } from './supabase';

// Ask Rally, part 1 — the real thing (Rally21-Ask-Rally-Spec.md). Every
// authenticated user now (A0's founder allowlist is gone); conversations
// persist server-side (ask_conversations/ask_messages, owner-only RLS)
// for continuity, one active thread at a time, one-tap hard delete.

export type AskRallyMessage = { role: 'user' | 'assistant'; content: string };

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

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
  options?: { startFresh?: boolean; onHeaders?: (headers: Headers) => void }
): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('not signed in');

  const res = await fetch(`${SUPABASE_URL}/functions/v1/ask-rally`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, startFresh: !!options?.startFresh }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Ask Rally request failed (${res.status})`);
  }

  options?.onHeaders?.(res.headers);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) onChunk(text);
  }
}
