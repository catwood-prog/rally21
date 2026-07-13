/**
 * GN1 (13 July): the native branch of useWakeLock, added so a timed sit on
 * iOS doesn't let the screen sleep mid-countdown (navigator.wakeLock has no
 * native equivalent — see lib/wakeLock.ts). Runs under jest-expo's own
 * default Platform.OS ('ios'), no override needed — the web branch's own
 * coverage (lib/wakeLock.test.ts) explicitly mocks Platform.OS to 'web'
 * instead, so the two files never fight over the same module mock.
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
}));

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { useWakeLock } from './wakeLock';

function Harness({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

describe('useWakeLock — native branch (jest-expo default Platform.OS)', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
    jest.clearAllMocks();
  });

  it('activates keep-awake once active becomes true', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });

    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('rally21-checkin-timer');
  });

  it('never activates when active is false', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness, { active: false }));
    });

    expect(activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it('deactivates on unmount (covers completion/cancel/navigation-away)', async () => {
    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });
    await act(async () => {
      renderer?.unmount();
    });
    renderer = null;

    expect(deactivateKeepAwake).toHaveBeenCalledWith('rally21-checkin-timer');
  });

  it('is a silent no-op when expo-keep-awake rejects (unsupported or denied, never throws)', async () => {
    (activateKeepAwakeAsync as jest.Mock).mockRejectedValueOnce(new Error('unsupported'));

    await expect(
      act(async () => {
        renderer = create(React.createElement(Harness, { active: true }));
      })
    ).resolves.not.toThrow();
  });
});
