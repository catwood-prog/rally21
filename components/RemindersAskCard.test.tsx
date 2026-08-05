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
      <RemindersAskCard
        variant={variant}
        onTurnOn={async () => true}
        onMaybeLater={() => {}}
      />
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

/** Tap "turn on reminders" on a freshly-rendered card and return the tree
 * so the caller can look at what replaced it. `onTurnOn` decides whether
 * the writes "landed". */
async function tapTurnOn(onTurnOn: (alarm: unknown) => Promise<boolean>) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <RemindersAskCard variant="compact" onTurnOn={onTurnOn} onMaybeLater={() => {}} />
    );
  });
  // Find the CTA's own label, then walk up to whatever is listening for
  // the tap — more robust than guessing at the wrapper's shape.
  let node = tree.root
    .findAllByType(Text)
    .find((n) => n.props.children === STRINGS.remindersAskCta)!;
  while (!node.props.onPress) node = node.parent!;
  await act(async () => node.props.onPress());
  return tree;
}

function textsOf(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).flatMap((n) =>
    (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(
      (c: unknown) => typeof c === 'string'
    )
  ) as string[];
}

describe('what the CTA reports back', () => {
  it('says the reminder is off unless the person turned the row on', async () => {
    setPlatform('ios');
    const onTurnOn = jest.fn(async () => true);
    const tree = await tapTurnOn(onTurnOn);
    act(() => tree.unmount());

    // Opt-in inside an opt-in: "turn on reminders" alone never sets a
    // personal practice time.
    expect(onTurnOn).toHaveBeenCalledWith({ enabled: false, time: null });
  });
});

/**
 * WB1 job 1a — the acknowledgment beat. Cat's fresh-account walk found
 * "turn on reminders" writing the prefs and vanishing without a word, so
 * these pin that yes is now ANSWERED, that the answer is honest about the
 * platform it is on, and that it is never given when the write failed.
 */
describe('the answer to yes', () => {
  it('swaps the ask for a confirm, and the confirm names EMAIL on web', async () => {
    setPlatform('web');
    const tree = await tapTurnOn(async () => true);
    const texts = textsOf(tree);
    act(() => tree.unmount());

    // The ask is gone and the confirm is in its place.
    expect(texts).not.toContain(STRINGS.remindersAskCta);
    expect(texts).not.toContain(STRINGS.remindersAskMaybeLater);
    expect(texts).toContain(STRINGS.remindersConfirmWeb);
    // Web has no local scheduled reminder, so it must never claim one,
    // and the native pointer at a time-setting it does not have must not
    // ride along either.
    expect(texts).not.toContain(STRINGS.remindersConfirmNative);
    expect(texts).not.toContain(STRINGS.remindersConfirmTimePointer);
  });

  it('says the native thing on native, and points at settings when the row was left off', async () => {
    setPlatform('ios');
    const tree = await tapTurnOn(async () => true);
    const texts = textsOf(tree);
    act(() => tree.unmount());

    expect(texts).toContain(STRINGS.remindersConfirmNative);
    expect(texts).toContain(STRINGS.remindersConfirmTimePointer);
    // The web line is a promise about email delivery, and it is not
    // native's to make.
    expect(texts).not.toContain(STRINGS.remindersConfirmWeb);
  });

  it('NEVER confirms when the write did not land — the ask stays put', async () => {
    setPlatform('web');
    const tree = await tapTurnOn(async () => false);
    const texts = textsOf(tree);
    act(() => tree.unmount());

    expect(texts).not.toContain(STRINGS.remindersConfirmWeb);
    expect(texts).not.toContain(STRINGS.remindersConfirmNative);
    // Still askable, so the person can try again rather than being told
    // it worked.
    expect(texts).toContain(STRINGS.remindersAskCta);
  });
});
