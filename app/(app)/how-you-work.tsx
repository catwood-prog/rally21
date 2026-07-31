import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { ErrorSlip } from '@/components/ErrorSlip';
import { withErrorBoundary } from '@/components/ErrorBoundary';
import { GhostCard } from '@/components/GhostCard';
import { MascotEntrance } from '@/components/MascotEntrance';
import { ReflectionsToggleRow } from '@/components/ReflectionsToggleRow';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors, scaledLineHeight } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getLocalDateString } from '@/lib/date';
import { formatManualExport, getMyManual, Manual, ManualEntry } from '@/lib/manual';
import { getMyProfile, setReflectionsOptOut } from '@/lib/profile';

/** MN2 — "how you work". The manual is a DESTINATION, never a form: every
 * word on it came from a daily question the person already answered or a
 * pattern the app already observed. Two labelled lanes, rendered next to
 * each other and never merged (memo §3); the "you said X but we saw Y"
 * insight is MN3's, not v1's.
 *
 * Ruling 2 is enforced by absence: there is no share control, no
 * visibility setting and no send-to-circle anywhere in this file. The one
 * exit is the download below, which leaves through the OS share sheet and
 * takes the person's own words with them.
 */

/** Dates read as words, matching the journal's own long form. */
function formatManualDate(localDate: string): string {
  const [y, m, d] = localDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
  });
}

function ManualEntryRow({ entry }: { entry: ManualEntry }) {
  const [showEarlier, setShowEarlier] = useState(false);

  return (
    <View style={styles.entry}>
      <Text style={styles.entryQuestion}>{entry.question}</Text>
      <Text style={styles.entryAnswer}>{entry.answer}</Text>
      <Text style={styles.entryDate}>{formatManualDate(entry.localDate)}</Text>

      {/* Earlier answers to the SAME question, behind a quiet expander —
          the prompt's "not a wall of history". Collapsed by default. */}
      {entry.earlier.length > 0 && (
        <>
          <TouchableOpacity
            style={styles.earlierToggle}
            onPress={() => setShowEarlier((v) => !v)}
          >
            <Text style={styles.earlierToggleText}>
              {showEarlier
                ? STRINGS.manualEarlierCollapse
                : STRINGS.manualEarlierExpander(entry.earlier.length)}
            </Text>
          </TouchableOpacity>
          {showEarlier &&
            entry.earlier.map((older) => (
              <View key={`${older.localDate}-${older.answer}`} style={styles.earlierRow}>
                <Text style={styles.earlierAnswer}>{older.answer}</Text>
                <Text style={styles.entryDate}>{formatManualDate(older.localDate)}</Text>
              </View>
            ))}
        </>
      )}
    </View>
  );
}

