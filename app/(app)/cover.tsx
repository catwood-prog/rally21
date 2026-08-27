import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { Avatar } from '@/components/Avatar';
import { BackLink } from '@/components/BackLink';
import { Brandmark } from '@/components/Brandmark';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MASCOT_FX, WARM_EASE_IN_OUT, WARM_EASE_OUT } from '@/lib/motion';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { coverMember, hasCompletionFor } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { getMyGlow, giftPebble } from '@/lib/glow';
import { captureError } from '@/lib/sentry';
import { serverRefusal } from '@/lib/serverRefusal';
import { isFriendNudgeEnabled, sendFriendNudge } from '@/lib/wall';

// PA3 job 3 — a pebble joins cover and wave as a third gesture.
//
// THE CV1 COLLISION, and why gifting is NOT built on the cover window.
// Cover is a next-day rescue: it can only target the member's own local
// YESTERDAY and only while they are missing it. A pebble has no such
// moment — it goes into a nest, where it waits. So a pebble is offered
// even when a cover is impossible (they already checked in, or the day
// in question is not yesterday), which is precisely the "friends gifting
// pebbles still needs a moment to happen in" the memo asks for. CV1 is
// left running exactly as shipped; nothing here replaces it.
type Mode = 'cover' | 'wave' | 'pebble';

