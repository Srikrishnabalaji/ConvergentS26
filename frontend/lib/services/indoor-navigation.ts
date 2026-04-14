/**
 * Indoor navigation — loads the building graph JSON and runs A* pathfinding.
 */

// ---------------------------------------------------------------------------
// Types matching the output of parse_floorplan.py
// ---------------------------------------------------------------------------
export interface FloorInfo {
  id: string;
  name: string;
  pageIndex: number;
}

export interface GraphNode {
  id: string;
  floorId: string;
  x: number;
  y: number;
  label: string;
  type: 'room' | 'hallway' | 'stairwell' | 'elevator' | 'door' | 'entrance';
  groupId: string | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  weight: number;
  interFloor: boolean;
  path?: [number, number][];
}

export interface BuildingGraph {
  buildingName: string;
  floors: FloorInfo[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// A* pathfinding on the building graph
// ---------------------------------------------------------------------------

interface AStarResult {
  /** Ordered list of node IDs from start to end */
  nodeIds: string[];
  /** Total weight (distance) of the path */
  totalWeight: number;
}

/**
 * Run A* shortest-path between two node IDs on the building graph.
 * Heuristic: Euclidean distance between node positions.
 * Supports inter-floor edges (stairs/elevators).
 */
export function astar(
  graph: BuildingGraph,
  startId: string,
  endId: string,
): AStarResult | null {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));

  const startNode = nodeMap.get(startId);
  const endNode = nodeMap.get(endId);
  if (!startNode || !endNode) return null;

  // Build adjacency list
  const adj = new Map<string, { neighborId: string; weight: number; edgeId: string }[]>();
  for (const n of graph.nodes) {
    adj.set(n.id, []);
  }
  for (const e of graph.edges) {
    // Use 'distance' field if 'weight' is undefined (newer graphs use distance)
    const w = (e as any).weight ?? (e as any).distance ?? 1;
    adj.get(e.from)?.push({ neighborId: e.to, weight: w, edgeId: e.id });
    adj.get(e.to)?.push({ neighborId: e.from, weight: w, edgeId: e.id });
  }

  // Heuristic: Euclidean distance (normalized coords, so scale doesn't matter for ordering)
  const heuristic = (a: GraphNode, b: GraphNode) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2) * 100;

  // Priority queue (simple binary heap)
  const gScore = new Map<string, number>();
  const fScore = new Map<string, number>();
  const cameFrom = new Map<string, string>();

  gScore.set(startId, 0);
  fScore.set(startId, heuristic(startNode, endNode));

  // Min-heap by fScore
  const openSet: string[] = [startId];
  const inOpen = new Set<string>([startId]);
  const closed = new Set<string>();

  console.log(`[A*] Search from "${startNode.label}" (${startId}) to "${endNode.label}" (${endId})`);
  console.log(`[A*] Start neighbors: ${adj.get(startId)?.length ?? 0} edges`);

  const popMin = (): string | undefined => {
    let minIdx = 0;
    let minF = fScore.get(openSet[0]) ?? Infinity;
    for (let i = 1; i < openSet.length; i++) {
      const f = fScore.get(openSet[i]) ?? Infinity;
      if (f < minF) {
        minF = f;
        minIdx = i;
      }
    }
    const id = openSet[minIdx];
    openSet.splice(minIdx, 1);
    inOpen.delete(id);
    return id;
  };

  while (openSet.length > 0) {
    const currentId = popMin()!;
    if (currentId === endId) {
      // Reconstruct path
      const path: string[] = [endId];
      let cur = endId;
      while (cameFrom.has(cur)) {
        cur = cameFrom.get(cur)!;
        path.push(cur);
      }
      path.reverse();
      return { nodeIds: path, totalWeight: gScore.get(endId) ?? 0 };
    }

    closed.add(currentId);
    const currentG = gScore.get(currentId) ?? Infinity;

    for (const neighbor of adj.get(currentId) ?? []) {
      if (closed.has(neighbor.neighborId)) continue;
      const tentativeG = currentG + neighbor.weight;
      const prevG = gScore.get(neighbor.neighborId) ?? Infinity;
      if (tentativeG < prevG) {
        cameFrom.set(neighbor.neighborId, currentId);
        gScore.set(neighbor.neighborId, tentativeG);
        const nNode = nodeMap.get(neighbor.neighborId)!;
        fScore.set(neighbor.neighborId, tentativeG + heuristic(nNode, endNode));
        if (!inOpen.has(neighbor.neighborId)) {
          openSet.push(neighbor.neighborId);
          inOpen.add(neighbor.neighborId);
        }
      }
    }
  }

  console.log(`[A*] FAILED: No path found. Explored ${closed.size} nodes, ${openSet.length} remaining in queue`);
  return null; // No path found
}

