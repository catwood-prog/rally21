import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brandmark } from '@/components/Brandmark';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { joinCircleByCode, joinPublicCircle, listPublicCircles, PublicCircle } from '@/lib/circle-setup';
import { reportContent } from '@/lib/moderation';

export default function JoinCircle() {
  const router = useRouter();
  // NAV1 job 0 — no AppHeader on pre-signed-in-chrome screens, but the
  // safe-area inset still applies.
  const insets = useSafeAreaInsets();
  const { fromToday } = useLocalSearchParams<{ fromToday?: string }>();
  const isFromToday = fromToday === 'true';
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [publicCircles, setPublicCircles] = useState<PublicCircle[]>([]);
  const [isLoadingPublic, setIsLoadingPublic] = useState(true);
  const [joiningCircleId, setJoiningCircleId] = useState<string | null>(null);
  const [reportingCircleId, setReportingCircleId] = useState<string | null>(null);
  const [circleReportReason, setCircleReportReason] = useState('');
  const [isReportingCircle, setIsReportingCircle] = useState(false);
  const [showCircleReportedNotice, setShowCircleReportedNotice] = useState(false);

  useEffect(() => {
    listPublicCircles()
      .then(setPublicCircles)
      .catch(() => {
        // browsing is a bonus on this screen — a code still works if this fails
      })
      .finally(() => setIsLoadingPublic(false));
  }, []);

  const handleJoin = async () => {
    if (!code.trim()) return;
    setIsJoining(true);
    try {
      await joinCircleByCode(code);
      // "/" re-checks profile + membership and lands on Today
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : "that code didn't work — double check it");
      setIsJoining(false);
    }
  };

  const handleJoinPublic = async (circle: PublicCircle) => {
    setJoiningCircleId(circle.circleId);
    try {
      await joinPublicCircle(circle.circleId);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not join that circle — try again');
      setJoiningCircleId(null);
    }
  };

  // MOD1: a second independent report auto-hides the circle from
  // browse pending review — server-side (report_content's own circuit
  // breaker), nothing this screen needs to track itself.
  const handleReportCircle = async (circleId: string) => {
    setIsReportingCircle(true);
    try {
      await reportContent({ targetKind: 'circle', targetId: circleId, reason: circleReportReason.trim() || undefined });
      setReportingCircleId(null);
      setCircleReportReason('');
      setShowCircleReportedNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send that report — try again');
    } finally {
      setIsReportingCircle(false);
    }
  };

  return (
    <KeyboardFriendlyScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: 24 + insets.top }]}
    >
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push(isFromToday ? '/today' : '/onboarding/circle-setup')}>
        <Text style={styles.back}>{isFromToday ? '← Today' : '← Back'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>got a code?</Text>
      <Text style={styles.subtitle}>enter the 6-character code your friend sent you</Text>

      <TextInput
        style={styles.input}
        placeholder="ABC123"
        placeholderTextColor={colors.muted}
        value={code}
        onChangeText={(text) => setCode(text.toUpperCase())}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={6}
        onSubmitEditing={handleJoin}
      />

      <TouchableOpacity
        style={[styles.button, !code.trim() && styles.buttonDisabled]}
        onPress={handleJoin}
        disabled={!code.trim() || isJoining}
      >
        {isJoining ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Join circle</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.sectionLabel}>or browse open circles</Text>
      <Text style={styles.disclosureText}>{STRINGS.joinDisclosure}</Text>

      {isLoadingPublic ? (
        <ActivityIndicator color={colors.green} />
      ) : publicCircles.length === 0 ? (
        <Text style={styles.emptyText}>no public circles open right now</Text>
      ) : (
        publicCircles.map((circle) => (
          <View key={circle.circleId} style={styles.publicCard}>
            <View style={styles.publicCardRow}>
              <View style={styles.publicCardInfo}>
                <Text style={styles.publicCardName}>{circle.name}</Text>
                <Text style={styles.publicCardMeta}>
                  {circle.practiceName?.toLowerCase()} · {circle.memberCount}{' '}
                  {circle.memberCount === 1 ? 'member' : 'members'} · day{' '}
                  {Math.min(circle.dayNumber, circle.durationDays)} of {circle.durationDays}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.joinChip}
                onPress={() => handleJoinPublic(circle)}
                disabled={joiningCircleId === circle.circleId}
              >
                {joiningCircleId === circle.circleId ? (
                  <ActivityIndicator size="small" color={colors.green} />
                ) : (
                  <Text style={styles.joinChipText}>Join</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  setReportingCircleId(reportingCircleId === circle.circleId ? null : circle.circleId)
                }
                hitSlop={8}
              >
                <Text style={styles.publicCardMoreLink}>⋯</Text>
              </TouchableOpacity>
            </View>
            {reportingCircleId === circle.circleId && (
              <View style={styles.circleReportPanel}>
                <MicTextInput
                  style={styles.circleReportInput}
                  placeholder={STRINGS.reportReasonPlaceholder}
                  placeholderTextColor={colors.muted}
                  value={circleReportReason}
                  onChangeText={setCircleReportReason}
                  multiline
                />
                <View style={styles.circleReportActionsRow}>
                  <TouchableOpacity
                    onPress={() => {
                      setReportingCircleId(null);
                      setCircleReportReason('');
                    }}
                    disabled={isReportingCircle}
                  >
                    <Text style={styles.circleReportCancelText}>{STRINGS.reportCancelCta}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleReportCircle(circle.circleId)} disabled={isReportingCircle}>
                    <Text style={styles.circleReportSubmitText}>
                      {isReportingCircle ? '…' : STRINGS.reportSubmitCta}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ))
      )}

      <MessageDialog
        visible={showCircleReportedNotice}
        title={STRINGS.reportedConfirmationTitle}
        message={STRINGS.reportedConfirmationBody}
        onDismiss={() => setShowCircleReportedNotice(false)}
      />
      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </KeyboardFriendlyScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    padding: 24,
    paddingBottom: 40,
  },
  brandmark: {
    marginBottom: 14,
  },
  back: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 25,
    color: colors.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 22,
    lineHeight: 19,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 16,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 4,
    textAlign: 'center',
    color: colors.ink,
    marginBottom: 16,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginTop: 28,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    color: colors.muted,
  },
  disclosureText: {
    fontSize: 11.5,
    color: colors.muted,
    lineHeight: 16,
    marginBottom: 16,
    marginTop: -6,
  },
  publicCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    ...cardShadow,
  },
  publicCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  publicCardInfo: {
    flex: 1,
  },
  publicCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  publicCardMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  publicCardMoreLink: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.muted,
    paddingHorizontal: 4,
  },
  joinChip: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.green,
    borderRadius: 99,
    paddingVertical: 8,
    paddingHorizontal: 18,
    minWidth: 58,
    alignItems: 'center',
  },
  joinChipText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: colors.green,
  },
  circleReportPanel: {
    marginTop: 10,
    gap: 8,
  },
  circleReportInput: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    padding: 10,
    fontSize: 12.5,
    color: colors.ink,
    minHeight: 44,
  },
  circleReportActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
  },
  circleReportCancelText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  circleReportSubmitText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.ink,
  },
});
