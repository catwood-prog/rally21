import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { colors } from '@/constants/theme';

export default function Invite() {
  const router = useRouter();
  const { inviteCode } = useLocalSearchParams<{ circleId: string; inviteCode: string }>();
  const [notice, setNotice] = useState<string | null>(null);

  const shareMessage = `Join my Rally21 circle! Sign in at https://rally21.vercel.app and enter code ${inviteCode} to hop in.`;

  const handleShare = async () => {
    try {
      await Share.share({ message: shareMessage });
    } catch {
      // no native share sheet available (e.g. desktop browser) — copy instead
      await Clipboard.setStringAsync(shareMessage);
      setNotice('copied — paste it to your people');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>invite your people</Text>
      <Text style={styles.subtitle}>share this code — anyone can use it to hop in</Text>

      <View style={styles.codeCard}>
        <Text style={styles.code}>{inviteCode}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleShare}>
        <Text style={styles.buttonText}>Share invite</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/')}>
        <Text style={styles.secondaryButtonText}>Continue to my circle</Text>
      </TouchableOpacity>

      <MessageDialog
        visible={!!notice}
        title="done"
        message={notice ?? ''}
        onDismiss={() => setNotice(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 26,
    textAlign: 'center',
  },
  codeCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 28,
    alignItems: 'center',
    marginBottom: 26,
    borderWidth: 1.5,
    borderColor: colors.green,
  },
  code: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 6,
    color: colors.ink,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  secondaryButton: {
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.muted,
  },
});
