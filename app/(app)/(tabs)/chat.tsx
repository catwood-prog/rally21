import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { Brandmark } from '@/components/Brandmark';
import { FONT_HEADER } from '@/constants/fonts';
import { STRINGS } from '@/constants/strings';
import { colors } from '@/constants/theme';
import { sendMessage } from '@/lib/chat';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

let messageSeq = 0;
function nextId(): string {
  messageSeq += 1;
  return `m${messageSeq}`;
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { id: nextId(), role: 'user', text }]);
    setDraft('');
    setIsSending(true);
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));

    try {
      const reply = await sendMessage(text);
      setMessages((prev) => [...prev, { id: nextId(), role: 'assistant', text: reply }]);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Brandmark style={styles.brandmark} />
        <Text style={styles.title}>{STRINGS.chatTabLabel}</Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.feed}
        contentContainerStyle={styles.feedContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Image
              source={MASCOT.waving}
              style={styles.emptyImage}
              resizeMode="contain"
              accessible={false}
              alt=""
            />
            <Text style={styles.emptyText}>{STRINGS.chatEmptyIntro}</Text>
          </View>
        ) : (
          messages.map((m) => (
            <View
              key={m.id}
              style={[styles.messageRow, m.role === 'user' && styles.messageRowMe]}
            >
              <View style={[styles.bubble, m.role === 'user' ? styles.bubbleMe : styles.bubbleOther]}>
                <Text style={[styles.bubbleText, m.role === 'user' && styles.bubbleTextMe]}>
                  {m.text}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
          style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!draft.trim() || isSending}
        >
          {isSending ? (
            <ActivityIndicator size="small" color={colors.ink} />
          ) : (
            <Text style={styles.sendIcon}>➤</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.cream,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  brandmark: {
    marginBottom: 10,
  },
  title: {
    fontFamily: FONT_HEADER,
    fontSize: 20,
    color: colors.ink,
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    padding: 16,
    paddingBottom: 24,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  emptyImage: {
    width: 80,
    height: 94,
    marginBottom: 14,
  },
  emptyText: {
    fontSize: 13.5,
    color: colors.muted,
    textAlign: 'center',
    lineHeight: 19,
  },
  messageRow: {
    marginBottom: 12,
    maxWidth: '78%',
  },
  messageRowMe: {
    alignSelf: 'flex-end',
  },
  bubble: {
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  bubbleOther: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 4,
  },
  bubbleMe: {
    backgroundColor: colors.green,
    borderTopRightRadius: 4,
  },
  bubbleText: {
    fontSize: 12.5,
    color: colors.ink,
    lineHeight: 17,
  },
  bubbleTextMe: {
    color: '#fff',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 15,
    fontSize: 13,
    color: colors.ink,
    maxHeight: 100,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendIcon: {
    fontSize: 15,
    color: colors.ink,
  },
});
