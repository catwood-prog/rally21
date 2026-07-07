import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { MascotEntrance } from '@/components/MascotEntrance';
import { VoiceMicButton } from '@/components/VoiceMicButton';
import { FONT_HEADER, FONT_SERIF_ITALIC } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  BlueprintPattern,
  BlueprintResponse,
  describeBlueprintPattern,
  getMyBlueprint,
  getMyBlueprintResponses,
  markBlueprintPatternSurfaced,
  respondToBlueprintPattern,
} from '@/lib/blueprint';
import { getMyProfile } from '@/lib/profile';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

export default function Blueprint() {
  const router = useRouter();
  const { session } = useAuth();
  const [patterns, setPatterns] = useState<BlueprintPattern[]>([]);
  const [responses, setResponses] = useState<BlueprintResponse[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [isWritingNote, setIsWritingNote] = useState(false);
  const [micDenied, setMicDenied] = useState(false);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    setError(null);
    try {
      const [myPatterns, myResponses, profile] = await Promise.all([
        getMyBlueprint(),
        getMyBlueprintResponses(session.user.id),
        getMyProfile(session.user.id),
      ]);
      setPatterns(myPatterns);
      setResponses(myResponses);

      const respondedKeys = new Set(myResponses.map((r) => r.patternKey));
      const unresponded = myPatterns.filter((p) => !respondedKeys.has(p.patternKey));

      if (unresponded.length === 0) {
        setActiveKey(null);
      } else {
        const surfacedKey = profile?.blueprint_surfaced_pattern_key ?? null;
        const surfacedAt = profile?.blueprint_surfaced_at ?? null;
        const stillCandidate = surfacedKey && unresponded.some((p) => p.patternKey === surfacedKey);
        const withinCooldown = !!surfacedAt && Date.now() - new Date(surfacedAt).getTime() < SEVEN_DAYS_MS;

        const next = stillCandidate && withinCooldown ? surfacedKey! : unresponded[0].patternKey;
        setActiveKey(next);
        if (next !== surfacedKey) {
          markBlueprintPatternSurfaced(next).catch(() => {});
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load this yet');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleRespond = async (patternKey: string, response: 'confirmed' | 'not_quite', note?: string) => {
    if (!session?.user) return;
    setIsSaving(true);
    try {
      await respondToBlueprintPattern({ userId: session.user.id, patternKey, response, note });
      setResponses((prev) => [...prev, { patternKey, response, note: note ?? null }]);
      setIsWritingNote(false);
      setNoteDraft('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  const respondedByKey = new Map(responses.map((r) => [r.patternKey, r]));
  const confirmedPatterns = patterns.filter((p) => respondedByKey.get(p.patternKey)?.response === 'confirmed');
  const activePattern = patterns.find((p) => p.patternKey === activeKey) ?? null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.blueprintTitle}</Text>
      <Text style={styles.subtitle}>{STRINGS.blueprintSubline}</Text>

      {error && <Text style={styles.errorText}>{error}</Text>}

      {!error && patterns.length === 0 && (
        <View style={styles.emptyState}>
          <MascotEntrance source={MASCOT.journalCompanion} style={styles.emptyStateImage} />
          <Text style={styles.emptyStateText}>{STRINGS.blueprintEmptyText}</Text>
        </View>
      )}

      {activePattern &&
        (() => {
          const copy = describeBlueprintPattern(activePattern);
          return (
            <View style={styles.patternCard}>
              <Text style={styles.patternLabel}>{STRINGS.blueprintPatternLabel}</Text>
              <Text style={styles.patternHeadline}>
                {copy.headline} <Text style={styles.patternAccent}>{copy.accent}</Text>.
              </Text>
              <Text style={styles.patternMeta}>{copy.evidence}</Text>

              {isWritingNote ? (
                <View style={styles.noteWrap}>
                  <View style={styles.noteInputWrap}>
                    <TextInput
                      style={styles.noteInput}
                      placeholder={STRINGS.blueprintNotePlaceholder}
                      placeholderTextColor={colors.muted}
                      value={noteDraft}
                      onChangeText={setNoteDraft}
                      multiline
                    />
                    {!micDenied && (
                      <VoiceMicButton
                        style={styles.noteMicButton}
                        onTranscript={(text) => setNoteDraft((prev) => appendTranscript(prev, text))}
                        onPermissionDenied={() => setMicDenied(true)}
                      />
                    )}
                  </View>
                  <View style={styles.noteActionsRow}>
                    <TouchableOpacity
                      onPress={() => {
                        setIsWritingNote(false);
                        setNoteDraft('');
                      }}
                      disabled={isSaving}
                    >
                      <Text style={styles.noteSkipText}>{STRINGS.blueprintNoteSkip}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.noteSaveButton}
                      onPress={() => handleRespond(activePattern.patternKey, 'not_quite', noteDraft.trim() || undefined)}
                      disabled={isSaving}
                    >
                      <Text style={styles.noteSaveText}>{isSaving ? '…' : STRINGS.blueprintNoteSubmit}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.responseRow}>
                  <TouchableOpacity
                    style={styles.soundsRight}
                    onPress={() => handleRespond(activePattern.patternKey, 'confirmed')}
                    disabled={isSaving}
                  >
                    <Text style={styles.soundsRightText}>{STRINGS.blueprintSoundsRight}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.notQuite}
                    onPress={() => setIsWritingNote(true)}
                    disabled={isSaving}
                  >
                    <Text style={styles.notQuiteText}>{STRINGS.blueprintNotQuite}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })()}

      {confirmedPatterns.map((p) => {
        const copy = describeBlueprintPattern(p);
        return (
          <View key={p.patternKey} style={[styles.patternCard, styles.patternCardConfirmed]}>
            <Text style={styles.patternLabel}>{STRINGS.blueprintPatternLabel}</Text>
            <Text style={styles.patternHeadline}>
              {copy.headline} <Text style={styles.patternAccent}>{copy.accent}</Text>.
            </Text>
            <Text style={styles.patternMeta}>{copy.evidence}</Text>
            <Text style={styles.respondedText}>{STRINGS.blueprintConfirmedText}</Text>
          </View>
        );
      })}

      {patterns.length > 0 && <Text style={styles.footer}>{STRINGS.blueprintFooter}</Text>}
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12.5,
    color: colors.muted,
    marginBottom: 18,
  },
  errorText: {
    fontSize: 13,
    color: colors.errorRed,
    marginBottom: 12,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 24,
  },
  emptyStateImage: {
    width: 100,
    height: 145,
    marginBottom: 14,
  },
  emptyStateText: {
    fontSize: 13,
    color: colors.muted,
    textAlign: 'center',
  },
  patternCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.plum,
    padding: 18,
    marginBottom: 16,
    ...cardShadow,
  },
  patternCardConfirmed: {
    opacity: 0.75,
  },
  patternLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.plum,
    marginBottom: 8,
  },
  patternHeadline: {
    fontFamily: FONT_HEADER,
    fontSize: 18,
    color: colors.ink,
    lineHeight: 24,
  },
  patternAccent: {
    fontFamily: FONT_SERIF_ITALIC,
    color: colors.plum,
    fontSize: 21,
  },
  patternMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 10,
    lineHeight: 16,
  },
  responseRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 16,
  },
  soundsRight: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.plum,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  soundsRightText: {
    color: colors.plum,
    fontWeight: '700',
    fontSize: 12.5,
  },
  notQuite: {
    flex: 1,
    backgroundColor: colors.plumSoft,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  notQuiteText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12.5,
  },
  respondedText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 16,
    fontWeight: '600',
  },
  noteWrap: {
    marginTop: 16,
  },
  noteInputWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
  },
  noteInput: {
    flex: 1,
    padding: 12,
    fontSize: 13.5,
    color: colors.ink,
    minHeight: 44,
  },
  noteMicButton: {
    paddingRight: 10,
    paddingBottom: 10,
  },
  noteActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 18,
    marginTop: 10,
  },
  noteSkipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: colors.muted,
  },
  noteSaveButton: {
    backgroundColor: colors.plum,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 18,
  },
  noteSaveText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12.5,
  },
  footer: {
    fontSize: 10.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 8,
  },
});
