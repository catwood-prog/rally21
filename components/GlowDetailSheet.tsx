import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { PEBBLE_CAP } from '@/lib/glow';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Set only when today's own slot was covered by someone — the full
   * name-based note lives here rather than cluttering the header. */
  heldTodayMessage?: string | null;
  /** PA3 job 1 — the nest, made VISIBLE. The pebble mark on a held day
   * says shelter happened; this says how much shelter is left, which is
   * the half a marker cannot carry. It lives behind the same tap as the
   * rest of the glow's explanation rather than on Today, because a
   * standing counter on the home screen is a number to optimise and
   * Glow-Spec §5 forbids exactly that shape. Null when the glow read
   * failed — an absent line beats a guessed balance. */
  pebbles?: number | null;
};

/** The glow's "tap the flame" explainer (Rally21-Glow-Spec.md §1) —
 * three warm sentences, no mechanics jargon, no numbers to optimize. */
export function GlowDetailSheet({ visible, onDismiss, heldTodayMessage, pebbles }: Props) {
  // OD1 job 18a — the reduced-motion law reached 14 files and skipped
  // every shared modal: all four hardcoded a fade. A fade is only a small
  // transition, but the law is not graded by size and these are among the
  // most-met surfaces in the app. 'none' is RN's own opt-out, so the modal
  // still appears instantly — only the animation goes.
  const reduceMotion = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{STRINGS.glowDetailTitle}</Text>
          <Text style={styles.body}>{STRINGS.glowDetailBody}</Text>
          {heldTodayMessage && <Text style={styles.heldNote}>{heldTodayMessage}</Text>}
          {typeof pebbles === 'number' && (
            <Text style={styles.nestNote}>
              {pebbles === 0
                ? STRINGS.pebbleNestEmpty
                : pebbles >= PEBBLE_CAP
                  ? STRINGS.pebbleNestFull
                  : STRINGS.pebbleNestLabel(pebbles)}
            </Text>
          )}
          <TouchableOpacity style={styles.button} onPress={onDismiss}>
            <Text style={styles.buttonText}>{STRINGS.glowDetailCta}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 22,
    ...cardShadow,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
  },
  body: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 18,
  },
  heldNote: {
    fontSize: 13,
    color: colors.ink,
    marginTop: -8,
    marginBottom: 18,
  },
  nestNote: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    marginTop: -8,
    marginBottom: 18,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    fontWeight: '700',
    color: colors.ink,
    fontSize: 14,
  },
});
