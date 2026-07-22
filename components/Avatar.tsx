import { Image, StyleSheet, View } from 'react-native';

import { AVATAR_PENGUINS } from '@/assets/avatars';
import { colors } from '@/constants/theme';
import { avatarVariantForUserId } from '@/lib/avatar';

type AvatarProps = {
  /** Kept for a11y/labels at call sites; no longer rendered — AV1
   * (Cat's ruling): the penguin replaced the initials fallback
   * entirely, no initial badge. */
  name: string | null;
  /** Drives the deterministic penguin pick for photo-less members —
   * hash(user id) → variant, same person = same penguin everywhere,
   * every day, on every viewer's device (lib/avatar.ts). */
  userId: string;
  avatarUrl?: string | null;
  size?: number;
  /** Mirrors the "checked in today" ring used on Today/Circle member rows;
   * has no meaning outside that context. 'covered' is a member whose day
   * was covered by someone else (see CLAUDE.md's cover-a-friend rule) —
   * visually distinct from 'done', never just reused as a quiet done. */
  ring?: 'done' | 'covered' | 'pending' | 'none';
};

export function Avatar({ name: _name, userId, avatarUrl, size = 40, ring = 'none' }: AvatarProps) {
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const ringStyle =
    ring === 'done'
      ? styles.ringDone
      : ring === 'covered'
        ? styles.ringCovered
        : ring === 'pending'
          ? styles.ringPending
          : styles.ringNone;

  return (
    <View style={[styles.base, dimension, ringStyle]}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={[styles.image, dimension]} />
      ) : (
        <Image
          source={AVATAR_PENGUINS[avatarVariantForUserId(userId) - 1]}
          style={[styles.image, dimension]}
          resizeMode="cover"
        />
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
    backgroundColor: colors.placeholderGrey,
  },
  ringCovered: {
    backgroundColor: 'rgba(244, 200, 75, 0.25)',
    borderWidth: 2,
    borderColor: colors.gold,
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
});
