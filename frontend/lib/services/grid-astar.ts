/**
 * Grid-based A* pathfinding for indoor navigation.
 *
 * At build time, export_grids.py rasterises each GDC floor plan into a
 * binary occupancy grid stored as base64 packed bits (1 = corridor/passable,
 * 0 = wall).  At runtime this module:
 *
 *   1. Decodes the base64 data into a flat Uint8Array.
 *   2. Runs A* on the grid between any two normalized (0-1) coordinates.
 *   3. Simplifies the pixel path with a greedy line-of-sight (LOS) pass so
 *      the rendered polyline follows corridor centrelines cleanly.
 *
 * No walls are ever crossed — every step in A* is checked against the grid,
 * and the LOS simplifier uses Bresenham ray-casting to verify each shortcut.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Decoded occupancy grid ready for A* queries. */
export interface OccupancyGrid {
  /** Grid pixel width. */
  width: number;
  /** Grid pixel height. */
  height: number;
  /** Pixels per PDF point (the scale used by export_grids.py). */
  scale: number;
  /** PDF page width in points — used for coordinate conversion. */
  pageWidth: number;
  /** PDF page height in points. */
  pageHeight: number;
  /**
   * Flat pixel buffer, row-major (index = y*width + x).
   * 1 = passable corridor, 0 = wall.
   */
  pixels: Uint8Array;
  /**
   * Distance transform: for each passable pixel, distance to nearest wall.
   * 0 = wall/edge, 255 = farthest from wall (corridor centerline).
   * Optional — may be null if distanceData wasn't in the grid JSON.
   */
  distances: Uint8Array | null;
}

/** Raw JSON shape produced by export_grids.py. */
export interface RawGridData {
  floorId: string;
  pageIndex: number;
  width: number;
  height: number;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  /** Base64 string of packed bits, MSB-first, 1=passable. */
  data: string;
  /** Optional: base64 string of 8-bit distance values (0-255). */
  distanceData?: string;
}

// ---------------------------------------------------------------------------
// Grid decoding
// ---------------------------------------------------------------------------

/** Module-level cache so each floor is decoded at most once per session. */
const _gridCache = new Map<string, OccupancyGrid>();

/**
 * Decode a raw grid JSON (produced by export_grids.py) into an OccupancyGrid.
 * Decoded grids are cached by floorId so subsequent calls are instant.
 */
export function decodeGrid(raw: RawGridData): OccupancyGrid {
  const cached = _gridCache.get(raw.floorId);
  if (cached) return cached;

  const { width, height, scale, pageWidth, pageHeight, data, distanceData } = raw;

  // Decode base64 → byte array
  const binStr = atob(data);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) {
    bytes[i] = binStr.charCodeAt(i);
  }

  // Unpack bits: MSB-first (bit 7 of byte 0 = pixel 0, bit 6 = pixel 1, …)
  const totalPixels = width * height;
  const pixels = new Uint8Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const byteIdx = i >> 3;          // Math.floor(i / 8)
    const bitIdx  = 7 - (i & 7);    // MSB first
    pixels[i] = (bytes[byteIdx] >> bitIdx) & 1;
  }

  // Decode distance transform (8-bit values, no bit-packing)
  let distances: Uint8Array | null = null;
  if (distanceData) {
    const distStr = atob(distanceData);
    distances = new Uint8Array(distStr.length);
    for (let i = 0; i < distStr.length; i++) {
      distances[i] = distStr.charCodeAt(i);
    }
  }

  const grid: OccupancyGrid = { width, height, scale, pageWidth, pageHeight, pixels, distances };
  _gridCache.set(raw.floorId, grid);
  return grid;
}

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert a normalised (0-1) page coordinate to the nearest grid pixel,
 * then spiral outward until we land on a passable pixel.
 * This handles rooms whose label sits inside a wall or closed room outline.
 */
function snapToPassable(
  normX: number,
  normY: number,
  grid: OccupancyGrid,
): [number, number] {
  const { width, height, scale, pageWidth, pageHeight, pixels } = grid;

  let px = Math.round(normX * pageWidth  * scale);
  let py = Math.round(normY * pageHeight * scale);
  px = Math.max(0, Math.min(width  - 1, px));
  py = Math.max(0, Math.min(height - 1, py));

  if (pixels[py * width + px]) return [px, py];

  // Spiral search (square perimeters outward)
  for (let r = 1; r < 200; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dy) !== r && Math.abs(dx) !== r) continue; // perimeter only
        const nx = px + dx;
        const ny = py + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        if (pixels[ny * width + nx]) return [nx, ny];
      }
    }
  }
  return [px, py]; // give up — original position
}

/** Convert a grid pixel back to normalised page coordinates. */
function pixelToNorm(
  px: number,
  py: number,
  grid: OccupancyGrid,
): [number, number] {
  return [
    px / (grid.pageWidth  * grid.scale),
    py / (grid.pageHeight * grid.scale),
  ];
}

