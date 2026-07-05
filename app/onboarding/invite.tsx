import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Brandmark } from '@/components/Brandmark';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { cardShadow, colors } from '@/constants/theme';
import { getCircleById, listMyCircles, MyCircle } from '@/lib/circle';
import { useAuth } from '@/lib/auth-context';

export default function Invite() {
  const router = useRouter();
  const { session } = useAuth();
  const { circleId, fromToday } = useLocalSearchParams<{
    circleId?: string;
    fromToday?: string;
  }>();
  const isFromToday = fromToday === 'true';
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [circleName, setCircleName] = useState<string | null>(null);
  // Non-null only when there's no circleId param AND the user is in more
  // than one circle, so we can't just guess which one they meant.
  const [pickerCircles, setPickerCircles] = useState<MyCircle[] | null>(null);
  const [isLoadingCode, setIsLoadingCode] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  // Always refetches on focus (never trusts a cached name/code) — a
  // rename made elsewhere must show up here without a hard refresh.
  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoadingCode(true);
    try {
      if (circleId) {
        // circleId is present — refetch that exact circle, never a
        // "primary" stand-in (see CLAUDE.md).
        const circle = await getCircleById(circleId);
        setInviteCode(circle?.inviteCode ?? null);
        setCircleName(circle?.name ?? null);
        setPickerCircles(null);
        return;
      }
      // No circleId at all — resolve from the user's own circles instead
      // of guessing: one circle is unambiguous, more than one needs a pick.
      const myCircles = await listMyCircles(session.user.id);
      if (myCircles.length > 1) {
        setPickerCircles(myCircles);
      } else if (myCircles.length === 1) {
        setInviteCode(myCircles[0].inviteCode);
        setCircleName(myCircles[0].name);
      }
    } finally {
      setIsLoadingCode(false);
    }
  }, [circleId, session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handlePick = (circle: MyCircle) => {
    // Pin the choice into the URL so subsequent focuses (and the back
    // link) have a stable circleId instead of re-guessing every time.
    router.setParams({ circleId: circle.id });
  };

  const shareMessage = circleName
    ? `Join my "${circleName}" circle on Rally21! Sign in at https://rally21.vercel.app and enter code ${inviteCode} to hop in.`
    : `Join my Rally21 circle! Sign in at https://rally21.vercel.app and enter code ${inviteCode} to hop in.`;

  const handleShare = async () => {
    if (!inviteCode) return;

    if (Platform.OS === 'web') {
      // navigator.share is unreliable across browsers here, and awaiting it
      // before falling back to a clipboard write loses the user-gesture
      // context Safari/Chrome require to allow that write — copy directly.
      await Clipboard.setStringAsync(shareMessage);
      setNotice('copied — paste it to your people');
      return;
    }

    try {
      await Share.share({ message: shareMessage });
    } catch {
      await Clipboard.setStringAsync(shareMessage);
      setNotice('copied — paste it to your people');
    }
  };

  const handleCopyCode = async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode);
    setNotice('code copied');
  };

  if (isLoadingCode) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.green} />
      </View>
    );
  }

  if (pickerCircles) {
    return (
      <View style={styles.container}>
        <Brandmark style={styles.brandmark} />
        <Text style={styles.title}>invite to which circle?</Text>
        <Text style={styles.subtitle}>you're in a few — pick the one to invite someone into</Text>
        <View style={styles.pickerList}>
          {pickerCircles.map((circle) => (
            <TouchableOpacity
              key={circle.id}
              style={styles.pickerRow}
              onPress={() => handlePick(circle)}
            >
              <Text style={styles.pickerRowText}>{circle.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Brandmark style={styles.brandmark} />
      <TouchableOpacity
        style={styles.back}
        onPress={() =>
          isFromToday
            ? router.push('/today')
            : router.push({ pathname: '/circle', params: { circleId } })
        }
      >
        <Text style={styles.backText}>{isFromToday ? '← Today' : '← Your Circle'}</Text>
      </TouchableOpacity>

      <Text style={styles.title}>invite your people</Text>
      <Text style={styles.subtitle}>
        {circleName ? `share this code to join ${circleName}` : 'share this code — anyone can use it to hop in'}
      </Text>

      <View style={styles.codeCard}>
        <Text style={styles.code}>{inviteCode ?? '——————'}</Text>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleShare} disabled={!inviteCode}>
        <Text style={styles.buttonText}>Share invite</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.copyCodeButton}
        onPress={handleCopyCode}
        disabled={!inviteCode}
      >
        <Text style={styles.copyCodeText}>Copy code only</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.secondaryButton} onPress={() => router.replace('/')}>
        <Text style={styles.secondaryButtonText}>Continue to my circle</Text>
      </TouchableOpacity>

      <MessageDialog
        visible={!!notice}
        title="done"
        message={notice ?? ''}
        onDismiss={() => setNotice(null)}
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
  brandmark: {
    position: 'absolute',
    top: 20,
    left: 24,
  },
  pickerList: {
    width: '100%',
  },
  pickerRow: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
    ...cardShadow,
  },
  pickerRowText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  back: {
    position: 'absolute',
    top: 52,
    left: 24,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.muted,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 24,
    color: colors.ink,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
    marginBottom: 26,
    textAlign: 'center',
  },
  codeCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 20,
    paddingVertical: 28,
    alignItems: 'center',
    marginBottom: 26,
    borderWidth: 1.5,
    borderColor: colors.green,
    ...cardShadow,
  },
  code: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 6,
    color: colors.ink,
  },
  button: {
    width: '100%',
    backgroundColor: colors.gold,
    borderRadius: 16,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    fontWeight: '700',
    fontSize: 14,
    color: colors.ink,
  },
  copyCodeButton: {
    width: '100%',
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: 14,
  },
  copyCodeText: {
    fontWeight: '700',
    fontSize: 12.5,
    color: colors.ink,
  },
  secondaryButton: {
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontWeight: '600',
    fontSize: 13,
    color: colors.muted,
  },
});
