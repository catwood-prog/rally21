/**
 * PH1 (21 July): the WEB branch of the avatar upload — pinned so the
 * native fix can never drift it: web must keep fetching the picked uri
 * as a blob (with the canvas re-encode attempt) and never touch
 * expo-file-system. jest-expo's own default Platform.OS is 'ios', so
 * this file mocks Platform to 'web' (same split as lib/wakeLock.test.ts
 * vs lib/wakeLock.native.test.ts); the native branch has its own
 * coverage in lib/profile.native.test.ts. Under this non-jsdom
 * environment createImageBitmap doesn't exist, so reencodeAsJpeg takes
 * its documented fallback and the raw fetched blob uploads as-is —
 * which is exactly what lets these tests assert blob identity.
 */
// A minimal mock, not a spread of the real package — requireActual pulls
// in native-only modules this test doesn't need. Only lib/profile.ts's
// own `import { Platform } from 'react-native'` touches this.
jest.mock('react-native', () => ({
  Platform: { OS: 'web', select: (spec: Record<string, unknown>) => spec.web ?? spec.default },
}));

import { File as NativeFile } from 'expo-file-system';

import { saveProfile } from './profile';
import { supabase } from './supabase';

const uploadMock = jest.fn();
const getPublicUrlMock = jest.fn(() => ({
  data: { publicUrl: 'https://cdn.example/avatars/u1/avatar.jpeg' },
}));
const updateEqMock = jest.fn().mockResolvedValue({ error: null });
const updateMock = jest.fn((_payload: Record<string, unknown>) => ({ eq: updateEqMock }));
const lastUpdatePayload = () => updateMock.mock.calls[0]?.[0] ?? {};

const fakeBlob = { type: 'image/jpeg' };
const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  updateEqMock.mockResolvedValue({ error: null });
  fetchMock.mockResolvedValue({ blob: jest.fn().mockResolvedValue(fakeBlob) });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  (supabase as unknown as { storage: unknown }).storage = {
    from: jest.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock })),
  };
  (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });
});

describe('saveProfile — web avatar upload (unchanged by the native fix)', () => {
  it('fetches the picked uri as a blob and uploads that blob, never expo-file-system', async () => {
    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'blob:https://rally21.app/abc123',
    });

    expect(avatarWarning).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('blob:https://rally21.app/abc123');
    expect(NativeFile as unknown as jest.Mock).not.toHaveBeenCalled();

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, body, options] = uploadMock.mock.calls[0];
    expect(path).toBe('u1/avatar.jpeg');
    expect(body).toBe(fakeBlob);
    expect(options).toEqual({ upsert: true, contentType: 'image/jpeg' });

    const written = lastUpdatePayload();
    expect(String(written.avatar_url)).toMatch(
      /^https:\/\/cdn\.example\/avatars\/u1\/avatar\.jpeg\?t=\d+$/
    );
  });

  it('a failed fetch warns and still saves the name (existing behavior)', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'blob:https://rally21.app/abc123',
    });

    expect(avatarWarning).toBe(
      "your photo didn't upload, but your name is saved — try again later from settings"
    );
    const written = lastUpdatePayload();
    expect(written.name).toBe('Cat');
    expect(written).not.toHaveProperty('avatar_url');
  });
});