function HowYouWork() {
  const router = useRouter();
  const { session } = useAuth();
  const [manual, setManual] = useState<Manual>({ sections: [], isEmpty: true });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [reflectionsOff, setReflectionsOff] = useState(false);
  const [isTogglingReflections, setIsTogglingReflections] = useState(false);
  // Latched at load, not read live — same reason the journal and the map
  // latch it: unmounting the row you just tapped reads as a dead tap.
  const [showReflectionsToggle, setShowReflectionsToggle] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setLoadError(null);
    setError(null);
    try {
      const [myManual, profile] = await Promise.all([
        getMyManual(session.user.id),
        getMyProfile(session.user.id),
      ]);
      setManual(myManual);
      setReflectionsOff(profile?.reflections_opt_out ?? false);
      setShowReflectionsToggle(profile?.reflections_opt_out ?? false);
    } catch {
      setLoadError(STRINGS.loadFailedLine('this page'));
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleToggleReflections = async () => {
    if (!session?.user || isTogglingReflections) return;
    const next = !reflectionsOff;
    setIsTogglingReflections(true);
    setReflectionsOff(next);
    try {
      await setReflectionsOptOut(session.user.id, next);
    } catch {
      setReflectionsOff(!next);
      setError(STRINGS.reflectionsToggleFailed);
    } finally {
      setIsTogglingReflections(false);
    }
  };

  /** JOB 3 — the only exit, and it works on BOTH platforms by
   * construction. This is EX1's transport verbatim, chosen because the
   * your-data export shipped web-only with no else-branch and silently did
   * nothing on a phone. React Native's Share.share forwards to
   * navigator.share on web where the browser has it and REJECTS where it
   * doesn't, so the catch is the one place a web build without Web Share
   * falls back to the clipboard. On iOS, cancelling the sheet resolves
   * rather than throwing. Either way this is never a silent no-op. */
  const handleExport = async () => {
    const text = formatManualExport(manual, formatManualDate);
    try {
      await Share.share({ message: text });
    } catch (err) {
      if (Platform.OS === 'web' && (err as Error | null)?.name === 'AbortError') return;
      await Clipboard.setStringAsync(text);
      setExportNotice(STRINGS.manualExportCopiedNotice);
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <AppHeader style={styles.header} />

      <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
        <Text style={styles.backLink}>← {STRINGS.blueprintTitle}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.manualTitle}</Text>
      {/* OD1 job 21 — the same one privacy mark the map and journal carry. */}
      <View style={styles.lock}>
        <Text style={styles.lockText}>{STRINGS.privateBadge}</Text>
      </View>
      <Text style={styles.subtitle}>{STRINGS.manualSubline}</Text>

      {loadError && <ErrorSlip message={loadError} />}
      {error && <Text style={styles.errorText}>{error}</Text>}
      {exportNotice && <Text style={styles.exportNotice}>{exportNotice}</Text>}

      {/* SK1's no-nag law — the reflections-off state replaces the ordinary
          empty state, never real content found before the switch went off. */}
      {!loadError && manual.isEmpty && reflectionsOff && (
        <View style={styles.dormantState}>
          <GhostCard widths={[44, 90, 70]} />
          <GhostCard widths={[34, 82, 58]} />
          <Text style={styles.dormantLine}>{STRINGS.manualReflectionsOffLine}</Text>
        </View>
      )}

      {/* JOB 2 — for the beta's first month this IS the screen. Two lines,
          describing the mechanism, promising nothing. */}
      {!loadError && manual.isEmpty && !reflectionsOff && (
        <View style={styles.emptyState}>
          <MascotEntrance source={MASCOT.journalCompanion} style={styles.emptyStateImage} />
          <Text style={styles.emptyTitle}>{STRINGS.manualEmptyTitle}</Text>
          <Text style={styles.emptyText}>{STRINGS.manualEmptyText}</Text>
        </View>
      )}

      {manual.sections.map((section) => (
        <View key={section.key} style={styles.section}>
          <Text style={styles.sectionTitle}>
            {STRINGS.manualSectionLabels[section.key] ?? section.key}
          </Text>

          {/* The two lanes, adjacent and separately labelled. Rendering
              them side by side IS the v1 move; merging them is banned. */}
          {section.entries.length > 0 && (
            <View style={styles.lane}>
              <Text style={styles.laneLabel}>{STRINGS.manualLaneDeclared}</Text>
              {section.entries.map((entry) => (
                <ManualEntryRow key={entry.questionCode} entry={entry} />
              ))}
            </View>
          )}

          {section.observations.length > 0 && (
            <View style={[styles.lane, styles.laneObserved]}>
              <Text style={styles.laneLabel}>{STRINGS.manualLaneObserved}</Text>
              {section.observations.map((observation) => (
                <View key={observation.patternKey} style={styles.observation}>
                  <Text style={styles.observationText}>{observation.text}</Text>
                  {!!observation.evidence && (
                    <Text style={styles.observationEvidence}>{observation.evidence}</Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      ))}

      {/* The one exit. Absent while there is nothing to export. */}
      {!manual.isEmpty && (
        <TouchableOpacity style={styles.exportButton} onPress={handleExport}>
          <Text style={styles.exportButtonText}>{STRINGS.manualExportCta}</Text>
        </TouchableOpacity>
      )}

      {showReflectionsToggle && (
        <ReflectionsToggleRow
          value={!reflectionsOff}
          onToggle={handleToggleReflections}
          disabled={isTogglingReflections}
        />
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
    paddingBottom: 40,
  },
  header: {
    marginBottom: 16,
  },
  backLink: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.mutedStrong,
    marginBottom: 12,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 4,
  },
  lock: {
    alignSelf: 'flex-start',
    backgroundColor: colors.greenSoft,
    borderRadius: 99,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8,
  },
  lockText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: colors.greenText,
  },
  subtitle: {
    fontSize: 12.5,
    lineHeight: scaledLineHeight(18),
    color: colors.mutedStrong,
    marginBottom: 18,
  },
  errorText: {
    fontSize: 13,
    color: colors.errorRed,
    marginBottom: 12,
  },
  exportNotice: {
    fontSize: 12.5,
    color: colors.mutedStrong,
    marginBottom: 12,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 10,
  },
  // The declared lane takes the inner-life plum the private map uses for
  // reflection content; the observed lane stays quieter so the person's
  // own words keep primacy on their own page.
  lane: {
    backgroundColor: colors.card,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.plum,
    padding: 16,
    marginBottom: 10,
    ...cardShadow,
  },
  laneObserved: {
    borderColor: colors.line,
  },
  laneLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.mutedStrong,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 10,
  },
  entry: {
    marginBottom: 14,
  },
  entryQuestion: {
    fontSize: 12,
    lineHeight: scaledLineHeight(17),
    color: colors.mutedStrong,
    marginBottom: 4,
  },
  entryAnswer: {
    fontSize: 14.5,
    lineHeight: scaledLineHeight(20),
    color: colors.ink,
  },
  entryDate: {
    fontSize: 10.5,
    color: colors.mutedStrong,
    marginTop: 3,
  },
  earlierToggle: {
    minHeight: 44,
    justifyContent: 'center',
  },
  earlierToggleText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.plum,
  },
  earlierRow: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: 8,
    marginTop: 4,
  },
  earlierAnswer: {
    fontSize: 13,
    lineHeight: scaledLineHeight(18),
    color: colors.mutedStrong,
  },
  observation: {
    marginBottom: 12,
  },
  observationText: {
    fontSize: 14,
    lineHeight: scaledLineHeight(20),
    color: colors.ink,
  },
  observationEvidence: {
    fontSize: 11,
    lineHeight: scaledLineHeight(16),
    color: colors.mutedStrong,
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 24,
    marginBottom: 24,
  },
  emptyStateImage: {
    width: 100,
    height: 145,
    marginBottom: 14,
  },
  emptyTitle: {
    fontFamily: FONT_HEADER,
    fontSize: 17,
    color: colors.ink,
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: scaledLineHeight(19),
    color: colors.mutedStrong,
    textAlign: 'center',
  },
  dormantState: {
    paddingTop: 4,
    marginBottom: 24,
  },
  dormantLine: {
    fontSize: 13.5,
    lineHeight: scaledLineHeight(21),
    color: colors.mutedStrong,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  exportButton: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
  },
  exportButtonText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 13,
  },
});

export default withErrorBoundary(HowYouWork, 'screen:how-you-work');
