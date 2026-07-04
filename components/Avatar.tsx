import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/constants/theme';

type AvatarProps = {
  name: string | null;
  avatarUrl?: string | null;
  size?: number;
  /** Mirrors the "checked in today" ring used on Today/Circle member rows;
   * has no meaning outside that context. */
  ring?: 'done' | 'pending' | 'none';
};

export function Avatar({ name, avatarUrl, size = 40, ring = 'none' }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle = ring === 'done' ? styles.ringDone : ring === 'pending' ? styles.ringPending : styles.ringNone;

  return (
    <View style={[styles.base, dimension, ringStyle]}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={[styles.image, dimension]} />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.36 }]}>
          {(name ?? '?').charAt(0).toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  ringDone: {
    backgroundColor: '#ddd',
  },
  ringPending: {
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.line,
    borderStyle: 'dashed',
  },
  ringNone: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  image: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  initial: {
    fontWeight: '700',
    color: colors.muted,
  },
});
