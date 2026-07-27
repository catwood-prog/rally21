import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MASCOT } from '@/assets/mascot';
import { AppHeader } from '@/components/AppHeader';
import { BackLink } from '@/components/BackLink';
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
  const insets = useSafeAreaInsets();
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
      // OD1 job 17a — the picker grows a row per circle, so it needs the
      // same scroll the main state does.
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom }]}
      >
        <AppHeader style={styles.header} />
        {/* NAV1: the picker state had no way back at all — no circleId
            param means "which circle?" is ambiguous, so Today is the
            one safe parent. */}
        <BackLink label="today" onPress={() => router.push('/today')} style={styles.back} />
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
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      {/* OD1 job 17a — this screen was the audit's worst case: a
          non-scrolling centred View carrying a FIXED 255x185 mascot
          (Cat's 20 July ruling made the huddle 70% bigger), so Dynamic
          Type had to fit the code card and all three buttons into
          whatever vertical space the huddle left. The dialogs stay
          OUTSIDE the scroll — they overlay the screen, not the content. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom }]}
      >
        <AppHeader style={styles.header} />
        <BackLink
          label={isFromToday ? 'today' : 'your circle'}
          onPress={() =>
            isFromToday
              ? router.push('/today')
              : router.push(circleId ? { pathname: '/circle', params: { circleId } } : '/circle')
          }
          style={styles.back}
        />

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
        <Text style={styles.buttonText}>{STRINGS.inviteShareCta}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.copyCodeButton}
        onPress={handleCopyCode}
        disabled={!inviteCode}
      >
        <Text style={styles.copyCodeText}>{STRINGS.inviteCopyCodeCta}</Text>
      </TouchableOpacity>

      {/* OD1 job 15 — this used to be router.replace('/'), which made the
          label false (index redirects to /today) AND replayed WO1's warm
          open mid-session, since index.tsx gates it on component-local
          `warmOpenDone` that a fresh mount resets. WO1 scoped that moment
          to once per real launch. `replace`, not push: nobody should land
          back on the invite screen by going back after finishing with it.
          The circleId guard is circle.tsx's documented trap: a solo user
          reaches this screen with NO circleId param (resolveCircleSelection
          found their sole circle), and handing expo-router an undefined
          param can serialise to the literal string "undefined", which
          resolveCircleSelection then treats as an explicit, not-found id.
          The clean route resolves the sole circle by itself. */}
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() =>
          router.replace(circleId ? { pathname: '/circle', params: { circleId } } : '/circle')
        }
      >
        <Text style={styles.secondaryButtonText}>{STRINGS.inviteContinueCta}</Text>
      </TouchableOpacity>
        </View>
      </ScrollView>

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
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  // NAV1: header + back sit in flow at the top (AppHeader owns the
  // safe-area inset); the old centered layout moves into `body`.
  // OD1 job 3: the paddingTop: 12 that used to sit here was silently
  // REPLACING that inset (the caller's style won the array), which put
  // the wordmark under the iOS clock. AppHeader now owns the inset on a
  // wrapper this style can't reach, and this screen takes the same plain
  // inset every other AppHeader screen gets.
  header: {
    paddingHorizontal: 24,
  },
  body: {
    // OD1 job 17a — flexGrow, not flex: 1: flexBasis: 0 would cap this at
    // one viewport and leave the new ScrollView nothing to scroll.
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  mascot: {
    // Build-9 review (20 July): Cat's ruling — the huddle 70% bigger.
    width: 255,
    height: 185,
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
