import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
  /** ER1 — 'error' places apologetic-slip (medium, standard entrance,
   * reduced-motion static) above the copy, per the placement map's
   * Error ruling. Default 'plain' so informational dialogs ("saved",
   * "done", report confirmations) never get an apologetic penguin.
   * Screens that already carry a placed mascot keep their error dialog
   * plain too — one mascot per screen, never stacked (see ErrorSlip). */
  variant?: 'plain' | 'error';
};

// React Native's Alert.alert is a no-op under react-native-web, so this is
// the cross-platform stand-in wherever the app needs a simple heads-up.
export function MessageDialog({ visible, title, message, onDismiss, variant = 'plain' }: Props) {
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
          {variant === 'error' && (
            <View style={styles.slipWrap}>
              <MascotEntrance source={MASCOT.apologeticSlip} style={styles.slip} />
            </View>
          )}
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <TouchableOpacity style={styles.button} onPress={onDismiss}>
            <Text style={styles.buttonText}>{STRINGS.gotItCta}</Text>
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
  slipWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  // Medium = the 404's own sizing (150×88) — the map's one Error scale.
  slip: {
    width: 150,
    height: 88,
  },
  title: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
  },
  message: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 19,
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
