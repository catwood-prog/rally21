import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleProp, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors } from '@/constants/theme';

// The Web Speech API is non-standard (vendor-prefixed on WebKit) and has
// no entry in TS's DOM lib — these are the only two constructors that
// matter across the browsers this app targets, typed loosely rather than
// pulling in a speculative @types package for a handful of fields.
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/** Appends a dictated transcript to existing text with a single space
 * seam — never replaces what's already typed (the convention's append
 * rule). KB1 promoted this here as the shared copy; the per-screen
 * duplicates in checkin/AskRallyScreen/private-map predate it (CH5
 * candidate to migrate them). */
export function appendTranscript(existing: string, transcript: string): string {
  if (!existing || /\s$/.test(existing)) return existing + transcript;
  return `${existing} ${transcript}`;
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A small mic button meant to sit inside a text field — tap to dictate
 * via the Web Speech API, transcribed text is appended (never replaces)
 * to whatever the field already holds. No audio is ever recorded or
 * stored; only the browser's own transcription text is received. Renders
 * nothing if the API isn't available (native platforms, older browsers)
 * or once the mic permission has been denied for this session. */
export function VoiceMicButton({
  onTranscript,
  onPermissionDenied,
  style,
}: {
  onTranscript: (text: string) => void;
  onPermissionDenied: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [isSupported] = useState(() => getSpeechRecognitionCtor() !== null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!isListening) {
      cancelAnimation(scale);
      scale.value = withTiming(1, { duration: 150 });
      return;
    }
    scale.value = withRepeat(withTiming(1.25, { duration: 550 }), -1, true);
    return () => cancelAnimation(scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening]);

  useEffect(() => {
    // Stop listening (rather than leave a dangling recognizer) if the
    // field this button lives in unmounts mid-dictation.
    return () => recognitionRef.current?.stop();
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  if (!isSupported) return null;

  const handlePress = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    // Desktop Chrome keeps listening across pauses until stopped
    // (matches "tap again to stop"); iOS Safari auto-stops after a short
    // utterance regardless of this flag — onend below handles that by
    // just reverting to idle, so tapping again continues naturally.
    recognition.continuous = true;
    recognition.interimResults = false;
    // No `lang` set — inherits the browser/device language.

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) onTranscript(transcript.trim());
    };

    recognition.onerror = (event) => {
      if (
        event.error === 'not-allowed' ||
        event.error === 'permission-denied' ||
        event.error === 'service-not-allowed'
      ) {
        onPermissionDenied();
      }
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    setIsListening(true);
    recognition.start();
  };

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={handlePress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={isListening ? 'Stop dictating' : 'Dictate with your voice'}
    >
      <Animated.View style={animatedStyle}>
        <Ionicons
          name="mic"
          size={32}
          color={isListening ? colors.green : colors.muted}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 4,
  },
});
