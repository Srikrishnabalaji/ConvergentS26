export type SearchItem = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type LatLng = { latitude: number; longitude: number };

const HEADERS = { 'User-Agent': 'WavePointApp/1.0 (university-project)' };

export class GeocodingNetworkError extends Error {
  constructor() {
    super('Unable to search. Please check your connection.');
    this.name = 'GeocodingNetworkError';
  }
}

let _lastNominatimRequest = 0;

async function rateLimitedFetch(url: string, signal?: AbortSignal): Promise<Response> {
  const elapsed = Date.now() - _lastNominatimRequest;
  if (elapsed < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - elapsed));
  }
  _lastNominatimRequest = Date.now();
  return fetch(url, { headers: HEADERS, signal });
}

/**
 * Build a viewbox string for Nominatim centred on `center` with the given
 * half-width in degrees of longitude/latitude.
 */
function viewboxAround(center: LatLng, halfDeg: number): string {
  return [
    center.longitude - halfDeg,
    center.latitude + halfDeg,
    center.longitude + halfDeg,
    center.latitude - halfDeg,
  ].join(',');
}

function parseResults(data: any[]): SearchItem[] {
  return data.map((place) => {
    const parts = (place.display_name as string).split(',').map((s: string) => s.trim());
    return {
      id: String(place.place_id),
      name: parts[0],
      address: parts.slice(1, 4).join(', '),
      latitude: parseFloat(place.lat),
      longitude: parseFloat(place.lon),
    };
  });
}

/**
 * Geocode a free-text query via Nominatim (OpenStreetMap).
 *
 * Searches in expanding rings around the user's location so nearby results
 * (e.g. the closest Cane's) rank first — similar to Google / Apple Maps.
 *
 * Ring radii (degrees): ~0.02 ≈ 2 km, ~0.06 ≈ 7 km, ~0.15 ≈ 17 km, then unbounded.
 */
export async function geocodeSearch(
  query: string,
  userLocation?: LatLng,
  signal?: AbortSignal,
): Promise<SearchItem[]> {
  const radii = [0.02, 0.06, 0.15];
  const MIN_GOOD_RESULTS = 3;
  let allRequestsFailed = true;

  if (userLocation) {
    for (const r of radii) {
      if (signal?.aborted) return [];

      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: '10',
        addressdetails: '1',
        viewbox: viewboxAround(userLocation, r),
        bounded: '1',
      });

      try {
        const res = await rateLimitedFetch(
          `https://nominatim.openstreetmap.org/search?${params}`,
          signal,
        );
        if (!res.ok) continue;
        allRequestsFailed = false;

        const data: any[] = await res.json();
        if (data.length >= MIN_GOOD_RESULTS) return parseResults(data);
        if (data.length > 0 && r === radii[radii.length - 1]) return parseResults(data);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return [];
        continue;
      }
    }
  }

  if (signal?.aborted) return [];

  // Unbounded fallback (biased toward Austin)
  const fallbackParams = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '10',
    addressdetails: '1',
    viewbox: userLocation
      ? viewboxAround(userLocation, 0.5)
      : '-97.82,30.35,-97.65,30.22',
    bounded: '0',
  });

  try {
    const res = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/search?${fallbackParams}`,
      signal,
    );
    if (!res.ok) {
      if (allRequestsFailed) throw new GeocodingNetworkError();
      return [];
    }
    const data: any[] = await res.json();
    return parseResults(data);
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    if (e instanceof GeocodingNetworkError) throw e;
    if (allRequestsFailed) throw new GeocodingNetworkError();
    return [];
  }
}
