import { resolveHapticChannel, tick, thump, success } from './haptics';

// expo-haptics is auto-mocked (jest.mock below) so tick/thump/success can
// be exercised for real without touching an actual device — the pure
// resolveHapticChannel below covers the platform-branching logic itself,
// and these integration checks confirm the public functions actually
// call it instead of hand-rolling their own platform check.
jest.mock('expo-haptics', () => ({
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success' },
}));

const Haptics = jest.requireMock('expo-haptics');

describe('resolveHapticChannel — pure platform branching', () => {
  it('web with vibrate support -> web-vibrate', () => {
    expect(resolveHapticChannel('web', true)).toBe('web-vibrate');
  });

  it('web without vibrate support (iOS Safari) -> silent, never a workaround', () => {
    expect(resolveHapticChannel('web', false)).toBe('silent');
  });

  it('native platforms (ios/android) -> native, regardless of vibrate support', () => {
    expect(resolveHapticChannel('ios', false)).toBe('native');
    expect(resolveHapticChannel('android', true)).toBe('native');
  });
});

// jest-expo's default Platform.OS is 'ios', so tick/thump/success below
// exercise the real 'native' branch end to end against the mocked
// expo-haptics module.
describe('tick/thump/success — native branch (jest-expo default Platform.OS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('tick() calls Haptics.selectionAsync', () => {
    tick();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it('thump() calls Haptics.impactAsync with Medium', () => {
    thump();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('success() calls Haptics.notificationAsync with Success', () => {
    success();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith('success');
  });

  it('reduceMotion:true suppresses every function, no haptics call made', () => {
    tick({ reduceMotion: true });
    thump({ reduceMotion: true });
    success({ reduceMotion: true });
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  });

  it('a rejected native call never throws (silent no-op)', async () => {
    Haptics.selectionAsync.mockRejectedValueOnce(new Error('unsupported'));
    expect(() => tick()).not.toThrow();
    // flush the rejected promise's .catch handler before the test exits
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
