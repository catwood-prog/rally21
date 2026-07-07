import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  /** Set only when today's own slot was covered by someone — the full
   * name-based note lives here rather than cluttering the header. */
  heldTodayMessage?: string | null;
};

/** The glow's "tap the flame" explainer (Rally21-Glow-Spec.md §1) —
 * three warm sentences, no mechanics jargon, no numbers to optimize. */
export function GlowDetailSheet({ visible, onDismiss, heldTodayMessage }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{STRINGS.glowDetailTitle}</Text>
          <Text style={styles.body}>{STRINGS.glowDetailBody}</Text>
          {heldTodayMessage && <Text style={styles.heldNote}>{heldTodayMessage}</Text>}
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
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
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
