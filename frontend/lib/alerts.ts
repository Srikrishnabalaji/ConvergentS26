export type AlertType =
  | 'crowd'
  | 'construction'
  | 'elevator_down'
  | 'building_closure'
  | 'hazard'
  | 'other';

export type AlertVoteValue = 'confirm' | 'deny';

export interface CampusAlert {
  id: string;
  type: AlertType;
  floor_id: string;
  x: number;
  y: number;
  description: string | null;
  submitted_by: string;
  created_at: string;
  expires_at: string;
}

export interface AlertVote {
  id: string;
  alert_id: string;
  user_id: string;
  vote: AlertVoteValue;
  created_at: string;
}

export interface AlertWithVotes extends CampusAlert {
  confirm_count: number;
  deny_count: number;
}

/** Minutes until expiry for each alert type */
export const ALERT_EXPIRY_MINUTES: Record<AlertType, number> = {
  crowd: 30,
  construction: 72 * 60,
  elevator_down: 24 * 60,
  building_closure: 8 * 60,
  hazard: 30,
  other: 60,
};

export const ALERT_LABELS: Record<AlertType, string> = {
  crowd: 'Crowd',
  construction: 'Construction',
  elevator_down: 'Elevator Down',
  building_closure: 'Building Closure',
  hazard: 'Hazard',
  other: 'Other',
};

export const ALERT_COLORS: Record<AlertType, string> = {
  crowd:            '#D89E3A', // amber  — caution/high traffic
  construction:     '#C08A5E', // sand   — earthy/worksite
  elevator_down:    '#8B5470', // plum   — out-of-service
  building_closure: '#B85A38', // clay   — serious/closed
  hazard:           '#D26A4A', // coral  — most urgent
  other:            '#2A8AA5', // aqua   — neutral info
};

export const ALERT_ICONS: Record<AlertType, string> = {
  crowd: 'people',
  construction: 'construction',
  elevator_down: 'block',
  building_closure: 'lock',
  hazard: 'warning',
  other: 'info',
};

export const ALL_ALERT_TYPES: AlertType[] = [
  'crowd',
  'construction',
  'elevator_down',
  'building_closure',
  'hazard',
  'other',
];

// Normalized-coordinate radius for grouping same-type alerts on the same floor.
// ~6 % of floor-plan width — roughly one or two rooms apart.
export const CLUSTER_RADIUS = 0.06;

export interface AlertCluster {
  /** Lead alert's ID — stable across renders, used as the React key and vote target */
  id: string;
  type: AlertType;
  floor_id: string;
  /** Centroid of all member coordinates */
  x: number;
  y: number;
  /** Timestamp of the most-recently submitted member */
  created_at: string;
  /** Furthest expiry among members */
  expires_at: string;
  members: AlertWithVotes[];
  /** Votes aggregated across all members */
  confirm_count: number;
  deny_count: number;
  /** Unique submitter IDs across all members */
  submitter_ids: string[];
  description: string | null;
}

/**
 * Groups `alerts` into spatial clusters of the same type on the same floor.
 * Processes oldest-first so the earliest report is always the cluster seed/lead.
 * Individual alerts are not mutated — the cluster is a pure computed view.
 */
export function clusterAlerts(alerts: AlertWithVotes[]): AlertCluster[] {
  const sorted = [...alerts].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  const assigned = new Set<string>();
  const result: AlertCluster[] = [];

  for (const seed of sorted) {
    if (assigned.has(seed.id)) continue;

    const members = sorted.filter(
      (a) =>
        !assigned.has(a.id) &&
        a.type === seed.type &&
        a.floor_id === seed.floor_id &&
        Math.hypot(a.x - seed.x, a.y - seed.y) < CLUSTER_RADIUS,
    );
    for (const m of members) assigned.add(m.id);

    const cx = members.reduce((s, a) => s + a.x, 0) / members.length;
    const cy = members.reduce((s, a) => s + a.y, 0) / members.length;

    result.push({
      id: seed.id,
      type: seed.type,
      floor_id: seed.floor_id,
      x: cx,
      y: cy,
      created_at: members.reduce(
        (latest, a) => (a.created_at > latest ? a.created_at : latest),
        seed.created_at,
      ),
      expires_at: members.reduce(
        (latest, a) => (a.expires_at > latest ? a.expires_at : latest),
        seed.expires_at,
      ),
      members,
      confirm_count: members.reduce((s, a) => s + a.confirm_count, 0),
      deny_count: members.reduce((s, a) => s + a.deny_count, 0),
      submitter_ids: [...new Set(members.map((m) => m.submitted_by))],
      description: seed.description,
    });
  }

  return result;
}
