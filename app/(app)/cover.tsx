import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Avatar } from '@/components/Avatar';
import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { coverMember } from '@/lib/circle';
import { getLocalDateString } from '@/lib/date';
import { isFriendNudgeEnabled, sendFriendNudge } from '@/lib/wall';

type Mode = 'cover' | 'wave';

export default function CoverAFriend() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, memberId, memberName, memberAvatarUrl, myName } = useLocalSearchParams<{
    circleId: string;
    memberId: string;
    memberName?: string;
    memberAvatarUrl?: string;
    myName?: string;
  }>();
  const name = memberName || 'your circle-mate';
  const covererName = myName || 'someone in your circle';

  const [mode, setMode] = useState<Mode>('cover');
  const [nudgeAllowed, setNudgeAllowed] = useState(true);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId) return;
    isFriendNudgeEnabled(memberId)
      .then(setNudgeAllowed)
      .catch(() => setNudgeAllowed(true));
  }, [memberId]);

  const goBackToCircle = () => router.replace({ pathname: '/circle', params: { circleId } });

  const handleSubmit = async () => {
    if (!session?.user || !circleId || !memberId) return;
    setIsSaving(true);
    try {
      if (mode === 'cover') {
        await coverMember(circleId, memberId, session.user.id, getLocalDateString());
        goBackToCircle();
      } else {
        const message = STRINGS.friendNudgeMessages[messageIndex];
        const result = await sendFriendNudge({
          circleId,
          recipientId: memberId,
          localDate: getLocalDateString(),
          subject: STRINGS.friendNudgeSubject(covererName),
          html: STRINGS.friendNudgeEmailBody(covererName, message),
          wallBody: STRINGS.wallWaveEntry(covererName, name),
        });
        if (result === 'already_nudged') {
          setError(STRINGS.alreadyNudgedError(name));
          setIsSaving(false);
          return;
        }
        goBackToCircle();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
      setIsSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={goBackToCircle}>
        <Text style={styles.back}>← Circle</Text>
      </TouchableOpacity>

      <View style={styles.content}>
        <Avatar name={name} avatarUrl={memberAvatarUrl} size={88} />
        <Text style={styles.headline}>{STRINGS.coverHeadline(name)}</Text>
        <Text style={styles.subtitle}>{STRINGS.coverSubtitle}</Text>

        <View style={styles.noteCard}>
          <Text style={styles.noteText}>{STRINGS.coverNotePreview(covererName)}</Text>
        </View>

        <View style={styles.optionList}>
          <TouchableOpacity
            style={styles.optionRow}
            onPress={() => setMode('cover')}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === 'cover' }}
          >
            <Text style={styles.optionText}>{STRINGS.coverActionLabel}</Text>
            {mode === 'cover' && (
              <View style={styles.pickPill}>
                <Text style={styles.pickPillText}>Pick</Text>
              </View>
            )}
          </TouchableOpacity>
          {nudgeAllowed && (
            <TouchableOpacity
              style={styles.optionRow}
              onPress={() => setMode('wave')}
              accessibilityRole="radio"
              accessibilityState={{ selected: mode === 'wave' }}
            >
              <Text style={styles.optionText}>{STRINGS.waveActionLabel}</Text>
              {mode === 'wave' && (
                <View style={styles.pickPill}>
                  <Text style={styles.pickPillText}>Pick</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
        </View>

        {mode === 'wave' && nudgeAllowed && (
          <View style={styles.messageChipRow}>
            {STRINGS.friendNudgeMessages.map((message, index) => {
              const selected = index === messageIndex;
              return (
                <TouchableOpacity
                  key={message}
                  style={[styles.messageChip, selected && styles.messageChipSelected]}
                  onPress={() => setMessageIndex(index)}
                >
                  <Text style={[styles.messageChipText, selected && styles.messageChipTextSelected]}>
                    {message}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <TouchableOpacity style={styles.cta} onPress={handleSubmit} disabled={isSaving}>
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.ctaText}>{mode === 'cover' ? STRINGS.coverCta(name) : STRINGS.waveCta(name)}</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 14,
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 10,
  },
  headline: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
    marginTop: 14,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  noteCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginTop: 18,
    ...cardShadow,
  },
  noteText: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 17,
  },
  optionList: {
    width: '100%',
    gap: 9,
    marginTop: 14,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...cardShadow,
  },
  optionText: {
    fontSize: 13,
    color: colors.ink,
  },
  pickPill: {
    backgroundColor: colors.green,
    borderRadius: 99,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  pickPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  messageChipRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  messageChip: {
    ...chipShape,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  messageChipSelected: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.green,
  },
  messageChipText: {
    ...chipTextShape,
    color: colors.muted,
  },
  messageChipTextSelected: {
    color: colors.green,
  },
  cta: {
    backgroundColor: colors.green,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  ctaText: {
    fontWeight: '700',
    fontSize: 14,
    color: '#fff',
  },
});
