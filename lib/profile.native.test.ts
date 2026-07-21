/**
 * PH1 (21 July): the native branch of the avatar upload. On iOS,
 * fetch(uri).blob() silently yields a zero-byte blob for the picker's
 * file:// uris and storage accepts it (confirmed live: a 0-byte
 * avatar.jpeg landed from the 21 July on-device attempt) — so native now
 * reads the real bytes via expo-file-system and any failure surfaces as
 * saveProfile's avatarWarning instead of a blank photo "saving". Runs
 * under jest-expo's own default Platform.OS ('ios'), no override needed —
 * the web branch's own coverage (lib/profile.test.ts) mocks Platform.OS
 * to 'web' instead, so the two files never fight over the same mock.
 * expo-file-system's File constructor is stubbed in jest.setup.js;
 * each test sets what bytes() resolves to.
 */
import { File as NativeFile } from 'expo-file-system';

import { STRINGS } from '@/constants/strings';

import { avatarFilePartsFromUri, saveProfile } from './profile';
import { supabase } from './supabase';

const MockNativeFile = NativeFile as unknown as jest.Mock;

const uploadMock = jest.fn();
const getPublicUrlMock = jest.fn(() => ({
  data: { publicUrl: 'https://cdn.example/avatars/u1/avatar.jpeg' },
}));
const updateEqMock = jest.fn().mockResolvedValue({ error: null });
const updateMock = jest.fn((_payload: Record<string, unknown>) => ({ eq: updateEqMock }));
const lastUpdatePayload = () => updateMock.mock.calls[0]?.[0] ?? {};

beforeEach(() => {
  jest.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  updateEqMock.mockResolvedValue({ error: null });
  (supabase as unknown as { storage: unknown }).storage = {
    from: jest.fn(() => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock })),
  };
  (supabase.from as jest.Mock).mockReturnValue({ update: updateMock });
});

function mockPickedFileBytes(bytes: Uint8Array) {
  MockNativeFile.mockImplementation(() => ({
    bytes: jest.fn().mockResolvedValue(bytes),
  }));
}

describe('avatarFilePartsFromUri', () => {
  it('normalizes jpg (any case) to jpeg so the object path matches the web path', () => {
    expect(avatarFilePartsFromUri('file:///tmp/IMG_1.jpg')).toEqual({
      ext: 'jpeg',
      contentType: 'image/jpeg',
    });
    expect(avatarFilePartsFromUri('file:///tmp/IMG_1.JPG')).toEqual({
      ext: 'jpeg',
      contentType: 'image/jpeg',
    });
    expect(avatarFilePartsFromUri('file:///tmp/crop.jpeg')).toEqual({
      ext: 'jpeg',
      contentType: 'image/jpeg',
    });
  });

  it('keeps the browser-displayable formats as-is', () => {
    expect(avatarFilePartsFromUri('file:///tmp/pic.png')).toEqual({
      ext: 'png',
      contentType: 'image/png',
    });
    expect(avatarFilePartsFromUri('file:///tmp/pic.webp')).toEqual({
      ext: 'webp',
      contentType: 'image/webp',
    });
  });

  it('defaults anything else (heic, no extension, query-string tails) to jpeg', () => {
    expect(avatarFilePartsFromUri('file:///tmp/photo.heic').ext).toBe('jpeg');
    expect(avatarFilePartsFromUri('file:///tmp/no-extension').ext).toBe('jpeg');
    expect(avatarFilePartsFromUri('file:///tmp/pic.png?cache=1')).toEqual({
      ext: 'png',
      contentType: 'image/png',
    });
  });
});

describe('saveProfile — native avatar upload', () => {
  it('uploads the file bytes read via expo-file-system, not a fetched blob', async () => {
    const pickedBytes = new Uint8Array([7, 8, 9]);
    mockPickedFileBytes(pickedBytes);

    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'file:///tmp/IMG_1.jpg',
    });

    expect(avatarWarning).toBeNull();
    expect(MockNativeFile).toHaveBeenCalledWith('file:///tmp/IMG_1.jpg');
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, body, options] = uploadMock.mock.calls[0];
    expect(path).toBe('u1/avatar.jpeg');
    expect(body).toBe(pickedBytes.buffer);
    expect(options).toEqual({ upsert: true, contentType: 'image/jpeg' });

    const written = lastUpdatePayload();
    expect(written.name).toBe('Cat');
    expect(String(written.avatar_url)).toMatch(
      /^https:\/\/cdn\.example\/avatars\/u1\/avatar\.jpeg\?t=\d+$/
    );
  });

  it('a zero-byte read never uploads — warns and keeps the old avatar_url', async () => {
    mockPickedFileBytes(new Uint8Array(0));

    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'file:///tmp/IMG_1.jpg',
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(avatarWarning).toBe(STRINGS.profilePhotoUploadFailed);
    const written = lastUpdatePayload();
    expect(written.name).toBe('Cat');
    expect(written).not.toHaveProperty('avatar_url');
  });

  it('a storage upload error warns instead of failing the whole save', async () => {
    mockPickedFileBytes(new Uint8Array([1]));
    uploadMock.mockResolvedValue({ error: { message: 'nope' } });

    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'file:///tmp/IMG_1.jpg',
    });

    expect(avatarWarning).toBe(STRINGS.profilePhotoUploadFailed);
    const written = lastUpdatePayload();
    expect(written.name).toBe('Cat');
    expect(written).not.toHaveProperty('avatar_url');
  });

  it('an unreadable picked file warns instead of failing the whole save', async () => {
    MockNativeFile.mockImplementation(() => ({
      bytes: jest.fn().mockRejectedValue(new Error('no such file')),
    }));

    const { avatarWarning } = await saveProfile('u1', {
      name: 'Cat',
      avatarUri: 'file:///tmp/gone.jpg',
    });

    expect(uploadMock).not.toHaveBeenCalled();
    expect(avatarWarning).toBe(STRINGS.profilePhotoUploadFailed);
  });
});
