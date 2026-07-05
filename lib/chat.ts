import { STRINGS } from '@/constants/strings';

/**
 * The one function the chat screen calls to get a reply — every message,
 * user or assistant, routes through here. Swapping in a real backend later
 * (a Claude API call) means changing only this function's body; the screen
 * never needs to know the difference.
 *
 * TODO: replace this static reply with a call to a Claude API backend.
 */
export async function sendMessage(text: string): Promise<string> {
  void text;
  // Small delay so the UI's "sending" state reads as a real round trip
  // rather than an instant, obviously-fake response.
  await new Promise((resolve) => setTimeout(resolve, 500));
  return STRINGS.chatPlaceholderReply;
}
