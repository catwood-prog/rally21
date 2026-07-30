/**
 * AL1 job 4 — the reminders ask actually RENDERS differently on web.
 *
 * The greps prove the alarm row sits inside a `Platform.OS !== 'web'`
 * block; this proves the block does what the grep says it does, by
 * rendering the real component on both platforms and looking at the tree.
 * Bundle greps cannot settle this on their own: the copy lives in
 * constants/strings.ts and is therefore present in the web bundle whether
 * or not anything ever renders it, so presence in the artifact says
 * nothing either way. A render assertion does.
 *
 * Platform.OS is flipped per-case rather than mocked at module scope
 * (the lib/alarmReminder web/native test pair does it that way because
 * those files never render) — here both branches of ONE component are
 * under test, so they have to share an environment.
 */
import React from 'react';
import { Platform, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';

import { RemindersAskCard } from './RemindersAskCard';

const REAL_OS = Platform.OS;

function setPlatform(os: string) {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => setPlatform(REAL_OS));

function renderCard(variant: 'full' | 'compact') {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <RemindersAskCard variant={variant} onTurnOn={() => {}} onMaybeLater={() => {}} />
    );
  });
  const texts = tree.root.findAllByType(Text).flatMap((n) =>
    (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(
      (c: unknown) => typeof c === 'string'
    )
  );
  act(() => tree.unmount());
  return texts as string[];
}

describe.each(['full', 'compact'] as const)('the reminders ask — %s variant', (variant) => {
  it('offers the personal practice time on native', () => {
    setPlatform('ios');
    expect(renderCard(variant)).toContain(STRINGS.remindersAskAlarmRowLabel);
  });

  it('renders NOTHING about it on web — not disabled, not explained, absent', () => {
    setPlatform('web');
    const texts = renderCard(variant);
    expect(texts).not.toContain(STRINGS.remindersAskAlarmRowLabel);
    // And nothing from the picker leaks through either.
    expect(texts).not.toContain(STRINGS.alarmTimeMorningLabel);
    expect(texts).not.toContain(STRINGS.alarmTimeAfternoonLabel);
    expect(texts).not.toContain(STRINGS.alarmTimeMinuteLabel);
  });

  it('keeps the RM1 ask itself identical on both platforms', () => {
    setPlatform('web');
    const web = renderCard(variant);
    setPlatform('ios');
    const native = renderCard(variant);
    for (const line of [STRINGS.remindersAskBody, STRINGS.remindersAskCta, STRINGS.remindersAskMaybeLater]) {
      expect(web).toContain(line);
      expect(native).toContain(line);
    }
  });
});

describe('what the CTA reports back', () => {
  it('says the reminder is off unless the person turned the row on', () => {
    setPlatform('ios');
    const onTurnOn = jest.fn();
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <RemindersAskCard variant="full" onTurnOn={onTurnOn} onMaybeLater={() => {}} />
      );
    });
    // Find the CTA's own label, then walk up to whatever is listening for
    // the tap — more robust than guessing at the wrapper's shape.
    let node = tree.root
      .findAllByType(Text)
      .find((n) => n.props.children === STRINGS.remindersAskCta)!;
    while (!node.props.onPress) node = node.parent!;
    act(() => node.props.onPress());
    act(() => tree.unmount());

    // Opt-in inside an opt-in: "turn on reminders" alone never sets a
    // personal practice time.
    expect(onTurnOn).toHaveBeenCalledWith({ enabled: false, time: null });
  });
});
