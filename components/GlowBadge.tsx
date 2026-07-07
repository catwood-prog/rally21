import { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { GlowDetailSheet } from '@/components/GlowDetailSheet';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { Glow } from '@/lib/glow';

/** The Today header's small flame (Rally21-Glow-Spec.md §1-2) — quiet
 * pride, not a billboard. Renders nothing for a cold streak or a
 * zero-day glow (no pressure on day one); tapping opens the 3-sentence
 * explainer. `coveredByName` is only passed when today's own slot was
 * held by a cover — shown as a small heart here, with the full note in
 * the detail sheet. */
export function GlowBadge({ glow, coveredByName }: { glow: Glow | null; coveredByName?: string | null }) {
  const [showDetail, setShowDetail] = useState(false);

  if (!glow || glow.state === 'cold' || (glow.state === 'glowing' && glow.glow === 0)) {
    return null;
  }

  const isEmbers = glow.state === 'embers';

  return (
    <>
      <TouchableOpacity style={styles.row} onPress={() => setShowDetail(true)} hitSlop={6}>
        <Text style={[styles.flame, isEmbers && styles.flameEmbers]}>{isEmbers ? '🔥' : '🔥'}</Text>
        <Text style={[styles.label, isEmbers && styles.labelEmbers]}>
          {isEmbers ? STRINGS.glowEmbersLabel : STRINGS.glowGlowingLabel(glow.glow)}
        </Text>
        {!isEmbers && glow.heldToday && <Text style={styles.heart}>💛</Text>}
      </TouchableOpacity>
      <GlowDetailSheet
        visible={showDetail}
        onDismiss={() => setShowDetail(false)}
        heldTodayMessage={
          !isEmbers && glow.heldToday && coveredByName ? STRINGS.glowHeldTodayNote(coveredByName) : null
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
    marginBottom: 6,
  },
  flame: {
    fontSize: 13,
  },
  flameEmbers: {
    opacity: 0.6,
  },
  label: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.gold,
  },
  labelEmbers: {
    color: colors.goldMuted,
    fontWeight: '600',
  },
  heart: {
    fontSize: 12,
  },
});
