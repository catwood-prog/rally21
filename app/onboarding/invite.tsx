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

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { InviteChannelChooser } from '@/components/InviteChannelChooser';
import { MascotEntrance } from '@/components/MascotEntrance';
import { MessageDialog } from '@/components/MessageDialog';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { cardShadow, colors } from '@/constants/theme';
import { MyCircle, resolveCircleSelection } from '@/lib/circle';
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
  const [chooserVisible, setChooserVisible] = useState(false);

  // Always refetches on focus (never trusts a cached name/code) — a
  // rename made elsewhere must show up here without a hard refresh.
  const load = useCallback(async () => {
    if (!session?.user) return;
    setIsLoadingCode(true);
    try {
      const selection = await resolveCircleSelection(circleId, session.user.id);
      if (selection.kind === 'picker') {
        setPickerCircles(selection.circles);
        return;
      }
      setInviteCode(selection.circle?.inviteCode ?? null);
      setCircleName(selection.circle?.name ?? null);
      setPickerCircles(null);
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

  const shareMessage = STRINGS.inviteShareMessage(circleName, inviteCode ?? '');

  const copyMessage = async () => {
    await Clipboard.setStringAsync(shareMessage);
    setNotice(STRINGS.inviteCopiedNotice);
  };

  // IN1 (15 July) — Share invite opens a how-to-send chooser instead of
  // silently copying: the system share sheet wherever one exists (native;
  // iOS Safari via navigator.share), the in-app channel chooser everywhere
  // else. A cancelled sheet is silent — the person just changed their mind.
  const handleShare = () => {
    if (!inviteCode) return;

    if (Platform.OS === 'web') {
      const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof nav.share === 'function') {
        // Called synchronously inside the tap gesture (Safari requires
        // it); AbortError means cancelled, anything else falls back to
        // the in-app chooser rather than surfacing an error.
        nav.share({ text: shareMessage }).catch((err: unknown) => {
          if ((err as Error | null)?.name === 'AbortError') return;
          setChooserVisible(true);
        });
        return;
      }
      setChooserVisible(true);
      return;
    }

    // Native: the system sheet (cancelling resolves, never throws); only a
    // genuine failure to present it falls back to the in-app chooser.
    Share.share({ message: shareMessage }).catch(() => setChooserVisible(true));
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
        <AppHeader style={styles.header} />
        {/* NAV1: the picker state had no way back at all — no circleId
            param means "which circle?" is ambiguous, so Today is the
            one safe parent. */}
        <TouchableOpacity style={styles.back} onPress={() => router.push('/today')}>
          <Text style={styles.backText}>← Today</Text>
        </TouchableOpacity>
        <View style={styles.body}>
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AppHeader style={styles.header} />
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

      <View style={styles.body}>
      <MascotEntrance source={MASCOT.invitationHuddle} style={styles.mascot} />
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
      </View>

      <InviteChannelChooser
        visible={chooserVisible}
        message={shareMessage}
        mailSubject={STRINGS.inviteMailSubject(circleName)}
        onCopy={copyMessage}
        onDismiss={() => setChooserVisible(false)}
      />

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
  },
  // NAV1: header + back sit in flow at the top (AppHeader owns the
  // safe-area inset); the old centered layout moves into `body`.
  header: {
    paddingHorizontal: 24,
    paddingTop: 12,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  mascot: {
    width: 150,
    height: 109,
    marginBottom: 14,
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
    paddingHorizontal: 24,
    paddingVertical: 4,
    alignSelf: 'flex-start',
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
