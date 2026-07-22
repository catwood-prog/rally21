import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';

/** AV1 — the one-shot photo ask (RM1 RemindersAskCard's compact-card
 * pattern): a quiet Today card for photo-less accounts, offered once at
 * the first check-in celebration. It shows THIS member's own penguin —
 * the copy ("this little penguin") should point at the actual penguin
 * their circle sees. Any interaction marks it seen forever; the dismiss
 * label is honest about being a real choice, never a "later" that
 * secretly means never. */
export function PhotoAskCard({
  userId,
  onAddPhoto,
  onKeepPenguin,
}: {
  userId: string;
  onAddPhoto: () => void;
  onKeepPenguin: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Avatar name={null} userId={userId} size={52} />
      <Text style={styles.body}>{STRINGS.photoAskBody}</Text>
      <TouchableOpacity style={styles.cta} onPress={onAddPhoto}>
        <Text style={styles.ctaText}>{STRINGS.photoAskCta}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onKeepPenguin}>
        <Text style={styles.dismiss}>{STRINGS.photoAskDismiss}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
    ...cardShadow,
  },
  body: {
    fontSize: 13,
    color: colors.ink,
    textAlign: 'center',
    lineHeight: 19,
    marginTop: 10,
    marginBottom: 12,
  },
  // Gold = action (the colour roles): adding your photo is the card's
  // one CTA, same register as RM1's.
  cta: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 22,
    marginBottom: 8,
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 13.5,
    color: colors.ink,
  },
  dismiss: {
    fontSize: 12,
    color: colors.muted,
    paddingVertical: 4,
  },
});
