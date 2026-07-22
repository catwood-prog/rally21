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
  registerGlobalErrorHandlers: jest.fn(),
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

// PH1 (21 July): expo-file-system's File class wraps a native
// SharedObject that isn't registered under Jest's module registry (same
// class of issue as expo-audio above) — lib/profile.ts imports it for the
// native avatar-upload path, so any test that transitively imports
// lib/profile.ts needs this stub. Tests set the constructor's
// implementation per-case (e.g. what bytes() resolves to).
jest.mock('expo-file-system', () => ({
  File: jest.fn(),
}));

// AR1 (21 July): expo/fetch wraps the native ExpoFetchModule, which has
// no Jest registration (same class of issue as expo-audio above) —
// lib/askRally.ts imports it for the native streaming transport, so any
// test that transitively imports lib/askRally.ts needs this stub.
// Transport tests inject their own fetch via streamAskRally's deps.
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

// GN1 (13 July): both native sign-in libraries wrap a native TurboModule
// that isn't registered under Jest's module registry (same class of issue
// as expo-audio above) — any test that transitively imports
// lib/auth-context.tsx (which every authenticated screen does) needs
// these stubbed.
jest.mock('expo-apple-authentication', () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), signIn: jest.fn() },
  isSuccessResponse: jest.fn(() => false),
  isErrorWithCode: jest.fn(() => false),
  statusCodes: { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED' },
}));
