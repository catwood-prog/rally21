/**
 * @jest-environment jsdom
 *
 * useWakeLock listens for `document`'s visibilitychange event, which
 * doesn't exist under this project's default (non-jsdom) jest-expo test
 * environment — jsdom is already resolvable via jest's own dependency
 * tree (jest-environment-jsdom), so this is a per-file environment
 * override, not a new dependency.
 */
import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';

import { useWakeLock } from './wakeLock';

/** T1 (8 July) — useWakeLock has no visible render output, so it's
 * exercised through a bare test-harness component + react-test-renderer
 * (already a project devDependency; no new one added) rather than a
 * dedicated hooks-testing library. */
function Harness({ active }: { active: boolean }) {
  useWakeLock(active);
  return null;
}

type MockSentinel = {
  released: boolean;
  release: jest.Mock<Promise<void>, []>;
  addEventListener: jest.Mock;
  fireRelease: () => void;
};

function makeMockSentinel(): MockSentinel {
  const listeners: (() => void)[] = [];
  const sentinel: MockSentinel = {
    released: false,
    release: jest.fn(async () => {
      sentinel.released = true;
    }),
    addEventListener: jest.fn((type: string, cb: () => void) => {
      if (type === 'release') listeners.push(cb);
    }),
    fireRelease: () => listeners.forEach((cb) => cb()),
  };
  return sentinel;
}

describe('useWakeLock', () => {
  const originalWakeLock = (navigator as any).wakeLock;
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    act(() => {
      renderer?.unmount();
    });
    renderer = null;
    (navigator as any).wakeLock = originalWakeLock;
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  it('requests a screen wake lock once active becomes true', async () => {
    const sentinel = makeMockSentinel();
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as any).wakeLock = { request };

    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });

    expect(request).toHaveBeenCalledWith('screen');
  });

  it('never requests when active is false', async () => {
    const sentinel = makeMockSentinel();
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as any).wakeLock = { request };

    await act(async () => {
      renderer = create(React.createElement(Harness, { active: false }));
    });

    expect(request).not.toHaveBeenCalled();
  });

  it('releases the held lock on unmount (covers completion/cancel/navigation-away, which all unmount the timer screen)', async () => {
    const sentinel = makeMockSentinel();
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as any).wakeLock = { request };

    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });
    await act(async () => {
      renderer?.unmount();
    });
    renderer = null;

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it('re-acquires on visibilitychange -> visible after the platform released the lock while hidden (verified MDN behavior: locks auto-release on hidden, never auto-reacquire)', async () => {
    const sentinelA = makeMockSentinel();
    const sentinelB = makeMockSentinel();
    const request = jest.fn().mockResolvedValueOnce(sentinelA).mockResolvedValueOnce(sentinelB);
    (navigator as any).wakeLock = { request };

    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);

    // The platform releases the lock out from under us while hidden —
    // simulated by firing the sentinel's own 'release' event, exactly as
    // the real WakeLockSentinel does.
    act(() => {
      sentinelA.fireRelease();
    });

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not re-request on visibilitychange if the sentinel was never released (still held)', async () => {
    const sentinel = makeMockSentinel();
    const request = jest.fn().mockResolvedValue(sentinel);
    (navigator as any).wakeLock = { request };

    await act(async () => {
      renderer = create(React.createElement(Harness, { active: true }));
    });
    expect(request).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(request).toHaveBeenCalledTimes(1);
  });

  it('is a silent no-op when the Wake Lock API is absent (feature-detected, never throws)', async () => {
    delete (navigator as any).wakeLock;

    expect(() => {
      act(() => {
        renderer = create(React.createElement(Harness, { active: true }));
      });
    }).not.toThrow();
  });
});
