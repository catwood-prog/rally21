import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { removeMemberFromCircle } from '@/lib/circle';
import {
  adminDeleteWallMessage,
  adminDismissReport,
  adminHideCircle,
  adminMarkReportActioned,
  getPendingReports,
  isFounder,
  PendingReport,
} from '@/lib/moderation';

/** MOD1 (7 July) — the founder-only /reports screen. Same allowlist
 * pattern as app_caps()/is_founder() — gated both client-side (redirect
 * away, here) and server-side (every RPC this screen calls self-checks
 * is_founder() and raises otherwise; this redirect is a courtesy, not
 * the real enforcement). Every act button is a deliberate human
 * decision — nothing here ever runs automatically. */
export default function Reports() {
  const router = useRouter();
  const [checkedFounder, setCheckedFounder] = useState(false);
  const [reports, setReports] = useState<PendingReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const founder = await isFounder();
      if (!founder) {
        router.replace('/today');
        return;
      }
      setCheckedFounder(true);
      const pending = await getPendingReports();
      setReports(pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load reports');
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const removeFromList = (reportId: string) => setReports((prev) => prev.filter((r) => r.reportId !== reportId));

  const handleDismiss = async (report: PendingReport) => {
    setActingOnId(report.reportId);
    try {
      await adminDismissReport(report.reportId);
      removeFromList(report.reportId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not dismiss — try again');
    } finally {
      setActingOnId(null);
    }
  };

  const handleDeleteWallMessage = async (report: PendingReport) => {
    setActingOnId(report.reportId);
    try {
      await adminDeleteWallMessage(report.targetId);
      await adminMarkReportActioned(report.reportId);
      removeFromList(report.reportId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete that message — try again');
    } finally {
      setActingOnId(null);
    }
  };

  const handleRemoveMember = async (report: PendingReport) => {
    if (!report.memberCircleId) return;
    setActingOnId(report.reportId);
    try {
      await removeMemberFromCircle(report.memberCircleId, report.targetId);
      await adminMarkReportActioned(report.reportId);
      removeFromList(report.reportId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not remove that member — try again');
    } finally {
      setActingOnId(null);
    }
  };

  const handleHideCircle = async (report: PendingReport) => {
    setActingOnId(report.reportId);
    try {
      await adminHideCircle(report.targetId);
      await adminMarkReportActioned(report.reportId);
      removeFromList(report.reportId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not hide that circle — try again');
    } finally {
      setActingOnId(null);
    }
  };

  if (isLoading || !checkedFounder) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.header} />
      <Text style={styles.title}>reports</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {reports.length === 0 ? (
        <Text style={styles.emptyText}>nothing pending — all clear</Text>
      ) : (
        reports.map((report) => {
          const isActing = actingOnId === report.reportId;
          return (
            <View key={report.reportId} style={styles.card}>
              <Text style={styles.kindLabel}>{report.targetKind.replace('_', ' ')}</Text>

              {report.targetKind === 'wall_message' && (
                <>
                  <Text style={styles.bodyText}>&quot;{report.wallMessageBody ?? '(message not found)'}&quot;</Text>
                  <Text style={styles.metaText}>in {report.wallMessageCircleName ?? 'unknown circle'}</Text>
                </>
              )}
              {report.targetKind === 'member' && (
                <>
                  <Text style={styles.bodyText}>{report.memberName ?? 'unknown member'}</Text>
                  <Text style={styles.metaText}>seen in {report.memberCircleName ?? 'unknown circle'}</Text>
                </>
              )}
              {report.targetKind === 'circle' && (
                <>
                  <Text style={styles.bodyText}>{report.circleName ?? 'unknown circle'}</Text>
                  {report.circlePracticeName && <Text style={styles.metaText}>{report.circlePracticeName}</Text>}
                </>
              )}

              <Text style={styles.metaText}>
                reported by {report.reporterName} · {new Date(report.createdAt).toLocaleString()}
              </Text>
              {report.reason && <Text style={styles.reasonText}>&quot;{report.reason}&quot;</Text>}

              <View style={styles.actionsRow}>
                <TouchableOpacity onPress={() => handleDismiss(report)} disabled={isActing}>
                  <Text style={styles.dismissText}>Dismiss</Text>
                </TouchableOpacity>

                {report.targetKind === 'wall_message' && (
                  <TouchableOpacity onPress={() => handleDeleteWallMessage(report)} disabled={isActing}>
                    <Text style={styles.destructiveText}>{isActing ? '…' : 'Delete message'}</Text>
                  </TouchableOpacity>
                )}
                {report.targetKind === 'member' && report.memberCircleId && (
                  <TouchableOpacity onPress={() => handleRemoveMember(report)} disabled={isActing}>
                    <Text style={styles.destructiveText}>{isActing ? '…' : 'Remove from circle'}</Text>
                  </TouchableOpacity>
                )}
                {report.targetKind === 'circle' && (
                  <TouchableOpacity onPress={() => handleHideCircle(report)} disabled={isActing}>
                    <Text style={styles.destructiveText}>{isActing ? '…' : 'Hide from browse'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
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
  header: {
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 12.5,
    color: colors.errorRed,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    color: colors.muted,
    fontStyle: 'italic',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    gap: 4,
  },
  kindLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 4,
  },
  bodyText: {
    fontSize: 13.5,
    color: colors.ink,
    lineHeight: 19,
  },
  metaText: {
    fontSize: 11,
    color: colors.muted,
  },
  reasonText: {
    fontSize: 12,
    color: colors.ink,
    fontStyle: 'italic',
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 20,
    marginTop: 10,
  },
  dismissText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
  destructiveText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.errorRed,
  },
});
