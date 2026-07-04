import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
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
import { MessageDialog } from '@/components/MessageDialog';
import { CATEGORIES } from '@/constants/practices';
import { FONT_HEADER } from '@/constants/fonts';
import { cardShadow, chipShape, chipTextShape, colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import {
  archivePractice,
  createPractice,
  listMyPractices,
  Practice,
  PracticeCategory,
  updatePractice,
} from '@/lib/circles';

type FormState = { name: string; category: PracticeCategory; duration: string };

const BLANK_FORM: FormState = { name: '', category: 'move', duration: '' };

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
      category: practice.category,
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
    if (!session?.user || !form.name.trim()) return;
    setIsSaving(true);
    try {
      const durationMinutes = form.duration.trim() ? parseInt(form.duration.trim(), 10) : null;
      const cleanDuration = durationMinutes && durationMinutes > 0 ? durationMinutes : null;

      if (editingId === 'new') {
        await createPractice({
          name: form.name,
          category: form.category,
          durationMinutes: cleanDuration,
          createdBy: session.user.id,
        });
      } else if (editingId) {
        await updatePractice(editingId, {
          name: form.name,
          category: form.category,
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

  const handleArchive = async (practice: Practice) => {
    try {
      await archivePractice(practice.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not archive that — try again');
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
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity onPress={() => router.push('/settings')}>
        <Text style={styles.back}>← Settings</Text>
      </TouchableOpacity>

      <Text style={styles.title}>My practices</Text>
      <Text style={styles.subtitle}>practices you&apos;ve created — anyone can pick one for their circle</Text>

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
            />
          );
        }
        return (
          <View key={practice.id} style={[styles.card, practice.isArchived && styles.cardArchived]}>
            <View style={styles.cardInfo}>
              <Text style={styles.cardName}>{practice.name}</Text>
              <Text style={styles.cardMeta}>
                {CATEGORIES.find((c) => c.key === practice.category)?.label ?? practice.category}
                {practice.durationMinutes ? ` · ${practice.durationMinutes} min` : ''}
                {practice.isArchived ? ' · archived' : ''}
              </Text>
            </View>
            {!practice.isArchived && (
              <View style={styles.cardActions}>
                <TouchableOpacity onPress={() => startEdit(practice)}>
                  <Text style={styles.actionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleArchive(practice)}>
                  <Text style={styles.actionTextMuted}>Archive</Text>
                </TouchableOpacity>
              </View>
            )}
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
        message={error ?? ''}
        onDismiss={() => setError(null)}
      />
    </ScrollView>
  );
}

function PracticeForm({
  form,
  setForm,
  onSave,
  onCancel,
  isSaving,
}: {
  form: FormState;
  setForm: (f: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  return (
    <View style={styles.formCard}>
      <TextInput
        style={styles.input}
        placeholder="e.g. Walk 20 minutes"
        placeholderTextColor={colors.muted}
        value={form.name}
        onChangeText={(name) => setForm({ ...form, name })}
        autoCorrect={false}
      />
      <View style={styles.chipRow}>
        {CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.key}
            style={[styles.chip, form.category === category.key && styles.chipSelected]}
            onPress={() => setForm({ ...form, category: category.key })}
          >
            <Text style={[styles.chipText, form.category === category.key && styles.chipTextSelected]}>
              {category.emoji} {category.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="duration in minutes (optional)"
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
          style={[styles.saveButton, !form.name.trim() && styles.buttonDisabled]}
          onPress={onSave}
          disabled={!form.name.trim() || isSaving}
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
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
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
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  chip: {
    ...chipShape,
    backgroundColor: colors.bg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  chipSelected: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  chipText: {
    ...chipTextShape,
    color: colors.ink,
  },
  chipTextSelected: {
    color: '#fff',
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
