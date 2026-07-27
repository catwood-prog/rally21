import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { withRequestTimeout } from './fetch-timeout';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — check .env.local'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // On web, supabase-js defaults to window.localStorage; on native we
    // need to hand it AsyncStorage explicitly.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Web needs this to pick the session up out of the magic-link redirect
    // URL; native has no URL to detect a session in.
    detectSessionInUrl: Platform.OS === 'web',
  },
  global: {
    // SUP1 — the one client-level deadline. supabase-js sets no default,
    // so without this a request that never returns spins the screen
    // forever, on every screen in the app. Wrapping the client's fetch
    // covers PostgREST, RPCs, auth, storage and edge functions in one
    // place; see lib/fetch-timeout.ts for the durations and the defence
    // of each. The arrow (rather than a bare `fetch`) keeps the global
    // bound — an unbound fetch throws "Illegal invocation" on web.
    fetch: withRequestTimeout((...args) => fetch(...args)),
  },
});
