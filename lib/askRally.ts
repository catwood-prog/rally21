import { supabase } from './supabase';

// Ask Rally, part 0 — the tone playground (Rally21-Ask-Rally-Spec.md).
// Founder-only; nothing here persists server-side (see the edge
// function's own scope note) — conversation history lives in this
// screen's own state only.

// Same allowlist as the ask-rally edge function's own FOUNDER_IDS and
// app_caps()'s founder override — this is the UX-only redirect gate; the
// edge function's 403 is the real enforcement (never rely on this alone).
export const ASK_RALLY_FOUNDER_IDS = new Set([
  '75ec0d88-27de-4227-ab62-3d049b369960', // catherine.f.harwood@gmail.com
  '149bac2f-6557-403b-bf05-f830d42fc2e4', // catherine.harwood@korefusion.com (test)
]);

export type AskRallyMessage = { role: 'user' | 'assistant'; content: string };

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;

/** Streams a reply from ask-rally, calling onChunk as each piece of text
 * arrives. Resolves once the stream ends. Throws on a non-2xx response
 * (403 not-founder, 401 not-authenticated, 503 not-configured, etc). */
export async function streamAskRally(
  messages: AskRallyMessage[],
  onChunk: (text: string) => void
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
    body: JSON.stringify({ messages }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `Ask Rally request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) onChunk(text);
  }
}
