type Coordinate = { latitude: number; longitude: number };

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Fetch a real walking route via the FOSSGIS pedestrian OSRM server (OSM data).
 * Falls back to the main OSRM driving server, then to a straight-line estimate.
 */
export async function fetchWalkingRoute(
  start: Coordinate,
  end: Coordinate,
): Promise<{ coords: Coordinate[]; distanceMi: number; durationMin: number }> {
  const coordStr = `${start.longitude},${start.latitude};${end.longitude},${end.latitude}`;
  const qs = 'overview=full&geometries=geojson&steps=false';

  const endpoints = [
    `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${coordStr}?${qs}`,
    `https://router.project-osrm.org/route/v1/driving/${coordStr}?${qs}`,
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'WavePointApp/1.0 (university-project)' },
      });
      clearTimeout(timeout);

      if (!res.ok) continue;

      const data = await res.json();
      if (data.code !== 'Ok') continue;

      const route = data.routes?.[0];
      if (!route?.geometry?.coordinates?.length) continue;

      const coords: Coordinate[] = route.geometry.coordinates.map(
        ([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }),
      );

      const distanceMi = (route.distance / 1000) * 0.621371;
      const isFoot = url.includes('routed-foot');
      const durationMin = isFoot
        ? Math.max(1, Math.round(route.duration / 60))
        : Math.max(1, Math.round((distanceMi / 3.1) * 60));

      return { coords, distanceMi, durationMin };
    } catch {
      continue;
    }
  }

  // All endpoints failed — straight-line fallback
  const distanceMi = haversineKm(start.latitude, start.longitude, end.latitude, end.longitude) * 0.621371;
  return {
    coords: [start, end],
    distanceMi,
    durationMin: Math.max(1, Math.round((distanceMi / 3.1) * 60)),
  };
}
