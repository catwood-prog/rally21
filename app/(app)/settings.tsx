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

import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { deleteMyAccount } from '@/lib/account';
import { useAuth } from '@/lib/auth-context';
import { getMyProfile, saveProfile } from '@/lib/profile';

export default function Settings() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoading(true);
    try {
      const profile = await getMyProfile(session.user.id);
      setName(profile?.name ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load your profile');
    } finally {
      setIsLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSaveName = async () => {
    if (!session?.user || !name.trim()) return;
    setIsSaving(true);
    try {
      await saveProfile(session.user.id, { name, avatarUri: null });
      setSavedNotice(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save that — try again');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteMyAccount();
      await signOut();
      router.replace('/sign-in');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete your account — try again');
      setIsDeleting(false);
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
      <TouchableOpacity onPress={() => router.push('/(app)/today')}>
        <Text style={styles.back}>← Today</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Settings</Text>

      <Text style={styles.label}>your name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
      />
      <TouchableOpacity
        style={[styles.saveButton, !name.trim() && styles.buttonDisabled]}
        onPress={handleSaveName}
        disabled={!name.trim() || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator size="small" color={colors.ink} />
        ) : (
          <Text style={styles.saveButtonText}>Save</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.label, styles.sectionSpacing]}>reminders</Text>
      <View style={styles.noteCard}>
        <Text style={styles.noteText}>
          Rally21 doesn&apos;t send push notifications yet on the web. For now, a nudge in your
          circle wall (or your own memory!) is today&apos;s reminder — real notifications are
          coming when we go native.
        </Text>
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>

      <Text style={[styles.label, styles.sectionSpacing]}>danger zone</Text>
      {!confirmingDelete ? (
        <TouchableOpacity style={styles.deleteButton} onPress={() => setConfirmingDelete(true)}>
          <Text style={styles.deleteButtonText}>Delete my account</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.confirmCard}>
          <Text style={styles.confirmText}>
            This deletes your profile, check-ins, and reflections for good — it can&apos;t be
            undone. Circles you started stay with your circle-mates.
          </Text>
          <View style={styles.confirmRow}>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setConfirmingDelete(false)}
              disabled={isDeleting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.confirmDeleteButton}
              onPress={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmDeleteText}>Delete forever</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      <MessageDialog
        visible={savedNotice}
        title="saved"
        message="your name has been updated"
        onDismiss={() => setSavedNotice(false)}
      />
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
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
    marginBottom: 20,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.green,
    marginBottom: 8,
  },
  sectionSpacing: {
    marginTop: 28,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 14,
    color: colors.ink,
    marginBottom: 10,
  },
  saveButton: {
    backgroundColor: colors.gold,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  saveButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  noteCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
  },
  noteText: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  signOutButton: {
    marginTop: 28,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: {
    fontWeight: '700',
    fontSize: 13,
    color: colors.ink,
  },
  deleteButton: {
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: '#B3261E',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  deleteButtonText: {
    fontWeight: '700',
    fontSize: 13,
    color: '#B3261E',
  },
  confirmCard: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: '#B3261E',
  },
  confirmText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 18,
    marginBottom: 14,
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
    backgroundColor: '#B3261E',
    borderRadius: 12,
    paddingVertical: 11,
    alignItems: 'center',
  },
  confirmDeleteText: {
    fontWeight: '700',
    fontSize: 12.5,
    color: '#fff',
  },
});
