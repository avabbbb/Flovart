export const NATIVE_HOST_NAME = 'com.flovart.browser_bridge';
export const CHUNK_BYTES = 256 * 1024;

export function* splitImportBytes(bytes) {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    yield bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, bytes.length));
  }
}

export function bytesToBase64(bytes) {
  let binary = '';
  const step = 32 * 1024;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function exactOptionalOrigin(sourceUrl, pageUrl) {
  let source;
  try {
    source = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (source.protocol !== 'http:' && source.protocol !== 'https:') return null;
  try {
    if (new URL(pageUrl).origin === source.origin) return null;
  } catch {
    // Invalid/missing page URLs still require the exact selected source origin.
  }
  return `${source.origin}/*`;
}

export function provenanceUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString().slice(0, 4096);
}
