import { useMemo, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import type { RouteSegment } from '@/lib/services/indoor-navigation';
import type { AlertWithVotes } from '@/lib/alerts';
import { ALERT_LABELS } from '@/lib/alerts';

// How long after a new route is calculated to wait before reading alerts.
// Gives Supabase time to finish loading so all alerts are captured at once.
const ROUTE_SETTLE_MS = 600;

// Threshold in normalized coords (~4% of floor plan width) for "on the route"
const PATH_ALERT_THRESHOLD = 0.04;

function pointToSegmentDist(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function alertIsOnPath(alert: AlertWithVotes, routeSegments: RouteSegment[]): boolean {
  const floorSegments = routeSegments.filter((s) => s.floorId === alert.floor_id);
  for (const seg of floorSegments) {
    const wp = seg.waypoints;
    for (let i = 0; i < wp.length - 1; i++) {
      const [ax, ay] = wp[i];
      const [bx, by] = wp[i + 1];
      if (pointToSegmentDist(alert.x, alert.y, ax, ay, bx, by) < PATH_ALERT_THRESHOLD) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns alerts whose (x, y) lies within PATH_ALERT_THRESHOLD of the current
 * route. When a new alert crosses the path for the first time this session,
 * fires an in-app Alert.alert for each new crossing.
 */
export function usePathAlerts(
  routeSegments: RouteSegment[],
  alerts: AlertWithVotes[],
  currentUserId: string | null,
): AlertWithVotes[] {
  // Keep a fresh ref to alerts so the timer callback always sees the latest data
  const alertsRef = useRef(alerts);
  alertsRef.current = alerts;

  const pathAlerts = useMemo(() => {
    if (routeSegments.length === 0 || alerts.length === 0) return [];
    return alerts.filter((a) => alertIsOnPath(a, routeSegments));
  }, [routeSegments, alerts]);

  // Fire at most once per route: trigger only when routeSegments changes,
  // then wait for alerts to finish loading before reading them.
  useEffect(() => {
    if (routeSegments.length === 0) return;

    const timer = setTimeout(() => {
      const onPath = alertsRef.current.filter((a) => alertIsOnPath(a, routeSegments));
      const toShow = onPath.filter((a) => a.submitted_by !== currentUserId);
      if (toShow.length === 0) return;

      const title =
        toShow.length === 1
          ? `${ALERT_LABELS[toShow[0].type]} on your route`
          : 'Alerts on your route';

      Alert.alert(title, 'Tap a pin on the map to confirm or dismiss it.');
    }, ROUTE_SETTLE_MS);

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeSegments, currentUserId]);

  return pathAlerts;
}
