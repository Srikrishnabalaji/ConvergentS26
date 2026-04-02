export type SearchItem = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

/** Geocode a free-text query via Nominatim (OpenStreetMap), biased toward Austin, TX. */
export async function geocodeSearch(query: string): Promise<SearchItem[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '10',
    addressdetails: '1',
    viewbox: '-97.82,30.35,-97.65,30.22',
    bounded: '0',
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { 'User-Agent': 'WavePointApp/1.0 (university-project)' } },
  );

  if (!res.ok) return [];

  const data: any[] = await res.json();

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
