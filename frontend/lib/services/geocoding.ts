import {
  expandBuildingQuery,
  findBuilding,
  UT_BUILDING_ENTRANCES,
} from '@/lib/data/utBuildings';

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
 * Offline / fallback pin for known UT buildings (same data as geocode fast path).
 * Use when Nominatim errors or is rate-limited.
 */
export function localCampusSearchItem(query: string): SearchItem | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const firstToken = trimmed.split(/\s+/)[0] ?? '';
  const matchedBuilding = findBuilding(trimmed) ?? findBuilding(firstToken);
  if (!matchedBuilding) return null;
  const ent = UT_BUILDING_ENTRANCES[matchedBuilding.code];
  if (!ent) return null;
  return {
    id: `ut-local-${matchedBuilding.code}`,
    name: matchedBuilding.displayName,
    address: 'The University of Texas at Austin',
    latitude: ent.latitude,
    longitude: ent.longitude,
  };
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
  const trimmed = query.trim();
  const firstToken = trimmed.split(/\s+/)[0] ?? '';
  const matchedBuilding = findBuilding(trimmed) ?? findBuilding(firstToken);

  // Instant path: known campus building → skip Nominatim (avoids 1 req/s limits &
  // races with the map search debouncer when opening from Calendar).
  if (!signal?.aborted) {
    const local = localCampusSearchItem(trimmed);
    if (local) return [local];
  }

  const friendlyName = matchedBuilding?.displayName;
  const expanded = expandBuildingQuery(query);
  const effectiveQuery = expanded || query;

  const radii = [0.02, 0.06, 0.15];
  const MIN_GOOD_RESULTS = 3;
  let allRequestsFailed = true;

  const finalize = (items: SearchItem[]): SearchItem[] => {
    if (!friendlyName || items.length === 0) return items;
    // Surface the canonical UT name on the top result so the search bar shows
    // "Gates Dell Complex (GDC)" instead of the long Nominatim string.
    return items.map((it, idx) => (idx === 0 ? { ...it, name: friendlyName } : it));
  };

  if (userLocation) {
    for (const r of radii) {
      if (signal?.aborted) return [];

      const params = new URLSearchParams({
        q: effectiveQuery,
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
        if (data.length >= MIN_GOOD_RESULTS) return finalize(parseResults(data));
        if (data.length > 0 && r === radii[radii.length - 1]) return finalize(parseResults(data));
      } catch (e) {
        if ((e as Error).name === 'AbortError') return [];
        continue;
      }
    }
  }

  if (signal?.aborted) return [];

  // Unbounded fallback (biased toward Austin)
  const fallbackParams = new URLSearchParams({
    q: effectiveQuery,
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
      const local = localCampusSearchItem(trimmed);
      if (local) return [local];
      if (allRequestsFailed) throw new GeocodingNetworkError();
      return [];
    }
    const data: any[] = await res.json();
    const parsed = finalize(parseResults(data));
    if (parsed.length > 0) return parsed;
    const local = localCampusSearchItem(trimmed);
    if (local) return [local];
    return [];
  } catch (e) {
    if ((e as Error).name === 'AbortError') return [];
    if (e instanceof GeocodingNetworkError) {
      const local = localCampusSearchItem(trimmed);
      if (local) return [local];
      throw e;
    }
    const local = localCampusSearchItem(trimmed);
    if (local) return [local];
    if (allRequestsFailed) throw new GeocodingNetworkError();
    return [];
  }
}
