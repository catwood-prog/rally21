import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FLOATING_TAB_BAR } from '@/constants/theme';

/**
 * TB3 (22 July): bottom padding that actually clears the floating pill,
 * on every device. The pill is lifted by the bottom safe-area inset
 * (tabs/_layout: marginBottom = insets.bottom + BOTTOM_GAP), so its TOP
 * edge sits insets.bottom + BOTTOM_GAP + HEIGHT above the screen bottom
 * — ~102px on a home-indicator iPhone, 68px on web. TB1's fixed
 * clearance constants were only ever verified against web's 0 inset:
 * on device they left 26px of breathing instead of web's 60
 * (CLEARANCE), and put the Rally composer partly BEHIND the pill
 * (COMPOSER_CLEARANCE 80 < 102). Adding insets.bottom restores the
 * web-verified geometry everywhere; on web insets resolve to 0, so web
 * is unchanged by construction.
 */
export function useTabBarClearance(base: number = FLOATING_TAB_BAR.CLEARANCE): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + base;
}
