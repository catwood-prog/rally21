/**
 * WB1 job 2 — the birthday block is Option B (Cat's ruling, 3 Aug, from
 * Rally21-Profile-Birthday-Mockups.html): three labelled typed boxes, no
 * month chips, no slash mask.
 *
 * These pin the two things that could regress quietly. First, the SHAPE:
 * a future tidy-up that reinstates a chip grid would put fifteen controls
 * back on a fresh account's first screen, and nothing else in the repo
 * would notice. Second, the VALIDATION, which is the whole reason the
 * boxes are labelled rather than masked — 31/02 has to be refused, and
 * refused kindly, and a skipped year has to stay a valid birthday.
 */
import React from 'react';
import { Text, TextInput } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';
import { isValidBirthday, MONTHS } from '@/lib/birthday';

import { BirthdayPicker, BirthdayValue } from './BirthdayPicker';

function render(value: BirthdayValue) {
  const onChange = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<BirthdayPicker value={value} onChange={onChange} />);
  });
  // Props are snapshotted here, not read later: react-test-renderer
  // resolves `.props` against the LIVE fiber, so a node held past unmount
  // throws instead of returning what it rendered.
  const inputs = tree.root.findAllByType(TextInput).map((n) => n.props);
  const texts = tree.root.findAllByType(Text).flatMap((n) =>
    (Array.isArray(n.props.children) ? n.props.children : [n.props.children]).filter(
      (c: unknown) => typeof c === 'string'
    )
  ) as string[];
  return { tree, onChange, inputs, texts };
}

const EMPTY: BirthdayValue = { month: null, day: null, year: null };

describe('the birthday block — variant B', () => {
  it('is three typed boxes, labelled DAY / MONTH / YEAR, in that order', () => {
    const { tree, inputs, texts } = render(EMPTY);
    act(() => tree.unmount());

    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.accessibilityLabel)).toEqual([
      STRINGS.birthdayDaySubLabel,
      STRINGS.birthdayMonthSubLabel,
      STRINGS.birthdayYearSubLabel,
    ]);
    // Every box takes digits only, and each is capped at its own width.
    expect(inputs.map((i) => i.keyboardType)).toEqual([
      'number-pad',
      'number-pad',
      'number-pad',
    ]);
    expect(inputs.map((i) => i.maxLength)).toEqual([2, 2, 4]);
    // The labels are present as text, so the ambiguity a 00/00/0000 mask
    // creates for a UK/US cohort cannot come back by accident.
    expect(texts).toEqual(
      expect.arrayContaining([
        STRINGS.birthdayDaySubLabel,
        STRINGS.birthdayMonthSubLabel,
        STRINGS.birthdayYearSubLabel,
      ])
    );
  });

  it('has no month chips left — not one of the twelve', () => {
    const { tree, texts } = render(EMPTY);
    act(() => tree.unmount());
    for (const month of MONTHS) {
      expect(texts).not.toContain(month.label);
    }
  });

  it('says nothing at all about an untouched block', () => {
    const { tree, texts } = render(EMPTY);
    act(() => tree.unmount());
    for (const hint of [
      STRINGS.birthdayPickMonthFirst,
      STRINGS.birthdayAddDayToo,
      STRINGS.birthdayDayOutOfRange,
      STRINGS.birthdayMonthOutOfRange,
    ]) {
      expect(texts).not.toContain(hint);
    }
  });

  it('refuses 31 February quietly, naming the month rather than the person', () => {
    const { tree, texts } = render({ month: 2, day: 31, year: null });
    act(() => tree.unmount());

    expect(texts).toContain(STRINGS.birthdayDayNotInMonth('February', 29));
    // And the save gate agrees with what the screen just said.
    expect(isValidBirthday(2, 31, null)).toBe(false);
  });

  it('states the range for an impossible day or month', () => {
    const day = render({ month: 4, day: 45, year: null });
    act(() => day.tree.unmount());
    expect(day.texts).toContain(STRINGS.birthdayDayOutOfRange);

    const month = render({ month: 13, day: 4, year: null });
    act(() => month.tree.unmount());
    expect(month.texts).toContain(STRINGS.birthdayMonthOutOfRange);
  });

  it('asks for the missing half of the pair, one side at a time', () => {
    const noMonth = render({ month: null, day: 14, year: null });
    act(() => noMonth.tree.unmount());
    expect(noMonth.texts).toContain(STRINGS.birthdayPickMonthFirst);

    const noDay = render({ month: 4, day: null, year: null });
    act(() => noDay.tree.unmount());
    expect(noDay.texts).toContain(STRINGS.birthdayAddDayToo);
  });

  it('treats a skipped year as complete, and an implausible one as a range', () => {
    const skipped = render({ month: 4, day: 14, year: null });
    act(() => skipped.tree.unmount());
    // A good date with no year says nothing — the year is optional and
    // saying so twice would read as nagging for it.
    expect(skipped.texts).toHaveLength(3);
    expect(isValidBirthday(4, 14, null)).toBe(true);

    const tooEarly = render({ month: 4, day: 14, year: 1200 });
    act(() => tooEarly.tree.unmount());
    expect(tooEarly.texts.some((t) => t.startsWith('years go from'))).toBe(true);
    expect(isValidBirthday(4, 14, 1200)).toBe(false);
  });

  it('parses each box into the same {month, day, year} storage the chips wrote', () => {
    const { tree, onChange, inputs } = render(EMPTY);
    act(() => inputs[1].onChangeText('4'));
    expect(onChange).toHaveBeenLastCalledWith({ month: 4, day: null, year: null });

    // Non-digits are dropped rather than rejected, and an emptied box goes
    // back to null (never 0, which the DB constraint would refuse).
    act(() => inputs[0].onChangeText('1a4'));
    expect(onChange).toHaveBeenLastCalledWith({ month: null, day: 14, year: null });
    act(() => inputs[0].onChangeText(''));
    expect(onChange).toHaveBeenLastCalledWith({ month: null, day: null, year: null });
    act(() => tree.unmount());
  });
});

describe('the helper line', () => {
  it('carries no em dash', () => {
    expect(STRINGS.birthdayWhy).not.toContain('—');
    expect(STRINGS.birthdayWhy).toBe(
      'so your circle can celebrate you on the day. the year stays private, and you can skip this'
    );
  });
});
