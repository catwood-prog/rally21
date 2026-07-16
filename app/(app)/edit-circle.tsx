import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import {
  CircleNameField,
  circleFormStyles,
  ResourceLinkField,
  TimeOfDayField,
} from '@/components/CircleFormFields';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { editCircle, getCircleById, MyCircle } from '@/lib/circle';
import { isHttpUrl } from '@/lib/resourceLink';

/** EC1 — the host edits their circle after creation: name, time of day,
 * the practice wording/duration, and the resource link. Reached only
 * from the circle screen's host-only entries (the ✎ manage affordance
 * by the title and the Host Controls row); a non-host who lands here
 * anyway is sent back, and the edit itself is host-only at the database
 * (the edit_circle RPC). The day counter is not on this screen — an
 * edit never resets it. */
export default function EditCircle() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId } = useLocalSearchParams<{ circleId?: string }>();

  const [circle, setCircle] = useState<MyCircle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [name, setName] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [practiceName, setPracticeName] = useState('');
  const [practiceDuration, setPracticeDuration] = useState('');
  const [resourceUrl, setResourceUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A one-shot prefill, deliberately not the refetch-on-focus idiom —
  // this is a form holding the host's draft, not a display of shared
  // data; a background refetch would clobber what they're typing.
  useEffect(() => {
    if (!circleId || !session?.user) return;
    let cancelled = false;
    getCircleById(circleId)
      .then((c) => {
        if (cancelled) return;
        if (!c || c.createdBy !== session.user.id) {
          router.replace(
            c ? { pathname: '/circle', params: { circleId: c.id } } : '/circle'
          );
          return;
        }
        setCircle(c);
        setName(c.name);
        setTimeOfDay(c.timeOfDay ?? '');
        setPracticeName(c.practiceName ?? '');
        setPracticeDuration(
          c.practiceDurationMinutes ? String(c.practiceDurationMinutes) : ''
        );
        setResourceUrl(c.resourceUrl ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'could not load your circle'))
      .finally(() => !cancelled && setIsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [circleId, session?.user?.id]);

  const handleSave = async () => {
    if (!circle) return;
    const trimmedUrl = resourceUrl.trim();
    if (trimmedUrl && !isHttpUrl(trimmedUrl)) {
      setError('that link needs to start with http:// or https://');
      return;
    }
    setIsSaving(true);
    try {
      const durationMinutes = practiceDuration.trim()
        ? parseInt(practiceDuration.trim(), 10)
        : null;
      await editCircle({
        circleId: circle.id,
        name: name.trim(),
        timeOfDay: timeOfDay || null,
        resourceUrl: trimmedUrl || null,
        practiceName: practiceName.trim(),
        practiceDurationMinutes: durationMinutes && durationMinutes > 0 ? durationMinutes : null,
      });
      router.push({ pathname: '/circle', params: { circleId: circle.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save — try again');
      setIsSaving(false);
    }
  };

  if (isLoading || !circle) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
        <MessageDialog
          visible={!!error}
          title="hmm"
          message={error ?? ''}
          onDismiss={() => setError(null)}
        />
      </View>
    );
  }

  const canSave = !!name.trim() && !!practiceName.trim();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        onPress={() => router.push({ pathname: '/circle', params: { circleId: circle.id } })}
      >
        <Text style={styles.back}>← Your Circle</Text>
      </TouchableOpacity>

      <Text style={styles.title}>{STRINGS.editCircleTitle}</Text>

      <CircleNameField value={name} onChange={setName} />

      <TimeOfDayField value={timeOfDay} onChange={setTimeOfDay} style={styles.sectionSpacing} />

      <View style={styles.sectionSpacing}>
        <Text style={circleFormStyles.label}>{STRINGS.editCirclePracticeLabel}</Text>
        <Text style={circleFormStyles.helperText}>{STRINGS.editCirclePracticeHelper}</Text>
        <TextInput
          style={circleFormStyles.input}
          placeholder="e.g. Walk 20 minutes"
          placeholderTextColor={colors.muted}
          value={practiceName}
          onChangeText={setPracticeName}
          autoCorrect={false}
        />
        <TextInput
          style={[circleFormStyles.input, styles.durationInput]}
          placeholder={STRINGS.editCirclePracticeDurationPlaceholder}
          placeholderTextColor={colors.muted}
          value={practiceDuration}
          onChangeText={(text) => setPracticeDuration(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
        />
      </View>

      <ResourceLinkField value={resourceUrl} onChange={setResourceUrl} style={styles.sectionSpacing} />

      <Text style={styles.quietNote}>{STRINGS.editCircleQuietNote}</Text>

      <TouchableOpacity
        style={[styles.button, !canSave && styles.buttonDisabled]}
        onPress={handleSave}
        disabled={!canSave || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>{STRINGS.editCircleSaveCta}</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!error}
        title="hmm"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </ScrollView>
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
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
    fontSize: 22,
    color: colors.ink,
    marginBottom: 22,
  },
  sectionSpacing: {
    marginTop: 24,
  },
  durationInput: {
    marginTop: 10,
  },
  quietNote: {
    fontSize: 12.5,
    color: colors.muted,
    textAlign: 'center',
    marginTop: 24,
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
});
