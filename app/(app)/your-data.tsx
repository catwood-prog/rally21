import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors, scaledLineHeight } from '@/constants/theme';
import { deleteMyAccount } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';
import { removeAvatar } from '@/lib/profile';
import { DataSummary, exportMyData, getDataSummary } from '@/lib/yourData';

type Section = 'summary' | 'deletePhoto' | null;

function formatDateLabel(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** DC1 — "your data & privacy" (MVP Screens mockup #23): where the
 * privacy-promise screen's "see, export, or delete anytime" becomes
 * real. Reached from Settings; the danger-zone delete-account flow lives
 * here now (moved from settings.tsx) rather than split across screens.
 * YD1 (21 July) dropped the single-check-in delete section (Cat's
 * ruling) and moved the blurb onto private-map vocabulary. */
export default function YourData() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const userId = session?.user.id;

  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [openSection, setOpenSection] = useState<Section>(null);
  const [error, setError] = useState<string | null>(null);

  const [confirmingDeletePhoto, setConfirmingDeletePhoto] = useState(false);
  const [isDeletingPhoto, setIsDeletingPhoto] = useState(false);

  const [isExporting, setIsExporting] = useState(false);

  const [confirmingDeleteAccount, setConfirmingDeleteAccount] = useState(false);
  const [deleteAccountTypedText, setDeleteAccountTypedText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    try {
      const data = await getDataSummary(userId);
      setSummary(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your data — try again');
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleSection = (section: Exclude<Section, null>) => {
    setOpenSection(openSection === section ? null : section);
  };

  const handleExport = async () => {
    if (!userId) return;
    setIsExporting(true);
    try {
      const data = await exportMyData(userId);
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === 'web') {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `rally21-my-data-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : STRINGS.yourDataExportError);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!userId) return;
    setIsDeletingPhoto(true);
    try {
      await removeAvatar(userId);
      setConfirmingDeletePhoto(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : STRINGS.yourDataDeletePhotoError);
    } finally {
      setIsDeletingPhoto(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    try {
      await deleteMyAccount();
      await signOut();
      router.replace('/sign-in');
    } catch (e) {
      setError(e instanceof Error ? e.message : STRINGS.yourDataDeleteAccountError);
      setIsDeletingAccount(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <KeyboardFriendlyScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/settings')}>
        <Text style={styles.back}>← Settings</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.yourDataTitle}</Text>

      <View style={styles.reassuranceCard}>
        <Text style={styles.reassuranceText}>{STRINGS.yourDataReassurance}</Text>
      </View>

      <Text style={styles.sectionLabel}>{STRINGS.yourDataSectionLabel}</Text>

      <View style={styles.rowsCard}>
        <TouchableOpacity style={styles.row} onPress={() => toggleSection('summary')}>
          <Text style={styles.rowText}>👀 {STRINGS.yourDataSeeEverything}</Text>
          <Text style={styles.rowChevron}>{openSection === 'summary' ? '⌄' : '›'}</Text>
        </TouchableOpacity>
        {openSection === 'summary' && summary && (
          <View style={styles.expandedPanel}>
            <Text style={styles.summaryLine}>
              {summary.name ?? 'you'} · {STRINGS.yourDataSummaryJoined(formatDateLabel(summary.joinedDate.slice(0, 10)))}
            </Text>
            <Text style={styles.summaryLine}>circles — {STRINGS.yourDataSummaryCircles(summary.circleCount)}</Text>
            <Text style={styles.summaryLine}>check-ins — {STRINGS.yourDataSummaryCheckins(summary.checkinCount)}</Text>
            <Text style={styles.summaryLine}>
              reflections + moods — {STRINGS.yourDataSummaryReflections(summary.reflectionCount)}
            </Text>
            <Text style={styles.summaryLine}>
              private map —{' '}
              {summary.hasPrivateMap ? STRINGS.yourDataSummaryPrivateMapBuilt : STRINGS.yourDataSummaryPrivateMapEmpty}
            </Text>
            <Text style={styles.summaryLine}>
              Rally conversations — {STRINGS.yourDataSummaryConversations(summary.conversationMessageCount)}
            </Text>
            {summary.notificationPrefs && (
              <Text style={styles.summaryLine}>
                notifications — daily nudge{' '}
                {summary.notificationPrefs.nudgeEnabled
                  ? STRINGS.yourDataSummaryNotificationsOn
                  : STRINGS.yourDataSummaryNotificationsOff}
                , friend waves{' '}
                {summary.notificationPrefs.friendNudgeEnabled
                  ? STRINGS.yourDataSummaryNotificationsOn
                  : STRINGS.yourDataSummaryNotificationsOff}
                , evening digest{' '}
                {summary.notificationPrefs.digestEnabled
                  ? STRINGS.yourDataSummaryNotificationsOn
                  : STRINGS.yourDataSummaryNotificationsOff}
              </Text>
            )}
          </View>
        )}

        <TouchableOpacity style={styles.row} onPress={handleExport} disabled={isExporting}>
          <Text style={styles.rowText}>⬇️ {STRINGS.yourDataExport}</Text>
          {isExporting ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={styles.rowChevron}>›</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => toggleSection('deletePhoto')}>
          <Text style={[styles.rowText, styles.rowTextWarn]}>
            ❌ {STRINGS.yourDataDeletePhoto} <Text style={styles.rowTextNote}>{STRINGS.yourDataDeletePhotoNote}</Text>
          </Text>
          <Text style={styles.rowChevron}>{openSection === 'deletePhoto' ? '⌄' : '›'}</Text>
        </TouchableOpacity>
        {openSection === 'deletePhoto' && (
          <View style={styles.expandedPanel}>
            {confirmingDeletePhoto ? (
              <View style={styles.inlineConfirm}>
                <Text style={styles.inlineConfirmText}>{STRINGS.yourDataDeletePhotoConfirm}</Text>
                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setConfirmingDeletePhoto(false)}
                    disabled={isDeletingPhoto}
                  >
                    <Text style={styles.cancelButtonText}>{STRINGS.yourDataDeletePhotoCancelCta}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmDeleteButton}
                    onPress={handleRemovePhoto}
                    disabled={isDeletingPhoto}
                  >
                    {isDeletingPhoto ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.confirmDeleteText}>{STRINGS.yourDataDeletePhotoConfirmCta}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setConfirmingDeletePhoto(true)}>
                <Text style={styles.deleteLink}>{STRINGS.yourDataDeletePhotoConfirmCta}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <Text style={styles.footerNote}>{STRINGS.yourDataFooterNote}</Text>

      <Text style={[styles.sectionLabel, styles.dangerZoneLabel]}>{STRINGS.yourDataDangerZoneLabel}</Text>
      {!confirmingDeleteAccount ? (
        <TouchableOpacity style={styles.deleteAccountButton} onPress={() => setConfirmingDeleteAccount(true)}>
          <Text style={styles.deleteAccountButtonText}>{STRINGS.yourDataDeleteAccountCta}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmText}>{STRINGS.yourDataDeleteAccountConfirmIntro}</Text>
          <Text style={styles.typeToConfirmLabel}>{STRINGS.yourDataDeleteAccountTypeToConfirmLabel}</Text>
          <TextInput
            style={styles.typeToConfirmInput}
            value={deleteAccountTypedText}
            onChangeText={setDeleteAccountTypedText}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            placeholderTextColor={colors.muted}
          />
          <View style={styles.confirmRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => {
                setConfirmingDeleteAccount(false);
                setDeleteAccountTypedText('');
              }}
              disabled={isDeletingAccount}
            >
              <Text style={styles.cancelButtonText}>{STRINGS.yourDataDeleteAccountCancelCta}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirmDeleteButton,
                deleteAccountTypedText.trim().toUpperCase() !== 'DELETE' && styles.buttonDisabled,
              ]}
              onPress={handleDeleteAccount}
              disabled={isDeletingAccount || deleteAccountTypedText.trim().toUpperCase() !== 'DELETE'}
            >
              {isDeletingAccount ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmDeleteText}>{STRINGS.yourDataDeleteAccountConfirmCta}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <MessageDialog visible={!!error} title="hmm" variant="error" message={error ?? ''} onDismiss={() => setError(null)} />
    </KeyboardFriendlyScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 64,
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
    fontSize: 24,
    color: colors.ink,
    marginBottom: 16,
  },
  reassuranceCard: {
    backgroundColor: colors.greenSoft,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  },
  reassuranceText: {
    fontSize: 12,
    lineHeight: scaledLineHeight(18),
    color: colors.ink,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  rowsCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowText: {
    flex: 1,
    fontSize: 12.5,
    color: colors.ink,
  },
  rowTextWarn: {
    color: colors.errorRed,
  },
  rowTextNote: {
    color: colors.muted,
    fontWeight: '600',
  },
  rowChevron: {
    fontSize: 14,
    color: colors.muted,
  },
  expandedPanel: {
    paddingVertical: 12,
    paddingLeft: 4,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  summaryLine: {
    fontSize: 12,
    color: colors.ink,
    lineHeight: scaledLineHeight(18),
  },
  deleteLink: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.errorRed,
  },
  inlineConfirm: {
    backgroundColor: colors.bg,
    borderRadius: 12,
    padding: 12,
    gap: 10,
  },
  inlineConfirmText: {
    fontSize: 11.5,
    color: colors.ink,
    lineHeight: scaledLineHeight(16),
  },
  confirmRow: {
    flexDirection: 'row',
    gap: 8,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontWeight: '700',
    fontSize: 12.5,
    color: colors.ink,
  },
  confirmDeleteButton: {
    flex: 1,
    backgroundColor: colors.errorRed,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  confirmDeleteText: {
    fontWeight: '700',
    fontSize: 12.5,
    color: '#fff',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  footerNote: {
    fontSize: 10.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: scaledLineHeight(15),
  },
  dangerZoneLabel: {
    marginTop: 28,
  },
  deleteAccountButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.errorRed,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteAccountButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.errorRed,
  },
  confirmCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: colors.errorRed,
    ...cardShadow,
  },
  confirmText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: scaledLineHeight(18),
    marginBottom: 14,
  },
  typeToConfirmLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    marginBottom: 6,
  },
  typeToConfirmInput: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 14,
    letterSpacing: 1,
  },
});
