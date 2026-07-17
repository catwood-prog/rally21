import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { Brandmark } from '@/components/Brandmark';
import { BreathingPacer } from '@/components/BreathingPacer';
import { LinkCard } from '@/components/LinkCard';
import { YouTubeEmbed } from '@/components/YouTubeEmbed';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { playChime, vibrateOnCompletion } from '@/lib/chime';
import { getLocalDateString } from '@/lib/date';
import { getMyProfile, markTimerBackgroundHintSeen, setSoundsEnabled } from '@/lib/profile';
import { extractYouTubeId } from '@/lib/resourceLink';
import {
  clearPersistedTimer,
  computeEndsAt,
  hasEnded,
  loadBreathingPacerOff,
  loadPersistedTimer,
  remainingSeconds,
  saveBreathingPacerOff,
  savePersistedTimer,
  timerStorageKey,
} from '@/lib/timer';
import { useWakeLock } from '@/lib/wakeLock';

const RADIUS = 80;
const STROKE_WIDTH = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatMMSS(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

type Phase = 'running' | 'paused' | 'done';

function TimerRing({ remaining, totalSeconds }: { remaining: number; totalSeconds: number }) {
  const elapsedFraction = totalSeconds > 0 ? 1 - remaining / totalSeconds : 0;
  const dashOffset = CIRCUMFERENCE * Math.min(1, Math.max(0, elapsedFraction));

  return (
    <View style={styles.ringWrap}>
      <Svg width={186} height={186} viewBox="0 0 186 186">
        <Circle cx={93} cy={93} r={RADIUS} stroke="rgba(255,255,255,0.14)" strokeWidth={STROKE_WIDTH} fill="none" />
        <Circle
          cx={93}
          cy={93}
          r={RADIUS}
          stroke={colors.gold}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          strokeDashoffset={dashOffset}
          rotation="-90"
          origin="93, 93"
        />
      </Svg>
      <View style={styles.ringTextWrap} pointerEvents="none">
        <Text style={styles.countdown}>{formatMMSS(remaining)}</Text>
        <Text style={styles.countdownCaption}>of {formatMMSS(totalSeconds)}</Text>
      </View>
    </View>
  );
}

export default function CheckinTimer() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, circleName, dayNumber, durationMinutes, resourceUrl } = useLocalSearchParams<{
    circleId: string;
    circleName: string;
    dayNumber: string;
    durationMinutes?: string;
    resourceUrl?: string;
  }>();

  const totalSeconds = (parseInt(durationMinutes ?? '0', 10) || 0) * 60;
  const videoId = resourceUrl ? extractYouTubeId(resourceUrl) : null;
  // The video (or, absent one, a plain link) is the practice itself — a
  // countdown ring only makes sense when there's nothing else driving the
  // screen, i.e. no resource link at all, or a non-video link paired with
  // a timed practice.
  const hasTimerUI = !videoId && totalSeconds > 0;
  // T1 (8 July): scoped per circle AND local date — a sit abandoned on a
  // previous day and never marked done must never resurface as "still
  // running" (or "just ended, it still counts") on a later day's fresh
  // check-in for the same circle.
  const storageKey = circleId ? timerStorageKey(circleId, getLocalDateString()) : null;

  const [phase, setPhase] = useState<Phase>('running');
  // T1: remaining time was already derived from a wall-clock deadline
  // rather than decremented tick-by-tick (verified by reading the
  // pre-existing code before this pass) — that part was never the bug.
  // The gap was that the deadline itself (`endsAt`) lived only in a plain
  // useState initializer, which re-runs on every fresh mount, so an
  // accidental same-tab refresh silently restarted the countdown from
  // full duration instead of resuming it. `endsAt` now starts null and
  // resolves once (below) from AsyncStorage — either a still-relevant
  // persisted deadline, or a freshly computed one that gets persisted
  // immediately so the *next* refresh has something to resume from.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(null);
  const [, setTick] = useState(0);
  const [soundsEnabled, setSoundsEnabledState] = useState(true);
  // Whether this particular completion was detected via the tab-return
  // catch-up path (item 3) rather than the normal foregrounded countdown
  // — purely a copy decision, never changes the completion itself.
  const [caughtUp, setCaughtUp] = useState(false);
  const [showBackgroundHint, setShowBackgroundHint] = useState(false);
  const [hasSeenBackgroundHint, setHasSeenBackgroundHint] = useState(true);
  // BR1: the breathing pacer's per-device "just the timer" preference —
  // null until AsyncStorage resolves, so a device that turned it off
  // never sees a one-frame flash of the halo.
  const [pacerOff, setPacerOff] = useState<boolean | null>(null);
  // Tracks whether the tab has gone hidden at least once while this sit
  // was actively running — the honest-affordance hint (item 4) only ever
  // shows on return from *that*, never proactively.
  const wasBackgroundedRef = useRef(false);

  useWakeLock(phase === 'running');

  useEffect(() => {
    if (!session?.user) return;
    getMyProfile(session.user.id)
      .then((profile) => {
        setSoundsEnabledState(profile?.sounds_enabled ?? true);
        setHasSeenBackgroundHint(profile?.has_seen_timer_background_hint ?? true);
      })
      .catch(() => {
        // preferences just fall back to their defaults for this session
      });
  }, [session?.user?.id]);

  // T1: resolve the deadline once — resume a still-relevant persisted one
  // (same circle, same local date, same duration) or start fresh and
  // persist it immediately so a later refresh has something to resume.
  useEffect(() => {
    if (!hasTimerUI || !storageKey) return;
    let cancelled = false;
    loadPersistedTimer(storageKey).then((persisted) => {
      if (cancelled) return;
      if (persisted && persisted.totalSeconds === totalSeconds) {
        setEndsAt(persisted.endsAt);
      } else {
        const fresh = computeEndsAt(Date.now(), totalSeconds);
        setEndsAt(fresh);
        savePersistedTimer(storageKey, { endsAt: fresh, totalSeconds });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasTimerUI) return;
    let cancelled = false;
    loadBreathingPacerOff().then((off) => {
      if (!cancelled) setPacerOff(off);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePacerToggle = () => {
    const next = !(pacerOff ?? false);
    setPacerOff(next);
    saveBreathingPacerOff(next);
  };

  const handleToggleMute = () => {
    const next = !soundsEnabled;
    setSoundsEnabledState(next);
    if (session?.user) {
      setSoundsEnabled(session.user.id, next).catch(() => {
        // non-blocking — worst case the preference doesn't stick this time
      });
    }
  };

  useEffect(() => {
    if (phase !== 'running' || !hasTimerUI) return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [phase, hasTimerUI]);

  const remaining =
    phase === 'paused' && pausedRemaining != null
      ? pausedRemaining
      : endsAt != null
        ? remainingSeconds(endsAt, Date.now())
        : totalSeconds;

  useEffect(() => {
    if (hasTimerUI && phase === 'running' && remaining <= 0) {
      setPhase('done');
    }
  }, [remaining, phase, hasTimerUI]);

  // T1 — warm catch-up (item 3) + the honest affordance hint (item 4) +
  // re-acquiring an accurate render on return. Both concerns live in one
  // listener since they're both keyed off the same visibilitychange
  // event; the Wake Lock's own re-acquire is separate (lib/wakeLock.ts)
  // since that concern belongs entirely to that hook.
  useEffect(() => {
    if (!hasTimerUI || typeof document === 'undefined') return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (phase === 'running') wasBackgroundedRef.current = true;
        return;
      }
      // visible again — force an immediate accurate repaint of the
      // countdown rather than waiting up to 500ms for the next tick.
      setTick((t) => t + 1);

      if (phase === 'running' && endsAt != null && hasEnded(endsAt, Date.now())) {
        setCaughtUp(true);
        setPhase('done');
      }

      if (wasBackgroundedRef.current && !hasSeenBackgroundHint) {
        setShowBackgroundHint(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [hasTimerUI, phase, endsAt, hasSeenBackgroundHint]);

  useEffect(() => {
    if (phase !== 'done') return;
    // The chime is best-effort — if audio was never unlocked, or playback
    // is blocked because the tab finished this while backgrounded (iOS
    // Safari in particular may not allow it from here — unverified this
    // session, see the report), both helpers just no-op. The end-state
    // screen below is the real signal either way.
    if (soundsEnabled) playChime();
    vibrateOnCompletion();
  }, [phase, soundsEnabled]);

  // T1: once done (by either path), drop the persisted deadline so a
  // later check-in for the same circle today never resumes a completed
  // sit's stale deadline.
  useEffect(() => {
    if (phase !== 'done' || !hasTimerUI || !storageKey) return;
    clearPersistedTimer(storageKey);
  }, [phase, hasTimerUI, storageKey]);

  useEffect(() => {
    if (phase !== 'done') return;
    const id = setTimeout(() => {
      router.replace({ pathname: '/checkin', params: { circleId } });
    }, 1400);
    return () => clearTimeout(id);
  }, [phase, circleId, router]);

  const handlePauseToggle = () => {
    if (phase === 'running') {
      setPausedRemaining(remaining);
      setPhase('paused');
      // A refresh mid-pause simply loses the pause and resumes at full
      // duration (same as today's behavior) rather than resuming into a
      // paused state — a deliberately narrower gap than the running case,
      // see the report.
      if (hasTimerUI && storageKey) clearPersistedTimer(storageKey);
    } else if (phase === 'paused') {
      const fresh = computeEndsAt(Date.now(), pausedRemaining ?? totalSeconds);
      setEndsAt(fresh);
      setPausedRemaining(null);
      setPhase('running');
      if (hasTimerUI && storageKey) savePersistedTimer(storageKey, { endsAt: fresh, totalSeconds });
    }
  };

  const handleMarkDone = () => setPhase('done');

  // NAV1 job 0 — the dark immersive timer is AppHeader-exempt, but its
  // own chrome (brandmark, topbar, bottom controls) must still clear
  // the status bar and home indicator.
  const insets = useSafeAreaInsets();
  const containerInsets = { paddingTop: 16 + insets.top, paddingBottom: 16 + insets.bottom };

  // BR1: the pacer breathes only while the sit is actually running —
  // paused shows the plain ring, and the done branch (including T1's
  // catch-up state, which owns that moment) returns before this is ever
  // rendered.
  const showPacer = hasTimerUI && phase === 'running' && pacerOff === false;

  const dismissBackgroundHint = () => {
    setShowBackgroundHint(false);
    setHasSeenBackgroundHint(true);
    if (session?.user) {
      markTimerBackgroundHintSeen(session.user.id).catch(() => {
        // low-stakes — the hint just might show again next time
      });
    }
  };

  if (phase === 'done') {
    return (
      <View style={[styles.container, containerInsets, styles.doneContainer]}>
        <Text style={styles.doneEmoji}>✓</Text>
        <Text style={styles.doneText}>{STRINGS.timerDoneLabel}</Text>
        {caughtUp && <Text style={styles.catchUpNote}>{STRINGS.timerCatchUpNote}</Text>}
      </View>
    );
  }

  return (
    <View style={[styles.container, containerInsets]}>
      <Brandmark light size={22.5} style={styles.brandmark} />
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.replace('/today')}>
          <Text style={styles.backChevron}>⌄</Text>
        </TouchableOpacity>
        <Text style={styles.circleName}>{circleName || 'Your circle'}</Text>
        <View style={styles.topbarRight}>
          {dayNumber ? <Text style={styles.dayLabel}>Day {dayNumber}</Text> : null}
          <TouchableOpacity onPress={handleToggleMute} hitSlop={8}>
            <Text style={styles.muteIcon}>{soundsEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.center}>
        {videoId ? (
          <YouTubeEmbed videoId={videoId} style={styles.videoHero} />
        ) : resourceUrl ? (
          <>
            <LinkCard url={resourceUrl} style={styles.linkHero} light />
            {hasTimerUI &&
              (showPacer ? (
                <BreathingPacer>
                  <TimerRing remaining={remaining} totalSeconds={totalSeconds} />
                </BreathingPacer>
              ) : (
                <TimerRing remaining={remaining} totalSeconds={totalSeconds} />
              ))}
          </>
        ) : (
          <>
            <Text style={styles.prompt}>breathe, and let it settle</Text>
            {showPacer ? (
              <BreathingPacer>
                <TimerRing remaining={remaining} totalSeconds={totalSeconds} />
              </BreathingPacer>
            ) : (
              <TimerRing remaining={remaining} totalSeconds={totalSeconds} />
            )}
          </>
        )}

        {hasTimerUI && (
          <Text style={styles.footNote}>
            Timed practice · or just <Text style={styles.footNoteBold}>mark as done</Text>
          </Text>
        )}

        {hasTimerUI && pacerOff !== null && (
          <TouchableOpacity onPress={handlePacerToggle} hitSlop={12} style={styles.pacerToggle}>
            <Text style={styles.pacerToggleText}>
              {pacerOff ? STRINGS.pacerTurnOn : STRINGS.pacerTurnOff}
            </Text>
          </TouchableOpacity>
        )}

        {showBackgroundHint && (
          <TouchableOpacity onPress={dismissBackgroundHint} style={styles.backgroundHintCard}>
            <Text style={styles.backgroundHintText}>{STRINGS.timerBackgroundHint}</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.buttonRow}>
        {hasTimerUI && (
          <TouchableOpacity style={styles.ghostButton} onPress={handlePauseToggle}>
            <Text style={styles.ghostButtonText}>{phase === 'paused' ? 'Resume' : 'Pause'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.doneButton, !hasTimerUI && styles.doneButtonFull]}
          onPress={handleMarkDone}
        >
          <Text style={styles.doneButtonText}>Mark as done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#16332a',
    paddingTop: 16,
    paddingBottom: 16,
  },
  brandmark: {
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  doneContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  doneEmoji: {
    fontSize: 40,
    color: colors.gold,
    marginBottom: 14,
  },
  doneText: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: '#fff',
  },
  catchUpNote: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
    marginTop: 10,
  },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
  },
  backChevron: {
    fontSize: 22,
    color: '#fff',
    width: 24,
  },
  circleName: {
    fontFamily: FONT_HEADER,
    fontSize: 16,
    color: '#fff',
  },
  topbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
  },
  muteIcon: {
    fontSize: 16,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  prompt: {
    fontFamily: FONT_SERIF_ITALIC,
    fontSize: 17,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 18,
  },
  ringWrap: {
    width: 186,
    height: 186,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoHero: {
    width: '100%',
    marginBottom: 8,
  },
  linkHero: {
    width: '100%',
    marginBottom: 18,
  },
  ringTextWrap: {
    position: 'absolute',
    alignItems: 'center',
  },
  countdown: {
    fontFamily: FONT_HEADER,
    fontSize: 44,
    color: '#fff',
  },
  countdownCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
    marginTop: 2,
  },
  footNote: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    marginTop: 18,
  },
  footNoteBold: {
    fontWeight: '700',
    color: '#fff',
  },
  // BR1: a quiet text link, never a third button — hitSlop + padding
  // carry the 44px target at this small type size.
  pacerToggle: {
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  pacerToggleText: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.5)',
    textDecorationLine: 'underline',
  },
  backgroundHintCard: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  backgroundHintText: {
    fontSize: 11.5,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
  },
  ghostButton: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  ghostButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
  doneButton: {
    flex: 1,
    backgroundColor: colors.gold,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneButtonFull: {
    flex: undefined,
    width: '100%',
  },
  doneButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#262626',
  },
});
