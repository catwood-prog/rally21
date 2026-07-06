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
