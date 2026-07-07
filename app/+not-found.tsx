import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { MASCOT } from '@/assets/mascot';
import { MascotEntrance } from '@/components/MascotEntrance';
import { colors } from '@/constants/theme';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Oops!' }} />
      <View style={styles.container}>
        <MascotEntrance source={MASCOT.apologeticSlip} style={styles.mascot} />
        <Text style={styles.title}>This screen doesn&apos;t exist.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go back home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: colors.bg,
  },
  mascot: {
    width: 150,
    height: 88,
    marginBottom: 18,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    color: colors.green,
    fontWeight: '600',
  },
});
