import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { availableInviteChannels, InviteChannel, openInviteChannel } from '@/lib/sharing';

type Props = {
  visible: boolean;
  /** The exact message the copy flow produces — the chooser never composes text. */
  message: string;
  mailSubject: string;
  /** Runs the screen's existing copy flow (clipboard + "copied" notice). */
  onCopy: () => void;
  onDismiss: () => void;
};

const CHANNEL_ROWS: { channel: InviteChannel; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { channel: 'mail', label: STRINGS.inviteChannelMail, icon: 'mail-outline' },
  { channel: 'whatsapp', label: STRINGS.inviteChannelWhatsApp, icon: 'logo-whatsapp' },
  { channel: 'sms', label: STRINGS.inviteChannelSms, icon: 'chatbubble-outline' },
];

// IN1 (15 July) — the in-app how-to-send chooser, shown wherever the
// system share sheet doesn't exist (most desktop browsers; native/iOS
// Safari get the real sheet instead). Each row opens that channel's
// compose surface with the invite message pre-populated; a channel that
// can't open falls back to the copy flow rather than erroring.
export function InviteChannelChooser({ visible, message, mailSubject, onCopy, onDismiss }: Props) {
  const channels = availableInviteChannels();

  const handleChannel = async (channel: InviteChannel) => {
    onDismiss();
    const opened = await openInviteChannel(channel, message, mailSubject);
    if (!opened) onCopy();
  };

  const handleCopy = () => {
    onDismiss();
    onCopy();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{STRINGS.inviteChooserTitle}</Text>
          <Text style={styles.subtitle}>{STRINGS.inviteChooserSubtitle}</Text>
          {CHANNEL_ROWS.filter((row) => channels.includes(row.channel)).map((row) => (
            <TouchableOpacity
              key={row.channel}
              style={styles.row}
              onPress={() => handleChannel(row.channel)}
              accessibilityRole="button"
              accessibilityLabel={`send the invite with ${row.label}`}
            >
              <Ionicons name={row.icon} size={20} color={colors.ink} style={styles.rowIcon} />
              <Text style={styles.rowText}>{row.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.row}
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel="copy the invite message instead"
          >
            <Ionicons name="copy-outline" size={20} color={colors.ink} style={styles.rowIcon} />
            <Text style={styles.rowText}>{STRINGS.inviteChannelCopy}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.dismiss}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="close without sending"
          >
            <Text style={styles.dismissText}>{STRINGS.inviteChooserDismiss}</Text>
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 19,
    marginBottom: 14,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
    minHeight: 44,
  },
  rowIcon: {
    marginRight: 10,
  },
  rowText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  dismiss: {
    paddingVertical: 10,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  dismissText: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.muted,
  },
});
