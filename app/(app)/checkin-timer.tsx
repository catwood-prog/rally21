import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
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

export default function CheckinTimer() {
  const router = useRouter();
  const { circleId, circleName, dayNumber, durationMinutes } = useLocalSearchParams<{
    circleId: string;
    circleName: string;
    dayNumber: string;
    durationMinutes: string;
  }>();

  const totalSeconds = (parseInt(durationMinutes ?? '0', 10) || 0) * 60;

  const [phase, setPhase] = useState<Phase>('running');
  // Remaining time is always derived from a wall-clock timestamp, never
  // decremented tick-by-tick — that's what keeps the countdown accurate
  // across a locked screen or a backgrounded tab, where setInterval ticks
  // get throttled or paused but Date.now() never lies.
  const [startedAt, setStartedAt] = useState<number | null>(Date.now());
  const [pausedRemaining, setPausedRemaining] = useState<number | null>(null);
  const [, setTick] = useState(0);

  useWakeLock(phase === 'running');

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [phase]);

  const remaining =
    phase === 'paused' && pausedRemaining != null
      ? pausedRemaining
      : startedAt != null
        ? Math.max(0, totalSeconds - (Date.now() - startedAt) / 1000)
        : totalSeconds;

  useEffect(() => {
    if (phase === 'running' && remaining <= 0) {
      setPhase('done');
    }
  }, [remaining, phase]);

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
    } else if (phase === 'paused') {
      setStartedAt(Date.now() - (totalSeconds - (pausedRemaining ?? totalSeconds)) * 1000);
      setPausedRemaining(null);
      setPhase('running');
    }
  };

  const handleMarkDone = () => setPhase('done');

  if (phase === 'done') {
    return (
      <View style={[styles.container, styles.doneContainer]}>
        <Text style={styles.doneEmoji}>✓</Text>
        <Text style={styles.doneText}>nice — you showed up</Text>
      </View>
    );
  }

  const elapsedFraction = totalSeconds > 0 ? 1 - remaining / totalSeconds : 0;
  const dashOffset = CIRCUMFERENCE * Math.min(1, Math.max(0, elapsedFraction));

  return (
    <View style={styles.container}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.replace('/today')}>
          <Text style={styles.backChevron}>⌄</Text>
        </TouchableOpacity>
        <Text style={styles.circleName}>{circleName || 'Your circle'}</Text>
        <Text style={styles.dayLabel}>{dayNumber ? `Day ${dayNumber}` : ''}</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.prompt}>breathe, and let it settle</Text>

        <View style={styles.ringWrap}>
          <Svg width={186} height={186} viewBox="0 0 186 186">
            <Circle
              cx={93}
              cy={93}
              r={RADIUS}
              stroke="rgba(255,255,255,0.14)"
              strokeWidth={STROKE_WIDTH}
              fill="none"
            />
            <Circle
              cx={93}
              cy={93}
              r={RADIUS}
              stroke="#F4C84B"
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

        <Text style={styles.footNote}>
          Timed practice · or just <Text style={styles.footNoteBold}>mark as done</Text>
        </Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity style={styles.ghostButton} onPress={handlePauseToggle}>
          <Text style={styles.ghostButtonText}>{phase === 'paused' ? 'Resume' : 'Pause'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneButton} onPress={handleMarkDone}>
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
    paddingTop: 22,
    paddingBottom: 16,
  },
  doneContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneEmoji: {
    fontSize: 40,
    color: '#F4C84B',
    marginBottom: 14,
  },
  doneText: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: '#fff',
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
  dayLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: 'rgba(255,255,255,0.6)',
    width: 50,
    textAlign: 'right',
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
    backgroundColor: '#F4C84B',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  doneButtonText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#262626',
  },
});
