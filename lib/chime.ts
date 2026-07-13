import { Asset } from 'expo-asset';
import { createAudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import { GLOW_BEAT_BOWL_SOUND } from '@/lib/motion';

// GN1 (13 July): native has no Web Audio API (no window.AudioContext, no
// HTMLAudioElement), so every function below was previously a silent no-op
// off-web — safe (already guarded), but a genuinely mute check-in on the
// first native build. These two files are the timer chime and glow-beat
// bowl's exact web envelopes baked to static PCM (generated once by a
// throwaway script matching playTone()'s math verbatim: linear attack over
// 0.04s, exponential decay to 0.0001 over the rest of each tone's
// duration) — native has no oscillator/gain-node API to synthesize them
// live, so this is the smallest faithful native equivalent. The web path
// below is completely untouched; native is purely an added sibling branch,
// same pattern as lib/wakeLock.ts's native branch.
function playNativeSound(source: number): void {
  if (Platform.OS === 'web') return;
  try {
    const player = createAudioPlayer(source);
    player.play();
    // One-shot sound effects — release the native player shortly after it
    // finishes rather than leaking one SharedObject per play() call.
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        // already released
      }
    }, 2000);
  } catch {
    // unsupported — the screen's own visuals are always the real signal
  }
}

// A synthesized two-tone completion chime — no audio file needed. iOS
// Safari (and most mobile browsers) only allow an AudioContext to actually
// produce sound if it was created or resumed synchronously inside a user
// gesture handler (a tap), so `unlockAudioContext` must be called directly
// from the "Start timer" tap — never after an `await`. The same context is
// then reused later, from a plain timer callback, to actually play the
// chime once the countdown reaches zero.
let audioContext: AudioContext | null = null;

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

export function unlockAudioContext(): void {
  try {
    const Ctx = getAudioContextClass();
    if (!Ctx) return;

    if (!audioContext) {
      audioContext = new Ctx();
    }
    if (audioContext.state === 'suspended') {
      // fire-and-forget — this call itself, made synchronously inside the
      // gesture handler, is what satisfies the autoplay policy
      audioContext.resume().catch(() => {});
    }
  } catch {
    // unsupported — playChime() will just no-op later
  }
}

function playTone(ctx: AudioContext, frequency: number, startTime: number, duration: number, peakVolume: number) {
  const oscillator = ctx.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakVolume, startTime + 0.04); // soft attack, no click
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration); // gentle fade

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.05);
}

/** A single soft, warm ding — two overlapping sine tones a fifth apart,
 * quiet and slow-fading like a small meditation bell. Silently does
 * nothing if audio was never unlocked, is blocked, or is unsupported —
 * the timer's own end-state screen is always the real completion signal. */
export function playChime(): void {
  if (Platform.OS !== 'web') {
    playNativeSound(require('../assets/sounds/timer-chime.wav'));
    return;
  }
  if (!audioContext) return;
  try {
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    const now = audioContext.currentTime;
    playTone(audioContext, 528, now, 1.5, 0.1);
    playTone(audioContext, 660, now + 0.06, 1.35, 0.08);
  } catch {
    // audio blocked (e.g. finished while backgrounded) — no error surfaced
  }
}

// The check-in success chime is an approved recorded file (mascot brief),
// not synthesized like the timer's own chime above — resolved once via
// expo-asset so a bundler-specific require() shape doesn't leak into the
// player. This URI-resolution path is web-only (playCheckinPop's native
// branch above plays the same file directly via createAudioPlayer, which
// takes a require() module and needs no separate URI step).
let checkinPopUri: string | null | undefined;

function getCheckinPopUri(): string | null {
  if (Platform.OS !== 'web') return null;
  if (checkinPopUri === undefined) {
    try {
      checkinPopUri = Asset.fromModule(require('../assets/sounds/checkin-pop.wav')).uri;
    } catch {
      checkinPopUri = null;
    }
  }
  return checkinPopUri;
}

