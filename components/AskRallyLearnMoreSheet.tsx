import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';

/** PM1B — the safety line's "learn more" sheet (REV 3 ruling 5): the
 * safe-place line, the never-shapes scope line, and Cat's full verbatim
 * companion-not-a-therapist disclaimer, relocated here from the old
 * empty-state explainer. Same quiet Modal pattern as GlowDetailSheet. */
export function AskRallyLearnMoreSheet({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) {
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
          <Text style={styles.title}>{STRINGS.askRallySheetTitle}</Text>
          <Text style={styles.body}>{STRINGS.askRallySheetSafePlace}</Text>
          <Text style={styles.scope}>{STRINGS.askRallySheetScope}</Text>
          <Text style={styles.body}>{STRINGS.askRallySheetDisclaimer}</Text>
          <TouchableOpacity style={styles.button} onPress={onDismiss}>
            <Text style={styles.buttonText}>{STRINGS.askRallySheetCta}</Text>
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
    color: colors.ink,
    lineHeight: 19,
    marginBottom: 12,
  },
  scope: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    lineHeight: 18,
    marginBottom: 12,
    fontStyle: 'italic',
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    fontWeight: '700',
    color: colors.ink,
    fontSize: 14,
  },
});