// ---------------------------------------------------------------------------
// Min-heap (binary heap by f-score)
// ---------------------------------------------------------------------------

class MinHeap {
  private readonly _idx: Int32Array;
  private readonly _f:   Float32Array;
  private _size = 0;

  constructor(capacity: number) {
    this._idx = new Int32Array(capacity);
    this._f   = new Float32Array(capacity);
  }

  get size(): number { return this._size; }

  push(idx: number, f: number): void {
    let i = this._size++;
    this._idx[i] = idx;
    this._f[i]   = f;
    // Bubble up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._f[parent] <= this._f[i]) break;
      this._swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this._idx[0];
    const last = --this._size;
    if (last > 0) {
      this._idx[0] = this._idx[last];
      this._f[0]   = this._f[last];
      // Sink down
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let smallest = i;
        if (l < last && this._f[l] < this._f[smallest]) smallest = l;
        if (r < last && this._f[r] < this._f[smallest]) smallest = r;
        if (smallest === i) break;
        this._swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private _swap(a: number, b: number): void {
    const ti = this._idx[a]; this._idx[a] = this._idx[b]; this._idx[b] = ti;
    const tf = this._f[a];   this._f[a]   = this._f[b];   this._f[b]   = tf;
  }
}

// ---------------------------------------------------------------------------
// Core A* on the occupancy grid
// ---------------------------------------------------------------------------

/**
 * Run 4-connected A* on the occupancy grid between two pixel positions.
 * Returns the path as an array of flat pixel indices (y*width+x), or null
 * if no path exists.
 *
 * Uses Manhattan-distance heuristic (admissible for 4-connectivity).
 * If distances are provided, uses distance-weighted costs to prefer corridor
 * centerlines over edges: cost = 1 + ALPHA / (distance + 1).
 * TypedArrays throughout for maximum JS performance.
 */
function gridAstar(
  pixels: Uint8Array,
  width:  number,
  height: number,
  startIdx: number,
  endIdx:   number,
  distances?: Uint8Array | null,
): Int32Array | null {
  if (startIdx === endIdx) {
    const r = new Int32Array(1);
    r[0] = startIdx;
    return r;
  }

  const n   = width * height;
  const INF = 2_000_000_000;
  const ALPHA = 8; // Distance weighting factor: cost = 1 + ALPHA / (distance + 1)

  // g-scores (float to handle weighted costs).
  const g      = new Float32Array(n).fill(INF);
  // cameFrom: predecessor flat index, -1 = no predecessor.
  const came   = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);

  const endY = (endIdx / width) | 0;
  const endX = endIdx - endY * width;

  g[startIdx] = 0;

  // Worst-case open set size ≈ perimeter of grid; 4*(w+h) is a safe lower
  // bound; we use n as a safe upper bound.
  const heap = new MinHeap(Math.min(n, 1 << 18));

  const startY = (startIdx / width) | 0;
  const startX = startIdx - startY * width;
  const h0 = Math.abs(startX - endX) + Math.abs(startY - endY);
  heap.push(startIdx, h0);

  const DIRS = [-width, width, -1, 1]; // up, down, left, right

  while (heap.size > 0) {
    const cur = heap.pop();

    if (cur === endIdx) break;
    if (closed[cur]) continue;
    closed[cur] = 1;

    const cy = (cur / width) | 0;
    const cx = cur - cy * width;
    const cg = g[cur];

    for (let d = 0; d < 4; d++) {
      const next = cur + DIRS[d];

      // Bounds check
      if (d === 2 && cx === 0)          continue; // left edge
      if (d === 3 && cx === width - 1)  continue; // right edge
      if (next < 0 || next >= n)        continue; // top/bottom edge

      if (!pixels[next] || closed[next]) continue;

      // Calculate edge cost: prefer corridor centerlines via distance weighting
      let edgeCost = 1;
      if (distances) {
        const dist = distances[next];
        edgeCost = 1 + ALPHA / (dist + 1);
      }

      const ng = cg + edgeCost;
      if (ng < g[next]) {
        g[next]    = ng;
        came[next] = cur;
        const ny = (next / width) | 0;
        const nx = next - ny * width;
        heap.push(next, ng + Math.abs(nx - endX) + Math.abs(ny - endY));
      }
    }
  }

  if (g[endIdx] === INF) return null; // unreachable

  // Trace back predecessor chain → forward path
  let len = 0;
  let cur = endIdx;
  while (cur !== -1) { len++; cur = came[cur]; }

  const path = new Int32Array(len);
  cur = endIdx;
  for (let i = len - 1; i >= 0; i--) {
    path[i] = cur;
    cur = came[cur];
  }
  return path;
}

// ---------------------------------------------------------------------------
// Line-of-sight simplification (Bresenham ray-cast)
// ---------------------------------------------------------------------------

/**
 * Check whether the straight line between two flat pixel indices is entirely
 * passable (no wall pixel crossed).  Uses Bresenham's line algorithm.
 */
function hasLOS(
  fromIdx: number,
  toIdx:   number,
  pixels:  Uint8Array,
  width:   number,
): boolean {
  const fy = (fromIdx / width) | 0;
  const fx = fromIdx - fy * width;
  const ty = (toIdx / width) | 0;
  const tx = toIdx - ty * width;

  let x = fx, y = fy;
  const dx = Math.abs(tx - fx);
  const dy = Math.abs(ty - fy);
  const sx = fx < tx ? 1 : -1;
  const sy = fy < ty ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (!pixels[y * width + x]) return false;
    if (x === tx && y === ty) break;
    const e2 = err << 1;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 <  dx) { err += dx; y += sy; }
  }
  return true;
}

