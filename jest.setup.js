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
