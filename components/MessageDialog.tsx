import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { cardShadow, colors } from '@/constants/theme';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  onDismiss: () => void;
};

// React Native's Alert.alert is a no-op under react-native-web, so this is
// the cross-platform stand-in wherever the app needs a simple heads-up.
export function MessageDialog({ visible, title, message, onDismiss }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
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
