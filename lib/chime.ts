import { Asset } from 'expo-asset';
import { Platform } from 'react-native';

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
// player. Web only, matching the rest of this app's platform scope.
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

export function vibrateOnCompletion(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(60);
    }
  } catch {
    // unsupported (iOS) — harmless no-op
  }
}
