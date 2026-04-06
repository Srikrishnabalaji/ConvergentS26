export type Coordinate = { latitude: number; longitude: number };

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
 * Shortest distance in metres from a point to the nearest segment of a polyline.
 * Used to decide whether the user has drifted off-route.
 */
export function distanceToPolylineM(
  point: Coordinate,
  polyline: Coordinate[],
): number {
  if (polyline.length === 0) return Infinity;
  if (polyline.length === 1) {
    return haversineKm(point.latitude, point.longitude, polyline[0].latitude, polyline[0].longitude) * 1000;
  }

  let minDist = Infinity;

  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];

    // Project point onto segment a→b in flat-earth approximation (fine for short distances)
    const dx = b.longitude - a.longitude;
    const dy = b.latitude - a.latitude;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t = ((point.longitude - a.longitude) * dx + (point.latitude - a.latitude) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projLat = a.latitude + t * dy;
    const projLng = a.longitude + t * dx;

    const d = haversineKm(point.latitude, point.longitude, projLat, projLng) * 1000;
    if (d < minDist) minDist = d;
  }

  return minDist;
}

export function trimRouteToPosition(
  position: Coordinate,
  route: Coordinate[],
): Coordinate[] {
  if (route.length < 2) return route;

  let minDist = Infinity;
  let bestIndex = 0;
  let bestProjection: Coordinate = route[0];

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];

    const dx = b.longitude - a.longitude;
    const dy = b.latitude - a.latitude;
    const lenSq = dx * dx + dy * dy;

    let t = 0;
    if (lenSq > 0) {
      t =
        ((position.longitude - a.longitude) * dx +
          (position.latitude - a.latitude) * dy) /
        lenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projLat = a.latitude + t * dy;
    const projLng = a.longitude + t * dx;

    const d =
      haversineKm(position.latitude, position.longitude, projLat, projLng) *
      1000;
    if (d < minDist) {
      minDist = d;
      bestIndex = i;
      bestProjection = { latitude: projLat, longitude: projLng };
    }
  }

  return [bestProjection, ...route.slice(bestIndex + 1)];
}

export function polylineDistanceKm(route: Coordinate[]): number {
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += haversineKm(
      route[i].latitude,
      route[i].longitude,
      route[i + 1].latitude,
      route[i + 1].longitude,
    );
  }
  return total;
}

/**
 * Fetch a real walking route via the FOSSGIS pedestrian OSRM server (OSM data).
 * Falls back to the main OSRM driving server, then to a straight-line estimate.
 */
export async function fetchWalkingRoute(
  start: Coordinate,
  end: Coordinate,
): Promise<{ coords: Coordinate[]; distanceMi: number; durationMin: number; isFallback: boolean }> {
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

      return { coords, distanceMi, durationMin, isFallback: false };
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
    isFallback: true,
  };
}