export default function CoverAFriend() {
  const router = useRouter();
  // NAV1 job 0 only — the cover flow itself is deliberately untouched
  // (Cat is reworking it separately); this is just the safe-area inset.
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const {
    circleId,
    memberId,
    memberName,
    memberAvatarUrl,
    myName,
    alreadyCheckedIn,
    missedDate,
    coverWillHold,
  } = useLocalSearchParams<{
    circleId: string;
    memberId: string;
    memberName?: string;
    memberAvatarUrl?: string;
    myName?: string;
    alreadyCheckedIn?: string;
    // CV1 — the covered member's missed day (their local yesterday), passed
    // from the who's-here cover pill (getCoverableMembers owns the date).
    missedDate?: string;
    // CV4 — 'false' when the server has MEASURED that this cover is past
    // the covered person's monthly capacity. Same read, same pill.
    coverWillHold?: string;
  }>();
  const name = memberName || 'your circle-mate';
  const covererName = myName || 'someone in your circle';
  // W1 (7 July): a member who's already checked in can only be waved at
  // — covering a day that's already done makes no sense (and RLS would
  // reject it), so this is wave-only from the start, not just the default.
  const isWaveOnly = alreadyCheckedIn === 'true';
  // CV4 job 2 — ONLY an explicit 'false' speaks. A missing param (an older
  // circle screen still in memory), a null from the server, or any read
  // that could not decide all leave this false, and the screen says
  // nothing — which is exactly what it did before this section. The
  // honesty line appears on a measured negative and on nothing else.
  const coverWontHold = coverWillHold === 'false';

  const [mode, setMode] = useState<Mode>(isWaveOnly ? 'wave' : 'cover');
  // FF2 — CAT'S RULING, 28 July: conservative. The wave option is revealed
  // only by a successful read that says this person accepts nudges; it
  // starts hidden and stays hidden if the read fails. Offering a gesture
  // someone opted out of lies about consent between friends.
  const [nudgeAllowed, setNudgeAllowed] = useState(false);
  // PA3 — the giver's own nest, re-derived server-side. Starts null and
  // the option stays hidden until a successful read says there is a
  // pebble to give: FF2's conservative direction (Cat, 28 July) applies
  // squarely here, since offering a gesture that then fails on an empty
  // nest is a promise about your own generosity you cannot keep.
  const [myPebbles, setMyPebbles] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId) return;
    isFriendNudgeEnabled(memberId)
      .then(setNudgeAllowed)
      .catch((e) => {
        captureError(e, { screen: 'cover', op: 'isFriendNudgeEnabled' });
        setNudgeAllowed(false);
      });
  }, [memberId]);

  useEffect(() => {
    getMyGlow()
      .then((g) => setMyPebbles(g.pebbles))
      .catch((e) => {
        captureError(e, { screen: 'cover', op: 'getMyGlow' });
        setMyPebbles(null);
      });
  }, []);

  const canGiftPebble = (myPebbles ?? 0) >= 1;

  const goBackToCircle = () => router.replace({ pathname: '/circle', params: { circleId } });

  // M2 (f) — one gentle squeeze on the art when a cover successfully
  // lands (scale 1 → 0.98 → 1, ≤300ms), then the navigation proceeds.
  // Under reduced motion the navigation is immediate.
  const reduceMotion = useReducedMotion();
  const squeezeScale = useSharedValue(1);
  const squeezeStyle = useAnimatedStyle(() => ({ transform: [{ scale: squeezeScale.value }] }));
  const squeezeThen = (done: () => void) => {
    if (reduceMotion) {
      done();
      return;
    }
    squeezeScale.value = withSequence(
      withTiming(MASCOT_FX.COVER_SQUEEZE_SCALE, { duration: MASCOT_FX.COVER_SQUEEZE_IN_MS, easing: WARM_EASE_OUT }),
      withTiming(1, { duration: MASCOT_FX.COVER_SQUEEZE_OUT_MS, easing: WARM_EASE_IN_OUT })
    );
    setTimeout(done, MASCOT_FX.COVER_SQUEEZE_IN_MS + MASCOT_FX.COVER_SQUEEZE_OUT_MS + 20);
  };

  const handleSubmit = async () => {
    if (!session?.user || !circleId || !memberId) return;
    setIsSaving(true);
    try {
      if (mode === 'cover') {
        // CV1 — cover the MISSED day (their local yesterday), never today.
        // The date comes from getCoverableMembers; the RLS policy rejects
        // any other date, so this is the single source of the rescued day.
        await coverMember(circleId, memberId, session.user.id, missedDate ?? getLocalDateString());
        squeezeThen(goBackToCircle);
      } else if (mode === 'pebble') {
        // The server re-derives the giver's balance and refuses an empty
        // nest; nothing here trusts myPebbles as an authorisation (PA4's
        // class lesson — a client-computed number never decides a write).
        await giftPebble(circleId, memberId);
        squeezeThen(goBackToCircle);
      } else {
        // Security spec S1 (F4): the RPC composes the email + wall copy
        // server-side from a fixed template now — the client no longer
        // sends subject/HTML/wall text.
        const result = await sendFriendNudge({
          circleId,
          recipientId: memberId,
          localDate: getLocalDateString(),
        });
        if (result === 'already_nudged') {
          setError(STRINGS.alreadyNudgedError(name));
          setIsSaving(false);
          return;
        }
        if (result === 'wave_cap_reached') {
          setError(STRINGS.waveCapReachedError);
          setIsSaving(false);
          return;
        }
        if (result === 'blocked') {
          setError(STRINGS.waveNotDeliveredError);
          setIsSaving(false);
          return;
        }
        goBackToCircle();
      }
    } catch (e) {
      // CV4 job 1 — CAT'S SENTENCE, and the two codes that earn it.
      //
      // 23505 IS THE RARE ONE. It is the unique violation on
      // `completions_circle_id_user_id_local_date_key`, which can only
      // happen in a TRUE race: two covers in flight at once, neither
      // seeing the other's uncommitted row through the policy's own
      // subquery, the index catching the loser at commit. Milliseconds
      // wide. The duplicate is certain by definition, so it needs no
      // second look.
      //
      // 42501 IS THE EVERYDAY ONE, and it is why this branch exists at
      // all. The completions INSERT policy ends with
      // `NOT EXISTS (select 1 from completions c2 where ...)`, so an
      // ordinary stale cover pill is refused by RLS before the unique
      // index is ever consulted — measured against the live DB, two
      // coverers in sequence: 42501, not 23505. Built to the 23505 alone,
      // Cat's ruling would have shipped into a branch nobody would ever
      // reach while the common case kept saying "something went wrong".
      //
      // BUT 42501 IS NOT A SENTENCE ON ITS OWN. The same code covers a
      // wrong date (their local yesterday rolled over while the screen
      // sat open), a membership that ended, a self-cover — and Cat's
      // words would be a false claim in every one. So this only speaks
      // after re-reading that a completion really is sitting on that
      // triple. A re-read that fails claims nothing and falls through.
      //
      // `missedDate` MUST BE PRESENT FOR THE RE-READ TO MEAN ANYTHING.
      // Without the param the write above falls back to TODAY, which RLS
      // refuses as 42501 for being the wrong day entirely — and re-reading
      // TODAY's completions would then find the member's own check-in and
      // announce that somebody covered them. The triple has to be the one
      // a cover would really have landed on, or there is no claim to make.
      const code = e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined;
      if (mode === 'cover' && (code === '23505' || (code === '42501' && missedDate))) {
        let alreadyCovered = code === '23505';
        if (!alreadyCovered) {
          try {
            alreadyCovered = await hasCompletionFor(circleId, memberId, missedDate!);
          } catch (readError) {
            captureError(readError, { screen: 'cover', op: 'hasCompletionFor' });
            alreadyCovered = false;
          }
        }
        if (alreadyCovered) {
          // "send them a wave HERE" is load-bearing (Cat's word), so the
          // wave is left one tap away rather than merely mentioned: the
          // screen behind the dialog switches to wave mode with its CTA
          // already primed, using the wave this screen has always had —
          // no new gesture plumbing.
          //
          // WHEN THIS PERSON HAS WAVES OFF, FF2's conservative ruling has
          // hidden the wave option entirely and "send them a wave here"
          // would point at nothing. Cat ruled that case to her same
          // sentence with the wave clause dropped, so the copy never
          // offers a gesture that isn't there.
          if (nudgeAllowed) {
            setMode('wave');
            setError(STRINGS.coverAlreadyCoveredError);
          } else {
            setError(STRINGS.coverAlreadyCoveredNoWaveError);
          }
          setIsSaving(false);
          return;
        }
      }
      // "nudges disabled" can only reach here via a race (opted out
      // between load and submit) since the option is hidden client-side
      // whenever we already know it's off — same warm mapping either way.
      // Self-wave/not-a-member shouldn't be reachable at all from this
      // screen's own navigation, so they fall to the plain fallback.
      //
      // MS1 — THESE BRANCHES WERE ALL DEAD, and not one of them had ever
      // fired. `send_friend_nudge` and `gift_pebble` refuse through
      // `raise exception`, which postgrest hands back as a PLAIN OBJECT,
      // so `e instanceof Error` was false every time and `message` was
      // always ''. An empty nest fell through to "couldn't deliver that
      // pebble"; a nudges-disabled race fell all the way to "something
      // went wrong". This is why the shared helper exposes the extracted
      // text and not just a resolved string — see lib/serverRefusal.ts.
      const message = serverRefusal(e) ?? '';
      if (message.includes('nudges disabled')) {
        setError(STRINGS.waveOptedOutError(name));
      } else if (message.includes('nest is empty')) {
        setError(STRINGS.pebbleEmptyNestError);
      } else if (message.includes('already sent them a pebble today')) {
        setError(STRINGS.pebbleAlreadySentError(name));
      } else if (mode === 'pebble') {
        setError(STRINGS.pebbleNotDeliveredError);
      } else {
        setError('something went wrong — try again');
      }
      setIsSaving(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: 20 + insets.top, paddingBottom: 14 + insets.bottom }]}>
      <Brandmark style={styles.brandmark} />
      <BackLink label="circle" onPress={goBackToCircle} />

      <View style={styles.content}>
        <Animated.View style={squeezeStyle}>
          <MascotEntrance source={MASCOT.coverAFriend} style={styles.mascot} />
        </Animated.View>
        <Avatar name={name} userId={memberId ?? ""} avatarUrl={memberAvatarUrl} size={88} />
        <Text style={styles.headline}>
          {isWaveOnly ? STRINGS.waveHeadline(name) : STRINGS.coverHeadline(name)}
        </Text>
        <Text style={styles.subtitle}>{isWaveOnly ? STRINGS.waveSubtitle : STRINGS.coverSubtitle}</Text>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>
            {mode === 'pebble'
              ? STRINGS.pebbleNotePreview(covererName)
              : isWaveOnly
                ? STRINGS.waveNotePreview(covererName, name)
                : STRINGS.coverNotePreview(covererName)}
          </Text>
        </View>

        <View style={styles.optionList}>
          {!isWaveOnly && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('cover')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'cover' }}
            >
              <Text style={styles.optionText}>{STRINGS.coverActionLabel}</Text>
              {mode === 'cover' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>{STRINGS.coverPickPill}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {canGiftPebble && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('pebble')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'pebble' }}
            >
              <Text style={styles.optionText}>{STRINGS.pebbleActionLabel}</Text>
              {mode === 'pebble' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>{STRINGS.coverPickPill}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          {nudgeAllowed && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('wave')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'wave' }}
            >
              <Text style={styles.optionText}>{STRINGS.waveActionLabel}</Text>
              {mode === 'wave' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>{STRINGS.coverPickPill}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* CV4 job 2 — the honesty line, placed at the decision point: the
        * last thing read before the tap commits. Warm, promising nothing,
        * and never blaming the covered person for spent capacity. It only
        * renders on a measured negative, and only for a cover — a wave or
        * a pebble is untouched by shelter capacity. */}
      {mode === 'cover' && coverWontHold && (
        <Text style={styles.wontHoldNote}>{STRINGS.coverWontHoldNote}</Text>
      )}
      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.ctaText}>
            {mode === 'cover'
              ? STRINGS.coverCta(name)
              : mode === 'pebble'
                ? STRINGS.pebbleCta(name)
                : STRINGS.waveCta(name)}
          </Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
  },
  brandmark: {
    marginBottom: 14,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
  },
  mascot: {
    width: 150,
    height: 136,
    marginBottom: 6,
  },
  headline: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    marginTop: 14,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.mutedStrong,
    marginTop: 4,
    textAlign: 'center',
  },
  noteCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
    ...cardShadow,
  },
  noteText: {
    fontSize: 11.5,
    color: colors.mutedStrong,
    lineHeight: 17,
  },
  optionList: {
    width: '100%',
    gap: 9,
    marginTop: 14,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...cardShadow,
  },
  optionText: {
    fontSize: 13,
    color: colors.ink,
  },
  pickPill: {
    backgroundColor: colors.green,
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  pickPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.onFill,
  },
  wontHoldNote: {
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.mutedStrong,
    textAlign: 'center',
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  cta: {
    backgroundColor: colors.green,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.onFill,
  },
});
