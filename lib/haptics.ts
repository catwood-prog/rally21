import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

import { HAPTICS } from '@/lib/motion';

/**
 * P1 haptics foundation — a small designed vocabulary (tick/thump/success)
 * so the native build lights up with zero rework later. Every function
 * takes the caller's own `reduceMotion` (from `useReducedMotion()`,
 * already computed at every call site) since a plain module can't call
 * that hook itself. No dedicated settings toggle yet — deferred to
 * native, see DEFERRED.md.
 */

export type HapticOptions = { reduceMotion?: boolean };

export type HapticChannel = 'native' | 'web-vibrate' | 'silent';

/** Pure decision logic, kept separate from the real Platform/navigator/
 * expo-haptics calls below so it's unit-testable without mocking RN
 * internals. Web: navigator.vibrate where it exists (Android Chrome).
 * iOS Safari has no vibrate API and no workaround exists — silent
 * no-op there, never attempted. Native: real expo-haptics. */
export function resolveHapticChannel(platformOS: string, hasVibrate: boolean): HapticChannel {
  if (platformOS === 'web') return hasVibrate ? 'web-vibrate' : 'silent';
  return 'native';
}

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function fire(durationMs: number, nativeCall: () => Promise<void>, options?: HapticOptions): void {
  if (options?.reduceMotion) return;
  const channel = resolveHapticChannel(Platform.OS, canVibrate());
  if (channel === 'silent') return;
  if (channel === 'web-vibrate') {
    try {
      navigator.vibrate(durationMs);
    } catch {
      // unsupported despite feature-detection — harmless no-op
    }
    return;
  }
  nativeCall().catch(() => {
    // unsupported on this device — harmless no-op
  });
}

/** Week-row/dot-strip dot pops — the lightest touch in the vocabulary. */
export function tick(options?: HapticOptions): void {
  fire(HAPTICS.TICK_MS, () => Haptics.selectionAsync(), options);
}

/** The glow number settling into place. */
export function thump(options?: HapticOptions): void {
  fire(HAPTICS.THUMP_MS, () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium), options);
}

/** A check-in save landing. */
export function success(options?: HapticOptions): void {
  fire(HAPTICS.SUCCESS_MS, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), options);
}
