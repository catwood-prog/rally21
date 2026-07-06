const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Extracts an 11-character YouTube video id from any of the watch,
 * shorts, youtu.be, or embed URL forms. Returns null for anything else,
 * including a malformed or non-YouTube URL. */
export function extractYouTubeId(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.has(url.hostname)) return null;

  const idPattern = /^[A-Za-z0-9_-]{11}$/;

  if (url.hostname === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return idPattern.test(id) ? id : null;
  }

  const watchId = url.searchParams.get('v');
  if (watchId && idPattern.test(watchId)) return watchId;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && (segments[0] === 'shorts' || segments[0] === 'embed')) {
    const id = segments[1];
    return idPattern.test(id) ? id : null;
  }

  return null;
}

/** Hostname for display on a generic link card, with any "www." prefix
 * stripped since it's noise for a reader deciding whether to tap. */
export function getUrlDomain(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return value;
  }
}