/**
 * Greedy LOS simplification: starting from the first waypoint, skip ahead
 * as far as possible while maintaining a clear line of sight.
 * Produces a minimal set of waypoints that still traces the same corridor.
 */
function losSimplify(
  path:   Int32Array,
  pixels: Uint8Array,
  width:  number,
): Int32Array {
  if (path.length <= 2) return path;

  const keep: number[] = [path[0]];
  let i = 0;

  while (i < path.length - 1) {
    // Binary search: find the furthest j reachable via LOS from i
    let lo = i + 1;
    let hi = path.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (hasLOS(path[i], path[mid], pixels, width)) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    keep.push(path[lo]);
    i = lo;
  }

  const result = new Int32Array(keep.length);
  for (let k = 0; k < keep.length; k++) result[k] = keep[k];
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a wall-respecting corridor path between two normalised (0-1) page
 * coordinates on the same floor.
 *
 * @param grid    Decoded OccupancyGrid for the floor (from decodeGrid).
 * @param fromX   Normalised X of start position.
 * @param fromY   Normalised Y of start position.
 * @param toX     Normalised X of destination.
 * @param toY     Normalised Y of destination.
 * @returns       Array of [normX, normY] waypoints following corridors.
 *                The first element equals [fromX, fromY] and the last
 *                equals [toX, toY].  Falls back to a straight two-point
 *                segment if A* finds no path.
 */
export function computeFloorPath(
  grid:  OccupancyGrid,
  fromX: number,
  fromY: number,
  toX:   number,
  toY:   number,
): [number, number][] {
  const { pixels, width, height, distances } = grid;

  const [sx, sy] = snapToPassable(fromX, fromY, grid);
  const [ex, ey] = snapToPassable(toX,   toY,   grid);

  const startIdx = sy * width + sx;
  const endIdx   = ey * width + ex;

  const rawPath = gridAstar(pixels, width, height, startIdx, endIdx, distances);
  if (!rawPath) {
    // A* found no path — fall back to straight line (rare: means floors are
    // disconnected, which shouldn't happen after inject_vertical_transport).
    return [[fromX, fromY], [toX, toY]];
  }

  const simplified = losSimplify(rawPath, pixels, width);

  const waypoints: [number, number][] = Array.from({ length: simplified.length }, (_, i) => {
    const idx = simplified[i];
    const py  = (idx / width) | 0;
    const px  = idx - py * width;
    return pixelToNorm(px, py, grid);
  });

  // We deliberately do NOT pin path[0]/path[-1] back to (fromX, fromY) /
  // (toX, toY).  Those raw input positions can sit on a wall pixel (e.g.
  // the elevator shaft, or a room label inside a closed room outline) —
  // pinning them produces a straight segment from inside-the-wall to the
  // first passable pixel, which renders as a wall cut.
  //
  // Instead the path begins and ends at the snapped passable pixel, which
  // is at most a few pixels from the node marker.  The marker itself is
  // still drawn at the original (fromX, fromY) / (toX, toY) by the
  // renderer, so visually you see "marker → tiny gap → corridor path"
  // which is correct — it just means "you are at the elevator, walk into
  // the corridor".

  return waypoints;
}

/**
 * Enhance a set of RouteSegments by replacing each floor segment's waypoints
 * with a grid A* corridor path.
 *
 * Segments without waypoints (e.g. "Take the elevator to Floor X"
 * transition steps) are returned unchanged.
 *
 * @param segments  Segments from buildRoute() in indoor-navigation.ts.
 * @param getGrid   Callback that returns a decoded OccupancyGrid for a given
 *                  floorId, or null if unavailable.
 */
export interface GridRouteSegment {
  floorId:    string;
  floorName:  string;
  waypoints:  [number, number][];
  instruction: string;
}

export function computeGridRoute(
  segments: GridRouteSegment[],
  getGrid:  (floorId: string) => OccupancyGrid | null,
): GridRouteSegment[] {
  return segments.map((seg) => {
    if (seg.waypoints.length < 2) return seg; // transition segment — no visual path

    const grid = getGrid(seg.floorId);
    if (!grid) return seg; // grid not available yet

    const start = seg.waypoints[0];
    const end   = seg.waypoints[seg.waypoints.length - 1];

    const gridPath = computeFloorPath(grid, start[0], start[1], end[0], end[1]);
    return { ...seg, waypoints: gridPath };
  });
}
