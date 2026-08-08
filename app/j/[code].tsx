import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { normalizeInviteCode, savePendingInviteCode } from '@/lib/invite-link';

/**
 * IL1 job 1 (6 Aug) — `rally21.com/j/<code>`, the invite's landing.
 *
 * Deliberately OUTSIDE `(app)` and `onboarding`: both of those groups
 * redirect a session-less visitor away, and a session-less visitor is the
 * entire audience for this screen. It is the one surface in the app a
 * total stranger sees first, which is why it carries a line of purpose
 * (Soraya's stall, 5 Aug, was not typing friction — she got through signup
 * and circle creation and then didn't quite understand the point).
 *
 * THE WEB SIDE NEEDS A REWRITE, and it is not optional. `expo export
 * --platform web` emits this dynamic route as the literal file
 * `dist/j/[code].html` — there is no generateStaticParams for it and there
 * cannot be, since codes are minted per circle. Without the `/j/:code`
 * rewrite in vercel.json, Vercel looks for `dist/j/ABC123.html`, finds
 * nothing, and EVERY invite link in the wild 404s while the app itself
 * looks perfectly healthy. vercel.json takes no comments, so the reason
 * lives here; the two are only ever correct together.
 *
 * IT NEVER ASKS THE SERVER ANYTHING, and since IL2 (8 Aug) it never TELLS
 * the server anything either. No lookup, no "no circle found" — a landing
 * that confirmed which codes are real would be a circle-existence oracle
 * available to anyone with no account at all, which is strictly more than
 * the signed-in join flow reveals today. Whether the code works is
 * `join_circle_by_code`'s answer to give, after sign-in, as before.
 *
 * IL1 job 3 also had this screen tally its own opens through
 * `record_invite_link_open`, which needed the project's first anon EXECUTE
 * grant. Cat declined that grant on 7 August — not because the function was
 * unsafe, but because an allowlist turns HD1's machine-checkable "0
 * anon-executable" into a standing human judgement — so the call is gone
 * and this screen makes NO network call at all before sign-in. Do not add
 * one back with an anon grant: the sanctioned route for a pre-auth write is
 * a public edge function holding the service-role key server-side. The RPC
 * and `analytics.invite_link_opens` are kept dormant for exactly that
 * caller; nothing on the client may reach them.
 */
export default function InviteLanding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isLoading } = useAuth();
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const raw = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = normalizeInviteCode(raw);
  const [isHandingOff, setIsHandingOff] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <Brandmark size={33} style={styles.loadingBrandmark} />
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  // A code that survives normalisation to nothing carries no invite at
  // all (a truncated paste, a crawler, someone hand-editing the URL).
  // "/" is the one honest destination: it routes a stranger to the intro
  // and a signed-in person to their own Today, exactly as rally21.com
  // already does — the bare-URL path this section had to keep working.
  if (!code) return <Redirect href="/" />;

  // Already signed in: the storage hop below exists only to carry a code
  // across an auth round trip, so skip it entirely — handing the code
  // straight to the join screen as a param leaves nothing behind to
  // hijack a later, unrelated visit to the setup fork.
  if (session) return <Redirect href={{ pathname: '/onboarding/join-circle', params: { code } }} />;

  // Saved on TAP, not on mount: someone who lands here and leaves has
  // chosen nothing, and should not find a stranger's code waiting in
  // their app the first time they sign up for their own reasons.
  const handleSignIn = async () => {
    setIsHandingOff(true);
    await savePendingInviteCode(code);
    router.replace('/sign-in');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: 24 + insets.top, paddingBottom: 40 + insets.bottom },
      ]}
    >
      <Brandmark style={styles.brandmark} />
      <Text style={styles.title}>{STRINGS.inviteLandingTitle}</Text>
      <Text style={styles.purpose}>{STRINGS.inviteLandingPurpose}</Text>

      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>{STRINGS.inviteLandingCodeLabel}</Text>
        <Text style={styles.code}>{code}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={isHandingOff}>
        {isHandingOff ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>{STRINGS.inviteLandingCta}</Text>
        )}
      </TouchableOpacity>
      <Text style={styles.reassurance}>{STRINGS.inviteLandingReassurance}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  loadingBrandmark: {
    marginBottom: 20,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // flexGrow (never flex: 1 — see circle-setup.tsx, OD1 job 17a) so short
  // content centres and large Dynamic Type scrolls instead of clipping.
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandmark: {
    marginBottom: 24,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 26,
    color: colors.ink,
    marginBottom: 10,
  },
  purpose: {
    fontSize: 14,
    lineHeight: 21,
    color: colors.mutedStrong,
    marginBottom: 26,
  },
  codeCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 22,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1.5,
    borderColor: colors.green,
    ...cardShadow,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.greenText,
    marginBottom: 8,
  },
  code: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 6,
    color: colors.ink,
    // The letter-spacing above is trailing space on the last glyph too,
    // which reads as an off-centre code inside a centred card.
    marginLeft: 6,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  reassurance: {
    fontSize: 12,
    lineHeight: 17,
    color: colors.mutedStrong,
    textAlign: 'center',
    marginTop: 12,
  },
});
