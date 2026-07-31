/** The question bank's accent convention, in one dependency-free place.
 *
 * `*word*` marks a span the check-in card renders in Instrument Serif
 * italic (components/AccentedText.tsx). It is PRESENTATION, not content,
 * so every surface that shows the same string as ordinary text has to
 * agree about it — which, before MN2, none of them did: the journal's past
 * entries and Today's "tonight: …" teaser both printed the raw asterisks,
 * because only check-in ever ran a question through AccentedText.
 *
 * This lives in lib/ rather than beside the component on purpose. Both the
 * renderer and constants/strings.ts need it, and strings.ts must stay free
 * of react-native imports (it is pulled into plain-node contexts and
 * tests). A convention shared by a component and a string table belongs to
 * neither of them.
 */
export const ACCENT_SPAN = /\*(.+?)\*/g;

/** Keep the words, drop the markers. Safe on text that has none. */
export function stripAccentMarkers(text: string): string {
  return text.replace(ACCENT_SPAN, '$1');
}
