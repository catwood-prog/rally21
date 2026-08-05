/** THE THREE FAMILIES THE APP ACTUALLY DRAWS WITH — and only three.
 *
 * HY1 job 2 (R7, 5 Aug): this file used to name seven. The other four
 * (`BricolageGrotesque_700Bold`, `PlusJakartaSans_500Medium`/`600SemiBold`/
 * `700Bold`) had zero call sites — but they were still listed in
 * `app/_layout.tsx`'s `useFonts`, and that hook gates the whole app on
 * `if (!fontsLoaded) return null`. So four families nobody rendered were
 * being fetched and parsed BEFORE first paint, on every cold start, on
 * every platform. Deleted from both places together: a constant removed
 * here and left in `useFonts` would have kept the cost and lost only the
 * name.
 *
 * WEIGHTS DID NOT MOVE WITH THEM. Every screen already reaches for a
 * heavier body weight with `fontWeight: '600'/'700'` on FONT_BODY, not by
 * naming a family — react-native-web synthesises it and iOS applies the
 * face's own weight axis. Nothing in the app ever named the deleted four.
 *
 * ADDING ONE BACK is a real decision, not a convenience: it is a
 * render-blocking network fetch on first paint. Add the constant and the
 * `useFonts` entry in the same change as the call site that draws with
 * it, never ahead of one. */
export const FONT_HEADER = 'BricolageGrotesque_800ExtraBold';
export const FONT_SERIF_ITALIC = 'InstrumentSerif_400Regular_Italic';
export const FONT_BODY = 'PlusJakartaSans_400Regular';
