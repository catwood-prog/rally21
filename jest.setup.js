// jest-expo's environment treats EXPO_PUBLIC_* process.env assignments as
// no-ops (mirroring how they're inlined at build time in real usage, not
// read at runtime) — so lib/supabase.ts's "are these set?" guard can't be
// satisfied by setting process.env in a setup file. Mocking the module
// directly sidesteps that guard entirely; any lib/ test that transitively
// imports lib/supabase.ts just gets this stub instead of a real client.
jest.mock('./lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
    channel: jest.fn(),
    removeChannel: jest.fn(),
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
  },
}));

// @sentry/react ships ESM that jest-expo's transformer doesn't handle;
// mocking here (rather than fighting transformIgnorePatterns) matches the
// lib/supabase mock above — any lib/ test that transitively imports
// lib/sentry just gets a no-op stub.
jest.mock('./lib/sentry', () => ({
  initSentry: jest.fn(),
  captureError: jest.fn(),
  setSentryScreen: jest.fn(),
}));

// The native AsyncStorage module doesn't exist under Jest (it's a native
// module with no JS implementation to fall back on), so any lib/ test that
// imports it directly throws "NativeModule: AsyncStorage is null" unless
// mocked — the package ships its own official in-memory jest mock for
// exactly this (T1, 8 July: found while adding lib/timer.ts's persisted
// countdown, which needed a real AsyncStorage round-trip to test).
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// GN1 (13 July): expo-audio's AudioPlayer class extends a native
// SharedObject base that isn't set up under Jest's module registry, so
// merely importing it throws — any lib/ test (or screen test) that
// transitively imports lib/chime.ts needs this global stub, same pattern
// as the mocks above.
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => ({
    play: jest.fn(),
    remove: jest.fn(),
  })),
}));
