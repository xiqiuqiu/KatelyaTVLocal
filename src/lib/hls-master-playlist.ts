/**
 * Master vs media HLS playlist helpers.
 * iOS native HLS observeOnly must analyze a media playlist (#EXTINF timeline),
 * not a master (#EXT-X-STREAM-INF) which has no ad timeline to skip/mark.
 */

export interface HlsVariantCandidate {
  uri: string;
  resolutionHeight: number | null;
  bandwidth: number | null;
}

export function isHlsMediaPlaylistContent(content: string): boolean {
  return content.includes('#EXTINF');
}

function resolvePlaylistUrl(uri: string, baseUrl: string): string | null {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseResolutionHeight(attributes: string): number | null {
  const match = attributes.match(/RESOLUTION=(\d+)x(\d+)/i);
  if (!match) {
    return null;
  }

  const height = Number(match[2]);
  return Number.isFinite(height) ? height : null;
}

function parseBandwidth(attributes: string): number | null {
  const match = attributes.match(/BANDWIDTH=(\d+)/i);
  if (!match) {
    return null;
  }

  const bandwidth = Number(match[1]);
  return Number.isFinite(bandwidth) ? bandwidth : null;
}

/**
 * Prefer the highest RESOLUTION variant; when height is tied/missing, prefer
 * highest BANDWIDTH (common on masters that omit RESOLUTION).
 */
export function selectPreferredHlsVariantUrl(
  masterContent: string,
  baseUrl: string
): string | null {
  const lines = masterContent.split(/\r?\n/).map((line) => line.trim());
  const variants: HlsVariantCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('#EXT-X-STREAM-INF')) {
      continue;
    }

    const resolutionHeight = parseResolutionHeight(line);
    const bandwidth = parseBandwidth(line);
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const uri = lines[nextIndex];
      if (!uri || uri.startsWith('#')) {
        continue;
      }

      const resolved = resolvePlaylistUrl(uri, baseUrl);
      if (resolved) {
        variants.push({ uri: resolved, resolutionHeight, bandwidth });
      }
      break;
    }
  }

  if (variants.length === 0) {
    return null;
  }

  return variants.sort((left, right) => {
    const heightDelta =
      (right.resolutionHeight || 0) - (left.resolutionHeight || 0);
    if (heightDelta !== 0) {
      return heightDelta;
    }
    return (right.bandwidth || 0) - (left.bandwidth || 0);
  })[0].uri;
}