// ---------------------------------------------------------------------------
// Route building helpers
// ---------------------------------------------------------------------------

/** A single segment of a multi-floor route */
export interface RouteSegment {
  floorId: string;
  floorName: string;
  /** Waypoints as normalized [x, y] pairs for drawing on the floor plan */
  waypoints: [number, number][];
  /** Instruction for this segment, e.g. "Walk to room 4.302" or "Take elevator to Floor 4" */
  instruction: string;
}

/**
 * Build a displayable multi-floor route from an A* result.
 * Splits the node path at floor transitions and collects corridor waypoints.
 */
export function buildRoute(
  graph: BuildingGraph,
  pathNodeIds: string[],
): RouteSegment[] {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const floorMap = new Map(graph.floors.map((f) => [f.id, f]));

  // Build quick edge lookup: "nodeA-nodeB" → edge
  const edgeLookup = new Map<string, GraphEdge>();
  for (const e of graph.edges) {
    edgeLookup.set(`${e.from}-${e.to}`, e);
    edgeLookup.set(`${e.to}-${e.from}`, e);
  }

  const segments: RouteSegment[] = [];
  let currentFloorId = nodeMap.get(pathNodeIds[0])!.floorId;
  let currentWaypoints: [number, number][] = [];
  const startNode = nodeMap.get(pathNodeIds[0])!;
  currentWaypoints.push([startNode.x, startNode.y]);

  let i = 0;
  while (i < pathNodeIds.length - 1) {
    const fromNode = nodeMap.get(pathNodeIds[i])!;
    const toNode = nodeMap.get(pathNodeIds[i + 1])!;
    const edge = edgeLookup.get(`${fromNode.id}-${toNode.id}`);

    if (edge?.interFloor) {
      // End current floor segment (walk to elevator/stairs)
      const floorInfo = floorMap.get(currentFloorId)!;
      const transportType = fromNode.type === 'elevator' ? 'elevator' : 'stairs';

      if (currentWaypoints.length > 0) {
        segments.push({
          floorId: currentFloorId,
          floorName: floorInfo.name,
          waypoints: currentWaypoints,
          instruction: `Walk to the ${transportType}`,
        });
      }

      // Consume ALL consecutive inter-floor edges to find the final destination floor.
      // e.g. elevator F1→F2→F3→F4→F5 becomes one step: "Take elevator to Floor 5"
      let lastFloorId = toNode.floorId;
      let j = i + 1;
      while (j < pathNodeIds.length - 1) {
        const nextEdge = edgeLookup.get(
          `${pathNodeIds[j]}-${pathNodeIds[j + 1]}`
        );
        if (!nextEdge?.interFloor) break;
        lastFloorId = nodeMap.get(pathNodeIds[j + 1])!.floorId;
        j++;
      }

      const destFloor = floorMap.get(lastFloorId)!;
      segments.push({
        floorId: currentFloorId,
        floorName: floorInfo.name,
        waypoints: [],
        instruction: `Take the ${transportType} to ${destFloor.name}`,
      });

      // Start new floor segment from where we landed
      currentFloorId = lastFloorId;
      const landingNode = nodeMap.get(pathNodeIds[j])!;
      currentWaypoints = [[landingNode.x, landingNode.y]];
      i = j;
    } else if (edge) {
      // Same-floor edge: add path waypoints
      let pathPoints: [number, number][] = edge.path ?? [];

      // If edge is reversed (from=toNode, to=fromNode), reverse the path
      if (edge.from === toNode.id && pathPoints.length > 0) {
        pathPoints = [...pathPoints].reverse();
      }

      if (pathPoints.length > 0) {
        for (let k = 1; k < pathPoints.length; k++) {
          currentWaypoints.push(pathPoints[k]);
        }
      } else {
        currentWaypoints.push([toNode.x, toNode.y]);
      }
      i++;
    } else {
      i++;
    }
  }

  // Final segment
  if (currentWaypoints.length > 0) {
    const floorInfo = floorMap.get(currentFloorId)!;
    const destNode = nodeMap.get(pathNodeIds[pathNodeIds.length - 1])!;
    const destLabel = destNode.label || 'destination';
    segments.push({
      floorId: currentFloorId,
      floorName: floorInfo.name,
      waypoints: currentWaypoints,
      instruction: `Walk to room ${destLabel}`,
    });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Room search
// ---------------------------------------------------------------------------

/**
 * Search for rooms by label (case-insensitive substring match).
 * Returns matching nodes sorted by label.
 */
export function searchRooms(graph: BuildingGraph, query: string): GraphNode[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase().trim();
  return graph.nodes
    .filter((n) => n.type === 'room' && n.label.toLowerCase().includes(q))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 20);
}

/** Strip calendar-style prefixes so "Room 4.302" and "4.302" behave the same. */
export function normalizeRoomSearchQuery(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:room|rm|ste|suite|#)\s*/i, '')
    .trim()
    .replace(/\s*\.\s*/g, '.');
}

/**
 * Resolve a calendar / deep-link room string to a graph node. Uses substring
 * search first, then compact alphanumeric equality, then fuzzy N.NNN matching
 * (GDC-style labels) so slightly wrong or missing numbers still land near the
 * intended room.
 */
export function resolveRoomFromQuery(graph: BuildingGraph, rawQuery: string): GraphNode | null {
  const q0 = normalizeRoomSearchQuery(rawQuery);
  if (!q0) return null;

  const substringHits = searchRooms(graph, q0);
  if (substringHits.length > 0) return substringHits[0];

  const rooms = graph.nodes.filter((n) => n.type === 'room');
  const qLower = q0.toLowerCase();
  const qCompact = qLower.replace(/[^a-z0-9]/g, '');
  if (qCompact.length >= 2) {
    for (const n of rooms) {
      const c = n.label.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (c === qCompact) return n;
    }
  }

  const dotted = q0.match(/^(\d+)\.(\d+)([a-z]?)$/i);
  if (dotted) {
    const floorPart = String(parseInt(dotted[1], 10));
    const roomPart = parseInt(dotted[2], 10);
    const suffix = (dotted[3] || '').toLowerCase();
    const prefix = `${floorPart}.`;
    const onFloor = rooms.filter((n) => n.label.toLowerCase().startsWith(prefix.toLowerCase()));
    if (onFloor.length > 0) {
      const exactLbl = `${floorPart}.${roomPart}${dotted[3] || ''}`;
      const exact = onFloor.find((n) => n.label.toLowerCase() === exactLbl.toLowerCase());
      if (exact) return exact;

      let best: GraphNode | null = null;
      let bestD = Infinity;
      for (const n of onFloor) {
        const rm = n.label.match(/^(\d+)\.(\d+)([a-z]?)$/i);
        if (!rm) continue;
        const sfx = (rm[3] || '').toLowerCase();
        if (suffix && sfx !== suffix) continue;
        const num = parseInt(rm[2], 10);
        const d = Math.abs(num - roomPart);
        if (d < bestD) {
          bestD = d;
          best = n;
        }
      }
      if (best && bestD <= 12) return best;
    }
  }

  return null;
}

/**
 * Find the best starting node on a given floor.
 * Picks the most-connected node (highest edge count) so A* can actually
 * route from it. Falls back to type-based preference if edge data is missing.
 */
export function findEntrance(graph: BuildingGraph, floorId: string): GraphNode | null {
  const floorNodes = graph.nodes.filter((n) => n.floorId === floorId);
  if (floorNodes.length === 0) return null;

  // Prefer entrance/door types if they exist
  const byType =
    floorNodes.find((n) => n.type === 'entrance') ??
    floorNodes.find((n) => n.type === 'door');
  if (byType) return byType;

  // Otherwise pick the node with the most edges (best connected = likely a
  // hallway junction or central room that can reach the most other nodes)
  const floorIds = new Set(floorNodes.map((n) => n.id));
  const edgeCount = new Map<string, number>();
  for (const e of graph.edges) {
    if (floorIds.has(e.from)) edgeCount.set(e.from, (edgeCount.get(e.from) ?? 0) + 1);
    if (floorIds.has(e.to)) edgeCount.set(e.to, (edgeCount.get(e.to) ?? 0) + 1);
  }

  let best: GraphNode | null = null;
  let bestCount = -1;
  for (const n of floorNodes) {
    const c = edgeCount.get(n.id) ?? 0;
    if (c > bestCount) {
      bestCount = c;
      best = n;
    }
  }
  return best;
}

/**
 * Find the nearest node of a given type to a target position on a floor.
 */
export function findNearest(
  graph: BuildingGraph,
  floorId: string,
  x: number,
  y: number,
  type?: GraphNode['type'],
): GraphNode | null {
  const candidates = graph.nodes.filter(
    (n) => n.floorId === floorId && (!type || n.type === type),
  );
  if (candidates.length === 0) return null;

  let best = candidates[0];
  let bestDist = (best.x - x) ** 2 + (best.y - y) ** 2;
  for (const n of candidates) {
    const d = (n.x - x) ** 2 + (n.y - y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}
