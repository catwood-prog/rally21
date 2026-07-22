import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
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
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
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
            <Text style={styles.buttonText}>Got it</Text>
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
