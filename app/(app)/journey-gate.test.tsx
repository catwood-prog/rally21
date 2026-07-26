import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { act, create } from 'react-test-renderer';

import { STRINGS } from '@/constants/strings';

const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useLocalSearchParams: () => ({}),
}));

import { JOURNEY_GATE_EXIT_HREF, JourneyGateExitButton } from './journey-gate';

/**
 * CB1 job 1a (25 July, live trap on Cat's device): the day-21 ceremony's
 * exit rendered STRINGS.journeyCompletedCta — "Back to today" — and
 * called router.replace('/circle'). The circle screen then pushed
 * straight back to the ceremony on the same gate check, and in the
 * rallied branch that button was the ONLY exit: a closed cycle on a
 * screen with no tab bar.
 *
 * The button lied. This pins the label to the destination so they cannot
 * drift apart again — if someone re-points the exit, or re-words the CTA
 * to mean somewhere else, one of these fails.
 */
describe('the day-21 ceremony exit — its destination matches its label', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
  });

  it('is labelled with the CTA that says "today"', () => {
    expect(STRINGS.journeyCompletedCta.toLowerCase()).toContain('today');
  });

  it('navigates to Today when tapped, and to nothing else', () => {
    let renderer: ReturnType<typeof create> | null = null;
    act(() => {
      renderer = create(React.createElement(JourneyGateExitButton));
    });

    const labels = renderer!.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat();
    expect(labels).toContain(STRINGS.journeyCompletedCta);

    // react-test-renderer doesn't run RN's touch responder, so fire the
    // handler the Touchable was given directly — the assertion is about
    // where the tap GOES, not how it's delivered.
    const touchables = renderer!.root.findAllByType(TouchableOpacity);
    expect(touchables).toHaveLength(1);
    act(() => {
      touchables[0].props.onPress();
    });

    expect(mockReplace).toHaveBeenCalledWith('/today');
    expect(mockPush).not.toHaveBeenCalled();

    // The exact defect: never back to the screen that routes here.
    const destinations = JSON.stringify(mockReplace.mock.calls);
    expect(destinations).not.toContain('circle');
  });

  it('exports one destination, so both decided branches share it', () => {
    expect(JOURNEY_GATE_EXIT_HREF).toBe('/today');
  });
});
