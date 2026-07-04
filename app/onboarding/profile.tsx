import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { saveProfile } from '@/lib/profile';

export default function ProfileSetup() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarWarning, setAvatarWarning] = useState<string | null>(null);

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleContinue = async () => {
    if (!session?.user || !name.trim()) return;
    setIsSaving(true);
    setError('');
    try {
      const { avatarWarning: warning } = await saveProfile(session.user.id, {
        name,
        avatarUri: photoUri,
      });
      if (warning) {
        setAvatarWarning(warning);
      } else {
        router.replace('/onboarding/circle-setup');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'something went wrong — try again');
    } finally {
      setIsSaving(false);
    }
  };

  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.back} onPress={signOut}>
        <Text style={styles.backText}>← Sign out</Text>
      </TouchableOpacity>

      <Text style={styles.title}>your profile</Text>

      <TouchableOpacity style={styles.photoWrap} onPress={pickPhoto}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoInitial}>{initial || '?'}</Text>
          </View>
        )}
        <View style={styles.photoBadge}>
          <Text style={styles.photoBadgeText}>+</Text>
        </View>
      </TouchableOpacity>
      <Text style={styles.hint}>add a photo so your circle knows it&apos;s you</Text>

      <TextInput
        style={styles.input}
        placeholder="your name"
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        autoCorrect={false}
        onSubmitEditing={handleContinue}
      />

      {!!error && <Text style={styles.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[styles.button, !name.trim() && styles.buttonDisabled]}
        onPress={handleContinue}
        disabled={!name.trim() || isSaving}
      >
        {isSaving ? (
          <ActivityIndicator color={colors.ink} />
        ) : (
          <Text style={styles.buttonText}>Continue</Text>
        )}
      </TouchableOpacity>

      <MessageDialog
        visible={!!avatarWarning}
        title="almost there"
        message={avatarWarning ?? ''}
        onDismiss={() => {
          setAvatarWarning(null);
          router.replace('/onboarding/circle-setup');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  back: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 20,
  },
  photoWrap: {
    width: 104,
    height: 104,
    marginBottom: 10,
  },
  photo: {
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  photoPlaceholder: {
    backgroundColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.muted,
  },
  photoBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gold,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoBadgeText: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.ink,
    lineHeight: 18,
  },
  hint: {
    fontSize: 12.5,
    color: colors.muted,
    marginBottom: 22,
    textAlign: 'center',
  },
  input: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 14,
    fontSize: 15,
    color: colors.ink,
    marginBottom: 12,
  },
  errorText: {
    color: '#B3261E',
    fontSize: 12.5,
    marginBottom: 8,
  },
  button: {
    width: '100%',
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
});
