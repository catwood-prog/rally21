import { useState } from 'react';
import { StyleProp, StyleSheet, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

import { appendTranscript, VoiceMicButton } from '@/components/VoiceMicButton';

/**
 * KB1 (22 July) — the "every free-text input carries the mic" convention
 * as a drop-in: a TextInput in a row with the dictation mic. On web the
 * mic is the Web Speech affordance; on native VoiceMicButton renders
 * null and the system keyboard's own dictation key is the path, so this
 * renders as a plain full-width input there. Dictated text APPENDS via
 * appendTranscript, never replaces. The mic disappears for the session
 * once permission is denied (VoiceMicButton's own rule).
 *
 * Pass the screen's own input style through `style` (it keeps its look
 * and gains flex:1 in the row); `containerStyle` styles the row itself
 * (e.g. to carry a marginBottom the input used to own).
 */
export function MicTextInput({
  value,
  onChangeText,
  containerStyle,
  style,
  ...inputProps
}: TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [micDenied, setMicDenied] = useState(false);
  return (
    <View style={[styles.row, containerStyle]}>
      <TextInput style={[style, styles.input]} value={value} onChangeText={onChangeText} {...inputProps} />
      {!micDenied && (
        <VoiceMicButton
          style={styles.mic}
          onTranscript={(text) => onChangeText(appendTranscript(value, text))}
          onPermissionDenied={() => setMicDenied(true)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  input: {
    flex: 1,
  },
  mic: {
    flexShrink: 0,
  },
});
