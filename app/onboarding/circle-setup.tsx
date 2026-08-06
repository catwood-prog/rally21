import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackLink } from '@/components/BackLink';
import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors, scaledLineHeight } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { recordFunnelEvent } from '@/lib/funnel';
import { takePendingInviteCode } from '@/lib/invite-link';

export default function CircleSetup() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { fromToday, wantKey, wantStatement, suggestedName } = useLocalSearchParams<{
    fromToday?: string;
    wantKey?: string;
    wantStatement?: string;
    suggestedName?: string;
  }>();

  // The wants act flow ("make this your next 21 days") lands here first —
  // same solo/circle fork everyone else gets, just carrying the want's
  // details through so create-circle can prefill a custom practice.
  const wantParams = wantKey ? { wantKey, wantStatement: wantStatement ?? '', suggestedName: suggestedName ?? '' } : {};

  // ON1 — the Day-0 intake's Q1 sits between this fork and the practice
  // browse, but ONLY on a genuine Day-0 create/solo: a want-act flow
  // already carries the person's intent, and adding a later circle from
  // Today (fromToday) is not Day-0, so both skip straight to the browse.
  const isDayZero = !wantKey && fromToday !== 'true';
  const carriedTail = { ...(fromToday === 'true' ? { fromToday: 'true' } : {}), ...wantParams };

  // AN1 job 2 — this fork is where in-onboarding abandonment actually
  // happens, and it is invisible today: join_source records which door
  // somebody came THROUGH, but only for the people who made it out the
  // other side. Gated on isDayZero (this file's own name for a genuine
  // first-run visit), so a want-act flow or an extra circle added from
  // Today never counts as an onboarding step — the same visit reached by
  // two different routes must not land in one funnel.
  const { session } = useAuth();
  const emitSetupEvent = (event: Parameters<typeof recordFunnelEvent>[1]) => {
    if (isDayZero) recordFunnelEvent(session?.user?.id, event);
  };

  // IL1 job 1 — where an invite code lands after the sign-in round trip.
  // This fork is the one screen every route into onboarding replaces to
  // (profile.tsx and reminders.tsx both do, and so does index.tsx's
  // needs-circle branch), so a code held across a magic link or an OAuth
  // redirect is picked up here no matter which step the person resumed at.
  //
  // ONE-SHOT: takePendingInviteCode reads AND clears, so a code that was
  // saved but never used cannot silently redirect a visit weeks later, and
  // backing out of the join screen returns to the ordinary fork. Day-zero
  // only — someone adding a THIRD circle from Today, or acting on a want,
  // is not a cold arrival and must not be steered by an old invite.
  const [pendingChecked, setPendingChecked] = useState(() => !isDayZero);
  useEffect(() => {
    if (!isDayZero) return;
    let cancelled = false;
    takePendingInviteCode().then((pending) => {
      if (cancelled) return;
      if (pending) router.replace({ pathname: '/onboarding/join-circle', params: { code: pending } });
      else setPendingChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isDayZero, router]);

  useEffect(() => {
    // Gated on pendingChecked so an invited arrival, who is redirected
    // straight past this fork, never stamps a setup-opened event for a
    // screen they were never shown — the funnel would read it as a fork
    // they abandoned.
    if (isDayZero && pendingChecked) recordFunnelEvent(session?.user?.id, 'onboarding_circle_setup_opened');
  }, [isDayZero, pendingChecked, session?.user?.id]);

  const goStart = (extra: Record<string, string>) =>
    router.push(
      isDayZero
        ? { pathname: '/onboarding/desired-change', params: extra }
        : { pathname: '/onboarding/create-circle', params: { ...carriedTail, ...extra } }
    );

  // IL1 — one frame of warm background rather than a fork that flashes
  // into view and immediately replaces itself. The read is local storage,
  // so this resolves in the same beat; nothing spins, because a spinner
  // for a few milliseconds is worse than nothing at all.
  if (!pendingChecked) return <View style={styles.container} />;

  return (
    // OD1 job 17a — this was a non-scrolling centred View, so at large
    // Dynamic Type the third card (and the back-link above it) simply had
    // nowhere to go. flexGrow (never flex: 1, whose flexBasis: 0 is exactly
    // what caps the content at one viewport) keeps the short-content
    // layout centred and lets tall content push the scroll instead.
    <ScrollView
      style={styles.container}
      // paddingTop is the inset this screen already applied; paddingBottom
      // is new but resolves to 0 on web, so web stays pixel-identical
      // (job 17d) while iOS clears the home indicator.
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      <Brandmark style={styles.brandmark} />
      <BackLink
        label={fromToday === 'true' ? 'today' : 'back'}
        onPress={() => router.push(fromToday === 'true' ? '/today' : '/onboarding/profile')}
        style={styles.back}
      />

      <Text style={styles.title}>
        how do you{'\n'}want to begin?
      </Text>
      <Text style={styles.subtitle}>you can always add more circles later</Text>

      <TouchableOpacity
        style={[styles.card, styles.cardHighlighted]}
        onPress={() => {
          emitSetupEvent('onboarding_circle_setup_start_chosen');
          goStart({});
        }}
      >
        <Text style={styles.cardEmoji}>✨</Text>
        <Text style={styles.cardTitle}>{STRINGS.circleSetupStartCardTitle}</Text>
        <Text style={styles.cardBody}>
          Find a practice, then start your own or hop into one that&apos;s already running.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          emitSetupEvent('onboarding_circle_setup_join_chosen');
          router.push({
            pathname: '/onboarding/join-circle',
            params: fromToday === 'true' ? { fromToday: 'true' } : {},
          });
        }}
      >
        <Text style={styles.cardEmoji}>🤝</Text>
        <Text style={styles.cardTitle}>{STRINGS.circleSetupInviteCardTitle}</Text>
        <Text style={styles.cardBody}>
          Got a code from a friend? Hop straight into their circle.
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          emitSetupEvent('onboarding_circle_setup_solo_chosen');
          goStart({ solo: 'true' });
        }}
      >
        <Text style={styles.cardEmoji}>🌱</Text>
        <Text style={styles.cardTitle}>{STRINGS.circleSetupSoloCardTitle}</Text>
        <Text style={styles.cardBody}>
          just you, for now — your circle can grow later
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandmark: {
    marginBottom: 18,
  },
  back: {
    marginBottom: 20,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 25,
    // OD1 job 17c — YD1's existing fix, not a new one: iOS grows the
    // glyphs with Dynamic Type but never a fixed lineHeight, so this
    // hard-wrapped two-line title clipped its second line. Web and
    // Android are returned unchanged by scaledLineHeight.
    lineHeight: scaledLineHeight(30),
    color: colors.ink,
  },
  subtitle: {
    fontSize: 13,
    color: colors.mutedStrong,
    marginTop: 8,
    marginBottom: 22,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    ...cardShadow,
  },
  cardHighlighted: {
    borderWidth: 1.5,
    borderColor: colors.green,
  },
  cardEmoji: {
    fontSize: 24,
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
  },
  cardBody: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    // OD1 job 17c — same YD1 fix: wrapping card copy on a fixed lineHeight.
    lineHeight: scaledLineHeight(16),
    marginTop: 4,
  },
});
