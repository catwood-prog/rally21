import React from 'react';
import { Text } from 'react-native';
import { act, create } from 'react-test-renderer';

import { getLocalDateString } from '@/lib/date';
import { markTodayOneShotPlayed } from '@/lib/todayOneShot';

import { BirthdayBanner } from './BirthdayBanner';
import { ConfettiBurst } from './ConfettiBurst';

/**
 * BD2 (8 July): structural verification of the "once per local date"
 * gate (VERIFY item 4) — not the animation timing itself, which
 * react-test-renderer can't meaningfully assert (reanimated's shared
 * values don't execute real timelines under jest). What IS provable
 * here, and matters most for correctness: whether the confetti burst
 * (the clearest observable proxy for "did the full sequence fire")
 * renders on a fresh date and is suppressed once that date is already
 * marked played — exactly the bug class a stale-closure or off-by-one
 * date bug would produce.
 */
describe('BirthdayBanner — once-per-local-date gating', () => {
  it('renders the confetti burst on a date that has not played yet', () => {
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(React.createElement(BirthdayBanner, { name: 'Cat' }));
    });
    const confetti = renderer!.root.findAllByType(ConfettiBurst);
    expect(confetti).toHaveLength(1);
    act(() => {
      renderer!.unmount();
    });
  });

  it('does not render the confetti burst once today has already been marked played', () => {
    const today = getLocalDateString();
    markTodayOneShotPlayed('birthday', today);

    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(React.createElement(BirthdayBanner, { name: 'Cat' }));
    });
    const confetti = renderer!.root.findAllByType(ConfettiBurst);
    expect(confetti).toHaveLength(0);
    act(() => {
      renderer!.unmount();
    });
  });

  it('still renders the mascot image and the birthday line on a static (already-played) render — the banner itself never disappears, only the one-shot flourish', () => {
    const today = getLocalDateString();
    markTodayOneShotPlayed('birthday', today);

    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(React.createElement(BirthdayBanner, { name: 'Cat' }));
    });
    const textNodes = renderer!.root.findAllByType(Text).flatMap((node) => node.props.children);
    expect(textNodes.some((child) => typeof child === 'string' && child.includes('Cat'))).toBe(true);
    act(() => {
      renderer!.unmount();
    });
  });
});
