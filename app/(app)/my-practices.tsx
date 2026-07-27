import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { BackLink } from '@/components/BackLink';
import { KeyboardFriendlyScrollView } from '@/components/KeyboardFriendlyScrollView';
import { MicTextInput } from '@/components/MicTextInput';
import { MessageDialog } from '@/components/MessageDialog';
import { PracticePill } from '@/components/PracticePill';
import { PracticeTypePicker, PracticeTypeSelection } from '@/components/PracticeTypePicker';
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  archivePractice,
  createPractice,
  listMyPractices,
  Practice,
  unarchivePractice,
  updatePractice,
} from '@/lib/circle-setup';

// PT1: the manual four-domain chip row became the shared guided picker —
// the classifier suggests a domain + type from the name, the person can
// always override, and both labels are required to save.
type FormState = { name: string; selection: PracticeTypeSelection | null; duration: string };

const BLANK_FORM: FormState = { name: '', selection: null, duration: '' };

export default function MyPractices() {
  const router = useRouter();
  const { session } = useAuth();

  const [practices, setPractices] = useState<Practice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    try {
      setPractices(await listMyPractices(session.user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your practices');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const startEdit = (practice: Practice) => {
    setEditingId(practice.id);
    setForm({
      name: practice.name,
      selection: { domain: practice.category, type: practice.practiceType },
      duration: practice.durationMinutes ? String(practice.durationMinutes) : '',
    });
  };

  const startCreate = () => {
    setEditingId('new');
    setForm(BLANK_FORM);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(BLANK_FORM);
  };

  const handleSave = async () => {
    if (!session?.user || !form.name.trim() || !form.selection) return;
    setIsSaving(true);
    try {
      const durationMinutes = form.duration.trim() ? parseInt(form.duration.trim(), 10) : null;
      const cleanDuration = durationMinutes && durationMinutes > 0 ? durationMinutes : null;

      if (editingId === 'new') {
        // CF1: no category sent — the server derives the shelf from the
        // practice type.
        await createPractice({
          name: form.name,
          practiceType: form.selection.type,
          durationMinutes: cleanDuration,
          createdBy: session.user.id,
        });
      } else if (editingId) {
        await updatePractice(editingId, {
          name: form.name,
          practiceType: form.selection.type,
          durationMinutes: cleanDuration,
        });
      }
      cancelEdit();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  // OD1 job 11b — archive stays ONE TAP, deliberately. The external
  // audit asked for a confirmation here and that prescription is wrong:
  // archivePractice is `update({ is_archived: true })` and nothing else,
  // it destroys no data, and PB1 already proved archived practices keep
  // working for the circles already on them. A confirm on a fully
  // reversible action is friction theatre — it taxes every use to
  // protect against a harm that doesn't exist. What was actually missing
  // is the way back, which is handleRestore below.
  const handleArchive = async (practice: Practice) => {
    try {
      await archivePractice(practice.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not archive that — try again');
    }
  };

  const handleRestore = async (practice: Practice) => {
    try {
      await unarchivePractice(practice.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not restore that — try again');
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
      <BackLink label="settings" onPress={() => router.push('/settings')} style={styles.back} />

      <Text style={styles.title}>my practices</Text>
      <Text style={styles.subtitle}>{STRINGS.myPracticesSubtitle}</Text>

      {practices.length === 0 && editingId !== 'new' && (
        <Text style={styles.emptyText}>you haven&apos;t created any practices yet</Text>
      )}

      {practices.map((practice) => {
        if (editingId === practice.id) {
          return (
            <PracticeForm
              key={practice.id}
              form={form}
              setForm={setForm}
              onSave={handleSave}
              onCancel={cancelEdit}
              isSaving={isSaving}
              isEditing
            />
          );
        }
        return (
          <View key={practice.id} style={[styles.card, practice.isArchived && styles.cardArchived]}>
            <View style={styles.cardInfo}>
              <View style={styles.cardNameRow}>
                <Text style={styles.cardName}>{practice.name}</Text>
                <PracticePill variant={practice.isShared ? 'shared' : 'only-you'} />
              </View>
              <Text style={styles.cardMeta}>
                {CATEGORIES.find((c) => c.key === practice.category)?.label ?? practice.category}
                {practice.durationMinutes ? ` · ${practice.durationMinutes} min` : ''}
                {practice.isArchived ? ' · archived' : ''}
              </Text>
            </View>
            {/* OD1 job 11b/11c — an archived row is no longer a dead
                end. It used to render NO actions at all (the whole block
                was gated behind !isArchived), so an archived practice
                could be neither restored nor edited from anywhere in the
                app.
                11c, DECIDED: Restore comes back, Edit does NOT. An
                archived practice is still live for the circles already
                on it (PB1), so editing one from a row that presents
                itself as inactive would silently change what those
                circles see — a surprising side effect from a screen
                showing the practice as put away. Restore is one tap and
                destroys nothing, so the honest order is restore first,
                then edit it like any other row. It also keeps the
                archived row to exactly one unambiguous action. */}
            <View style={styles.cardActions}>
              {practice.isArchived ? (
                <TouchableOpacity
                  style={styles.actionTap}
                  onPress={() => handleRestore(practice)}
                  hitSlop={8}
                >
                  <Text style={styles.actionText}>Restore</Text>
                </TouchableOpacity>
              ) : (
                <>
                  <TouchableOpacity
                    style={styles.actionTap}
                    onPress={() => startEdit(practice)}
                    hitSlop={8}
                  >
                    <Text style={styles.actionText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionTap}
                    onPress={() => handleArchive(practice)}
                    hitSlop={8}
                  >
                    <Text style={styles.actionTextMuted}>Archive</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>
        );
      })}

      {editingId === 'new' ? (
        <PracticeForm
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onCancel={cancelEdit}
          isSaving={isSaving}
        />
      ) : (
        <TouchableOpacity style={styles.createButton} onPress={startCreate}>
          <Text style={styles.createButtonText}>+ create a new practice</Text>
        </TouchableOpacity>
      )}

      <MessageDialog
        visible={!!error}
        title="hmm"
        variant="error"
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </KeyboardFriendlyScrollView>
  );
}

function PracticeForm({
  form,
  setForm,
  onSave,
  onCancel,
  isSaving,
  isEditing = false,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
  isEditing?: boolean;
}) {
  return (
    <View style={styles.formCard}>
      <MicTextInput
        style={styles.input}
        placeholder={STRINGS.practiceNamePlaceholder}
        placeholderTextColor={colors.muted}
        value={form.name}
        onChangeText={(name) => setForm({ ...form, name })}
        autoCorrect={false}
      />
      <PracticeTypePicker
        name={form.name}
        value={form.selection}
        onChange={(selection) => setForm({ ...form, selection })}
        initiallyPicked={isEditing}
      />
      <TextInput
        style={styles.input}
        placeholder={STRINGS.practiceDurationPlaceholder}
        placeholderTextColor={colors.muted}
        value={form.duration}
        onChangeText={(text) => setForm({ ...form, duration: text.replace(/[^0-9]/g, '') })}
        keyboardType="number-pad"
      />
      <View style={styles.formActions}>
        <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={isSaving}>
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveButton, (!form.name.trim() || !form.selection) && styles.buttonDisabled]}
          onPress={onSave}
          disabled={!form.name.trim() || !form.selection || isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveButtonText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
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
    marginBottom: 16,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 22,
    color: colors.ink,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 12.5,
    color: colors.muted,
    lineHeight: 18,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 10,
    ...cardShadow,
  },
  cardArchived: {
    opacity: 0.55,
  },
  cardInfo: {
    flex: 1,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.ink,
  },
  cardMeta: {
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  // OD1 job 11d — these were bare Text inside TouchableOpacity: a ~15px
  // tall target for a destructive-ish action. There is no shared
  // tappable-text component in this codebase, so this follows the house
  // idiom instead (minHeight on the touchable + hitSlop, as the Ask
  // Rally chips and the tab-bar icon pill already do).
  actionTap: {
    minHeight: 44,
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.green,
  },
  actionTextMuted: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.muted,
  },
  createButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  createButtonText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.green,
  },
  formCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    ...cardShadow,
  },
  input: {
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 13,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 10,
  },
  formActions: {
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
  saveButton: {
    flex: 1,
    backgroundColor: colors.green,
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontWeight: '700',
    fontSize: 12.5,
    color: '#fff',
  },
});