/** Plays the check-in success chime (mascot brief). A plain HTMLAudioElement,
 * not the AudioContext singleton above — doesn't need the same synchronous-
 * gesture unlock, since the "Save" tap that leads here is itself a recent
 * enough user gesture for browsers' media autoplay heuristics. Silently
 * does nothing if playback is blocked or unsupported — the celebration
 * screen itself is always the real completion signal. */
export function playCheckinPop(): void {
  if (Platform.OS !== 'web') {
    playNativeSound(require('../assets/sounds/checkin-pop.wav'));
    return;
  }
  const uri = getCheckinPopUri();
  if (!uri) return;
  try {
    const audio = new Audio(uri);
    audio.volume = 0.6;
    audio.play().catch(() => {
      // blocked by autoplay policy — non-fatal
    });
  } catch {
    // unsupported
  }
}

// Day-21 ceremony flourish — the other approved recorded file (mascot
// brief), same expo-asset resolution as the check-in pop above.
let day21FlourishUri: string | null | undefined;

function getDay21FlourishUri(): string | null {
  if (Platform.OS !== 'web') return null;
  if (day21FlourishUri === undefined) {
    try {
      day21FlourishUri = Asset.fromModule(require('../assets/sounds/day21-flourish.wav')).uri;
    } catch {
      day21FlourishUri = null;
    }
  }
  return day21FlourishUri;
}

/** Plays the day-21 ceremony flourish — the one other approved sound in
 * the app, gated the same way as playCheckinPop (respects the "App
 * sounds" toggle at the call site, not here). Silently does nothing if
 * playback is blocked or unsupported — the ceremony screen itself is
 * always the real signal. */
export function playDay21Flourish(): void {
  if (Platform.OS !== 'web') {
    playNativeSound(require('../assets/sounds/day21-flourish.wav'));
    return;
  }
  const uri = getDay21FlourishUri();
  if (!uri) return;
  try {
    const audio = new Audio(uri);
    audio.volume = 0.6;
    audio.play().catch(() => {
      // blocked by autoplay policy — non-fatal
    });
  } catch {
    // unsupported
  }
}

/** P1 — the glow beat's own sound (G3, ~1.5s ring): synthesized like
 * playChime rather than a recorded file, a full register below
 * checkin-pop's D4/A4 so it reads as "one deeper single bowl strike."
 * REPLACES checkin-pop on an earning check-in (checkin-complete.tsx
 * suppresses its own chime when it knows it's about to route here) —
 * never both on one check-in. Reuses the shared `audioContext` unlocked
 * by the check-in tap, same as playChime; silently does nothing if it
 * was never unlocked, is blocked, or is unsupported. */
export function playGlowBeatBowl(): void {
  if (Platform.OS !== 'web') {
    playNativeSound(require('../assets/sounds/glow-beat-bowl.wav'));
    return;
  }
  if (!audioContext) return;
  try {
    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }
    const now = audioContext.currentTime;
    playTone(audioContext, GLOW_BEAT_BOWL_SOUND.FREQUENCY_HZ, now, GLOW_BEAT_BOWL_SOUND.DURATION_S, GLOW_BEAT_BOWL_SOUND.PEAK_VOLUME);
    playTone(
      audioContext,
      GLOW_BEAT_BOWL_SOUND.OVERTONE_HZ,
      now + GLOW_BEAT_BOWL_SOUND.OVERTONE_DELAY_S,
      GLOW_BEAT_BOWL_SOUND.DURATION_S - GLOW_BEAT_BOWL_SOUND.OVERTONE_DELAY_S,
      GLOW_BEAT_BOWL_SOUND.OVERTONE_PEAK_VOLUME
    );
  } catch {
    // audio blocked — the glow beat's own visuals are always the real signal
  }
}

export function vibrateOnCompletion(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(60);
    }
  } catch {
    // unsupported (iOS) — harmless no-op
  }
}
