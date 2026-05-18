import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView as RNScrollView,
  Platform,
  Pressable,
} from 'react-native';
import { ScrollView as MapScrollView } from 'react-native-gesture-handler';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { FloorPlanImage } from './FloorPlanImage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Pedometer, Magnetometer, Accelerometer } from 'expo-sensors';
import {
  type BuildingGraph,
  type GraphNode,
  type RouteSegment,
  astar,
  buildRoute,
  searchRooms,
  resolveRoomFromQuery,
  findNearest,
} from '@/lib/services/indoor-navigation';
import {
  decodeGrid,
  computeGridRoute,
  type OccupancyGrid,
  type RawGridData,
} from '@/lib/services/grid-astar';
// ---------------------------------------------------------------------------
// Pre-bundled occupancy grids (produced by backend/export_grids.py).
// Loaded as static JSON assets; decoded once and cached in _decodedGrids.
// ---------------------------------------------------------------------------

const RAW_FLOOR_GRIDS: Record<string, RawGridData> = {
  f0: require('@/assets/grids/gdc_f0.json'),
  f1: require('@/assets/grids/gdc_f1.json'),
  f2: require('@/assets/grids/gdc_f2.json'),
  f3: require('@/assets/grids/gdc_f3.json'),
  f4: require('@/assets/grids/gdc_f4.json'),
  f5: require('@/assets/grids/gdc_f5.json'),
  f6: require('@/assets/grids/gdc_f6.json'),
};
// Decoded (bit-unpacked) grids — populated lazily on first use per floor.
const _decodedGrids: Record<string, OccupancyGrid> = {};

const SCREEN = Dimensions.get('window');
const PRIMARY = '#0B617E';
const PAGE_BG = '#f4f7f9';
const CARD_BORDER = '#e8eef2';
const TEXT_PRIMARY = '#0f172a';
const TEXT_MUTED = '#64748b';

// Cropped image dimensions (from extract_floor_images.py)
const IMAGE_ASPECT = 2878 / 1546; // ≈ 1.862 (width / height)

/** Extra scale so the plan starts noticeably zoomed; user pans (and pinches on iOS) to see more. */
const MAP_DISPLAY_SCALE = 1.38;

const MAP_ZOOM_MIN_MUL = 0.82;
const MAP_ZOOM_MAX_MUL = 2.05;
const MAP_ZOOM_STEP = 0.14;

/**
 * Size that covers the viewport (object-fit: cover) so the floor plan fills the tree
 * instead of letterboxing on tall phones. ScrollView then allows panning to edges.
 */
function coverSize(boxW: number, boxH: number, contentAspect: number): { w: number; h: number } {
  if (boxW <= 0 || boxH <= 0) return { w: 0, h: 0 };
  const boxAspect = boxW / boxH;
  if (boxAspect > contentAspect) {
    const w = boxW;
    const h = w / contentAspect;
    if (h >= boxH) return { w, h };
    const h2 = boxH;
    return { w: h2 * contentAspect, h: h2 };
  }
  const h = boxH;
  const w = h * contentAspect;
  if (w >= boxW) return { w, h };
  const w2 = boxW;
  return { w: w2, h: w2 / contentAspect };
}

// The crop rectangle used to extract images (fractions of the full PDF page).
// Node coordinates in the JSON are normalized to the FULL page, so we need to
// remap them into the cropped image space.
const CROP = { left: 0.03, top: 0.06, right: 0.97, bottom: 0.84 };
const CROP_W = CROP.right - CROP.left;   // 0.94
const CROP_H = CROP.bottom - CROP.top;   // 0.78

/** Convert a node's normalized (0-1) coordinate to cropped-image pixel position */
function toImageX(nx: number, imgW: number): number {
  return ((nx - CROP.left) / CROP_W) * imgW;
}
function toImageY(ny: number, imgH: number): number {
  return ((ny - CROP.top) / CROP_H) * imgH;
}

/** Inverse of toImageX/Y: convert a pixel tap position back to normalized coords */
function fromImageX(px: number, imgW: number): number {
  return (px / imgW) * CROP_W + CROP.left;
}
function fromImageY(py: number, imgH: number): number {
  return (py / imgH) * CROP_H + CROP.top;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
type Props = {
  graph: BuildingGraph;
  onExit: () => void;
  initialDestination?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function IndoorMapView({ graph, onExit, initialDestination }: Props) {
  // Active floor — default to Floor 2 (f1) where the main entrance is
  const [activeFloorId, setActiveFloorId] = useState('f1');

  // Room search
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  // Start / destination
  const [startNode, setStartNode] = useState<GraphNode | null>(null);
  const [destNode, setDestNode] = useState<GraphNode | null>(null);
  const [selectingFor, setSelectingFor] = useState<'start' | 'dest'>('dest');

  // Route
  const [routeSegments, setRouteSegments] = useState<RouteSegment[]>([]);
  const [activeSegmentIdx, setActiveSegmentIdx] = useState(0);
  const [routeError, setRouteError] = useState('');

  // Pedometer tracking + simulation state
  const [isTracking, setIsTracking] = useState(false);
  const [trackingMode, setTrackingMode] = useState<'off' | 'live' | 'sim'>('off');
  const [userPos, setUserPos] = useState<{ x: number; y: number; floorId: string } | null>(null);
  const [debugSteps, setDebugSteps] = useState(0);
  const [debugDistM, setDebugDistM] = useState(0);
  const [debugDirState, setDebugDirState] = useState<'calibrating' | 'forward' | 'backward' | 'sideways' | 'idle'>('idle');
  const pedometerSubRef = useRef<ReturnType<typeof Pedometer.watchStepCount> | null>(null);
  const magnetometerSubRef = useRef<ReturnType<typeof Magnetometer.addListener> | null>(null);
  const accelerometerSubRef = useRef<ReturnType<typeof Accelerometer.addListener> | null>(null);
  const lastStepCountRef = useRef<number | null>(null);
  const distAlongPathRef = useRef(0);
  // Accelerometer-based step detection (real-time; iOS Pedometer is too laggy)
  const accelStepCountRef = useRef(0);
  const accelWasAboveRef = useRef(false);
  const accelLastStepTimeRef = useRef(0);
  const ACCEL_STEP_THRESHOLD = 0.18; // G's above 1.0 baseline
  const ACCEL_MIN_STEP_INTERVAL_MS = 280; // ~214 steps/min max
  // Magnetometer heading state
  const headingRef = useRef<number | null>(null); // raw compass heading from magnetometer, degrees 0-360
  const calibrationOffsetRef = useRef<number | null>(null); // offset between raw heading and floor-plan "path forward"
  const calibrationStepsRef = useRef(0);
  const calibrationSumRef = useRef(0); // running sum of (rawHeading - pathDir) during calibration
  const CALIBRATION_STEPS = 8;
  // Generous "forward" cone — magnetometer is noisy indoors so we bias toward
  // advancing the dot. Anything not clearly opposite the path is treated as forward.
  const FORWARD_CONE_DEG = 90;
  // Tight "backward" cone — only near-opposite heading triggers a rewind, which
  // prevents getting stuck after a noisy reading.
  const BACKWARD_CONE_DEG = 40;
  // Look-ahead window for path-direction calculation (meters). Smooths out
  // jagged short segments so we compare against the overall corridor direction.
  const PATH_LOOKAHEAD_M = 3;
  const STEP_LENGTH_M = 0.75; // meters per step
  const PAGE_W_M = 100; // GDC floor plan ~100m wide
  const PAGE_H_M = 80;  // ~80m tall

  // Placement flow: when the destination came from outside (e.g. a calendar
  // event), we ask the user to drop a pin for their starting location before
  // computing the route.
  //   'idle'   - normal manual flow (no external destination)
  //   'prompt' - showing the "Drop a pin or use main entrance" card
  //   'tap'    - user chose to drop a pin; tapping the floor plan picks the start
  const [placementMode, setPlacementMode] = useState<'idle' | 'prompt' | 'tap'>('idle');
  // Pre-fetched destination from props (kept across re-renders so we don't
  // overwrite the user's choices later)
  const externalDestRef = useRef<GraphNode | null>(null);

  useEffect(() => {
    const raw = initialDestination?.trim();
    if (!raw) return;
    const dest = resolveRoomFromQuery(graph, raw);
    if (!dest) return;
    externalDestRef.current = dest;
    setDestNode(dest);
    setActiveFloorId(dest.floorId);
    // Surface the placement prompt so the user picks their starting position
    setPlacementMode('prompt');
  }, [initialDestination, graph]);

  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<React.ComponentRef<typeof MapScrollView>>(null);

  const [mapViewport, setMapViewport] = useState<{ w: number; h: number } | null>(null);
  const [scrollViewport, setScrollViewport] = useState({ w: 0, h: 0 });
  const [mapZoomMul, setMapZoomMul] = useState(1);

  const bumpMapZoom = useCallback((delta: number) => {
    setMapZoomMul((z) => {
      const n = Math.round((z + delta) * 100) / 100;
      return Math.min(MAP_ZOOM_MAX_MUL, Math.max(MAP_ZOOM_MIN_MUL, n));
    });
  }, []);

  const { imageWidth, imageHeight } = useMemo(() => {
    const pad = 24;
    const fallbackW = Math.max(0, SCREEN.width - pad);
    const fallbackH = Math.max(200, SCREEN.height * 0.42);
    const boxW = mapViewport?.w ?? fallbackW;
    const boxH = mapViewport?.h ?? fallbackH;
    const { w, h } = coverSize(boxW, boxH, IMAGE_ASPECT);
    const mul = MAP_DISPLAY_SCALE * mapZoomMul;
    return {
      imageWidth: Math.round(w * mul),
      imageHeight: Math.round(h * mul),
    };
  }, [mapViewport, mapZoomMul]);

  // Start scrolled to center so the building (and route) are in view, not top-left.
  useEffect(() => {
    if (scrollViewport.w < 8 || imageWidth < 8) return;
    const x = Math.max(0, (imageWidth - scrollViewport.w) / 2);
    const y = Math.max(0, (imageHeight - scrollViewport.h) / 2);
    scrollRef.current?.scrollTo({ x, y, animated: false });
  }, [activeFloorId, imageWidth, imageHeight, scrollViewport.w, scrollViewport.h, mapZoomMul]);

  // ------ Search ------
  const searchResults = useMemo(
    () => (isSearching ? searchRooms(graph, searchQuery) : []),
    [graph, searchQuery, isSearching],
  );

  const handleSelectRoom = useCallback(
    (node: GraphNode) => {
      if (selectingFor === 'dest') {
        setDestNode(node);
        // Auto-switch to that floor so user sees where it is
        setActiveFloorId(node.floorId);
      } else {
        setStartNode(node);
        setActiveFloorId(node.floorId);
      }
      setIsSearching(false);
      setSearchQuery('');
      setRouteError('');
    },
    [selectingFor],
  );

  // ------ Entrance accessor ------
  const getEntrance = useCallback((): GraphNode | null => {
    return graph.nodes.find((n) => n.id === 'entrance-f1') ?? null;
  }, [graph]);

  // ------ Grid accessor (lazy decode + cache) ------
  const getGrid = useCallback((floorId: string): OccupancyGrid | null => {
    if (_decodedGrids[floorId]) return _decodedGrids[floorId];
    const raw = RAW_FLOOR_GRIDS[floorId];
    if (!raw) return null;
    _decodedGrids[floorId] = decodeGrid(raw);
    return _decodedGrids[floorId];
  }, []);

  // ------ Calculate route ------
  const computeRoute = useCallback(
    (start: GraphNode, dest: GraphNode) => {
      setRouteError('');
      const result = astar(graph, start.id, dest.id);
      if (!result) {
        setRouteError(
          'No route found — floors may not be connected yet. Try a room on the same floor as your start.',
        );
        return false;
      }
      // Build node-level route segments (waypoints = node positions only).
      const segments = buildRoute(graph, result.nodeIds);
      // Replace each floor segment's waypoints with wall-respecting grid A*
      // corridor paths. Falls back to straight-line if grid is unavailable.
      const enhanced = computeGridRoute(segments, getGrid);
      setRouteSegments(enhanced);
      setActiveSegmentIdx(0);
      const firstFloor = enhanced.find((s) => s.waypoints.length > 0);
      if (firstFloor) setActiveFloorId(firstFloor.floorId);
      return true;
    },
    [graph, getGrid],
  );

  const handleNavigate = useCallback(() => {
    if (!destNode) return;
    // Default start: main entrance on Floor 2
    const start = startNode ?? getEntrance();
    if (!start) return;
    computeRoute(start, destNode);
  }, [startNode, destNode, computeRoute, getEntrance]);

  // ------ Placement flow handlers ------
  const handleUseMainEntrance = useCallback(() => {
    const dest = destNode ?? externalDestRef.current;
    if (!dest) return;
    const entrance = getEntrance();
    if (!entrance) return;
    setStartNode(entrance);
    setActiveFloorId(entrance.floorId);
    setPlacementMode('idle');
    computeRoute(entrance, dest);
  }, [destNode, computeRoute, getEntrance]);

  const handleEnterTapMode = useCallback(() => {
    setPlacementMode('tap');
  }, []);

  const handleFloorPlanTap = useCallback(
    (e: { nativeEvent: { locationX: number; locationY: number } }) => {
      if (placementMode !== 'tap') return;
      const dest = destNode ?? externalDestRef.current;
      if (!dest) return;
      const { locationX, locationY } = e.nativeEvent;
      // Convert pixel tap into the graph's normalized (0-1) coords
      const nx = fromImageX(locationX, imageWidth);
      const ny = fromImageY(locationY, imageHeight);
      const nearest = findNearest(graph, activeFloorId, nx, ny);
      if (!nearest) return;
      setStartNode(nearest);
      setPlacementMode('idle');
      computeRoute(nearest, dest);
    },
    [placementMode, destNode, imageWidth, imageHeight, graph, activeFloorId, computeRoute],
  );

  // Clear route
  const handleClearRoute = useCallback(() => {
    setRouteSegments([]);
    setActiveSegmentIdx(0);
    setDestNode(null);
    setStartNode(null);
    setRouteError('');
    externalDestRef.current = null;
    setPlacementMode('idle');
    // Stop tracking if active
    pedometerSubRef.current?.remove();
    pedometerSubRef.current = null;
    magnetometerSubRef.current?.remove();
    magnetometerSubRef.current = null;
    accelerometerSubRef.current?.remove();
    accelerometerSubRef.current = null;
    accelStepCountRef.current = 0;
    accelWasAboveRef.current = false;
    accelLastStepTimeRef.current = 0;
    headingRef.current = null;
    calibrationOffsetRef.current = null;
    calibrationStepsRef.current = 0;
    calibrationSumRef.current = 0;
    lastStepCountRef.current = null;
    distAlongPathRef.current = 0;
    setIsTracking(false);
    setTrackingMode('off');
    setUserPos(null);
    setDebugDirState('idle');
  }, []);

  // Build a flat list of {x, y, floorId, cumDist} from all route segments
  const flatPath = useMemo(() => {
    if (routeSegments.length === 0) return [];
    const pts: { x: number; y: number; floorId: string; cumDist: number }[] = [];
    let cumDist = 0;
    for (const seg of routeSegments) {
      if (seg.waypoints.length === 0) continue;
      for (let i = 0; i < seg.waypoints.length; i++) {
        const [x, y] = seg.waypoints[i];
        if (pts.length > 0) {
          const prev = pts[pts.length - 1];
          const dx = (x - prev.x) * PAGE_W_M;
          const dy = (y - prev.y) * PAGE_H_M;
          cumDist += Math.sqrt(dx * dx + dy * dy);
        }
        pts.push({ x, y, floorId: seg.floorId, cumDist });
      }
    }
    return pts;
  }, [routeSegments]);

  const totalPathM = flatPath.length > 0 ? flatPath[flatPath.length - 1].cumDist : 0;

  // Find the path direction at a given walked distance, averaged over the
  // PATH_LOOKAHEAD_M window ahead. Returns degrees (0 = path going right,
  // 90 = path going down). This is more stable than reading just the current
  // segment, which can be very short.
  const getPathDirectionAtDist = useCallback((distM: number): number | null => {
    if (flatPath.length < 2) return null;
    const startD = Math.max(0, Math.min(distM, totalPathM));
    const endD = Math.min(totalPathM, startD + PATH_LOOKAHEAD_M);
    // Find positions at startD and endD via the same binary-search method.
    const lookup = (target: number) => {
      let lo = 0, hi = flatPath.length - 1;
      while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (flatPath[mid].cumDist <= target) lo = mid; else hi = mid;
      }
      const a = flatPath[lo];
      const b = flatPath[hi];
      const segLen = b.cumDist - a.cumDist;
      if (segLen < 0.001) return { x: a.x, y: a.y };
      const t = (target - a.cumDist) / segLen;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    };
    const a = lookup(startD);
    const b = lookup(endD);
    const dx = (b.x - a.x) * PAGE_W_M;
    const dy = (b.y - a.y) * PAGE_H_M;
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    return deg;
  }, [flatPath, totalPathM]);

  // Shortest angular distance between two compass-style angles in degrees.
  // Returns 0..180.
  const angularDist = (a: number, b: number): number => {
    const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
    return d;
  };

  // Given distance walked (meters), find position on path
  const getPosAtDist = useCallback((distM: number) => {
    if (flatPath.length === 0) return null;
    const clamped = Math.min(distM, totalPathM);
    // Binary search for segment
    let lo = 0, hi = flatPath.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (flatPath[mid].cumDist <= clamped) lo = mid; else hi = mid;
    }
    const a = flatPath[lo];
    const b = flatPath[hi];
    const segLen = b.cumDist - a.cumDist;
    if (segLen < 0.001) return { x: b.x, y: b.y, floorId: b.floorId };
    const t = (clamped - a.cumDist) / segLen;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      floorId: t < 0.5 ? a.floorId : b.floorId,
    };
  }, [flatPath, totalPathM]);

  // --- Live pedometer tracking (Phase 1) ---
  const handleStartLiveTracking = useCallback(async () => {
    if (flatPath.length < 2) {
      alert('No route to track yet.');
      return;
    }
    try {
      // Request motion permission first — missing this was the crash cause
      const { status } = await Pedometer.requestPermissionsAsync();
      if (status !== 'granted') {
        alert('Motion permission denied. Go to Settings → WavePoint → Motion & Fitness to enable.');
        return;
      }
      const avail = await Pedometer.isAvailableAsync();
      if (!avail) {
        alert('Pedometer not available on this device. Try the Simulate option instead.');
        return;
      }

      const total = totalPathM;
      const startPos = flatPath[0];
      distAlongPathRef.current = 0;
      lastStepCountRef.current = null;
      headingRef.current = null;
      calibrationOffsetRef.current = null;
      calibrationStepsRef.current = 0;
      calibrationSumRef.current = 0;
      setUserPos({ x: startPos.x, y: startPos.y, floorId: startPos.floorId });
      setActiveFloorId(startPos.floorId);
      setDebugDirState('calibrating');
      setTrackingMode('live');
      setIsTracking(true);

      // Magnetometer: derive compass heading from the horizontal magnetic field.
      // Coordinate frame here is the device-frame; calibration absorbs the
      // offset between this and the floor plan's "up".
      Magnetometer.setUpdateInterval(100);
      magnetometerSubRef.current = Magnetometer.addListener((data) => {
        let h = (Math.atan2(data.y, data.x) * 180) / Math.PI;
        if (h < 0) h += 360;
        // Light smoothing to reduce jitter, but responsive enough to catch turns.
        // We smooth in vector space (using sin/cos) so the average is correct
        // across the 0°/360° wrap.
        const prev = headingRef.current;
        if (prev === null) {
          headingRef.current = h;
          return;
        }
        const alpha = 0.5;
        const prevRad = (prev * Math.PI) / 180;
        const hRad = (h * Math.PI) / 180;
        const sx = Math.cos(prevRad) * (1 - alpha) + Math.cos(hRad) * alpha;
        const sy = Math.sin(prevRad) * (1 - alpha) + Math.sin(hRad) * alpha;
        let smoothed = (Math.atan2(sy, sx) * 180) / Math.PI;
        if (smoothed < 0) smoothed += 360;
        headingRef.current = smoothed;
      });

      // Shared step-handler — called by accelerometer (real-time) and pedometer
      // (lagged, used only as a sanity counter for the debug display).
      const handleSteps = (delta: number) => {
        if (delta <= 0) return;
        const pathDir = getPathDirectionAtDist(distAlongPathRef.current);
        const rawHeading = headingRef.current;

        if (calibrationOffsetRef.current === null) {
          if (pathDir !== null && rawHeading !== null) {
            let diff = ((rawHeading - pathDir) % 360 + 360) % 360;
            calibrationSumRef.current += diff;
          }
          calibrationStepsRef.current += delta;
          distAlongPathRef.current = Math.min(
            total,
            distAlongPathRef.current + delta * STEP_LENGTH_M,
          );
          if (calibrationStepsRef.current >= CALIBRATION_STEPS) {
            const samples = Math.max(1, calibrationStepsRef.current);
            calibrationOffsetRef.current = calibrationSumRef.current / samples;
            setDebugDirState('forward');
            console.log('[Phase2] Calibrated. Offset=', calibrationOffsetRef.current);
          }
        } else {
          if (pathDir === null || rawHeading === null) {
            distAlongPathRef.current = Math.min(
              total,
              distAlongPathRef.current + delta * STEP_LENGTH_M,
            );
            setDebugDirState('forward');
          } else {
            const userDirOnPath = ((rawHeading - calibrationOffsetRef.current) % 360 + 360) % 360;
            const backwardDiff = angularDist(userDirOnPath, (pathDir + 180) % 360);
            const forwardDiff = angularDist(userDirOnPath, pathDir);
            if (backwardDiff <= BACKWARD_CONE_DEG) {
              distAlongPathRef.current = Math.max(
                0,
                distAlongPathRef.current - delta * STEP_LENGTH_M,
              );
              setDebugDirState('backward');
            } else if (forwardDiff <= FORWARD_CONE_DEG) {
              distAlongPathRef.current = Math.min(
                total,
                distAlongPathRef.current + delta * STEP_LENGTH_M,
              );
              setDebugDirState('forward');
            } else {
              setDebugDirState('sideways');
            }
          }
        }

        setDebugDistM(distAlongPathRef.current);
        const pos = getPosAtDist(distAlongPathRef.current);
        if (pos) {
          setUserPos(pos);
          setActiveFloorId(pos.floorId);
        }
      };

      // Accelerometer step detection — gives real-time updates (every ~50ms)
      // unlike iOS Pedometer which batches by 1-2+ seconds. Rising-edge peak
      // detection on |a| above gravity, debounced by minimum stride interval.
      accelStepCountRef.current = 0;
      accelWasAboveRef.current = false;
      accelLastStepTimeRef.current = 0;
      Accelerometer.setUpdateInterval(50);
      accelerometerSubRef.current = Accelerometer.addListener((data) => {
        const magnitude = Math.sqrt(data.x * data.x + data.y * data.y + data.z * data.z);
        const aboveThreshold = magnitude > 1.0 + ACCEL_STEP_THRESHOLD;
        const now = Date.now();
        if (
          aboveThreshold &&
          !accelWasAboveRef.current &&
          now - accelLastStepTimeRef.current > ACCEL_MIN_STEP_INTERVAL_MS
        ) {
          accelLastStepTimeRef.current = now;
          accelStepCountRef.current += 1;
          setDebugSteps(accelStepCountRef.current);
          handleSteps(1);
        }
        accelWasAboveRef.current = aboveThreshold;
      });

      // Pedometer kept only as a reference — we no longer drive position from it.
      pedometerSubRef.current = Pedometer.watchStepCount((result) => {
        const prev = lastStepCountRef.current;
        if (prev === null) lastStepCountRef.current = 0;
        const baseline = lastStepCountRef.current ?? 0;
        const delta = result.steps - baseline;
        if (delta <= 0) return;
        lastStepCountRef.current = result.steps;
        // No position update — accelerometer drives that now.
      });
    } catch (e: any) {
      console.warn('[Tracking] Error:', e);
      alert('Could not start tracking: ' + (e?.message ?? String(e)));
      setIsTracking(false);
      setTrackingMode('off');
    }
  }, [flatPath, totalPathM, getPosAtDist, getPathDirectionAtDist]);

  // --- Simulation mode (auto-advance for demo) ---
  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simStepsRef = useRef(0);

  const handleStartSimulation = useCallback(() => {
    if (flatPath.length < 2) {
      alert('No route to track yet.');
      return;
    }
    const total = totalPathM;
    const startPos = flatPath[0];
    simStepsRef.current = 0;
    setUserPos({ x: startPos.x, y: startPos.y, floorId: startPos.floorId });
    setActiveFloorId(startPos.floorId);
    setTrackingMode('sim');
    setIsTracking(true);

    simIntervalRef.current = setInterval(() => {
      simStepsRef.current += 5;
      const distM = simStepsRef.current * STEP_LENGTH_M;
      if (distM >= total) {
        const endPos = getPosAtDist(total);
        if (endPos) {
          setUserPos(endPos);
          setActiveFloorId(endPos.floorId);
        }
        if (simIntervalRef.current) clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
        return;
      }
      const pos = getPosAtDist(distM);
      if (pos) {
        setUserPos(pos);
        setActiveFloorId(pos.floorId);
      }
    }, 1500);
  }, [flatPath, totalPathM, getPosAtDist]);

  // --- Recalibrate (Phase 2): tell the system "I'm walking forward right now"
  // and re-learn the offset between magnetometer and path direction. Useful
  // when the initial calibration was off (user wasn't actually facing forward
  // during the first 8 steps).
  const handleRecalibrate = useCallback(() => {
    calibrationOffsetRef.current = null;
    calibrationStepsRef.current = 0;
    calibrationSumRef.current = 0;
    setDebugDirState('calibrating');
  }, []);

  // --- Stop any tracking ---
  const handleStopTracking = useCallback(() => {
    // Clean up pedometer
    pedometerSubRef.current?.remove();
    pedometerSubRef.current = null;
    // Clean up magnetometer
    magnetometerSubRef.current?.remove();
    magnetometerSubRef.current = null;
    // Clean up accelerometer
    accelerometerSubRef.current?.remove();
    accelerometerSubRef.current = null;
    accelStepCountRef.current = 0;
    accelWasAboveRef.current = false;
    accelLastStepTimeRef.current = 0;
    headingRef.current = null;
    calibrationOffsetRef.current = null;
    calibrationStepsRef.current = 0;
    calibrationSumRef.current = 0;
    lastStepCountRef.current = null;
    distAlongPathRef.current = 0;
    // Clean up simulation
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    simIntervalRef.current = null;
    simStepsRef.current = 0;
    // Reset state
    setIsTracking(false);
    setTrackingMode('off');
    setUserPos(null);
    setDebugSteps(0);
    setDebugDistM(0);
    setDebugDirState('idle');
  }, []);

  // ------ Active segment for current floor ------
  const floorSegments = useMemo(
    () => routeSegments.filter((s) => s.floorId === activeFloorId && s.waypoints.length > 0),
    [routeSegments, activeFloorId],
  );

  // Current step instructions
  const currentInstruction = routeSegments[activeSegmentIdx]?.instruction ?? '';

  // ------ Render ------
  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onExit} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={24} color={PRIMARY} />
        </TouchableOpacity>
        <View style={styles.titleBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {graph.buildingName}
          </Text>
          <Text style={styles.titleHint}>Indoor map</Text>
        </View>
        {routeSegments.length > 0 && (
          <TouchableOpacity onPress={handleClearRoute} style={styles.clearBtn} hitSlop={8}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Floor tabs — single horizontal row */}
      <View style={styles.floorTabsContainer}>
        <RNScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.floorTabs}
        >
          {graph.floors.map((floor) => {
            const isActive = floor.id === activeFloorId;
            const hasRoute = routeSegments.some(
              (s) => s.floorId === floor.id && s.waypoints.length > 0,
            );
            return (
              <TouchableOpacity
                key={floor.id}
                style={[styles.floorTab, isActive && styles.floorTabActive]}
                onPress={() => setActiveFloorId(floor.id)}
              >
                <Text style={[styles.floorTabText, isActive && styles.floorTabTextActive]}>
                  {floor.name}
                </Text>
                {hasRoute && <View style={styles.routeDot} />}
              </TouchableOpacity>
            );
          })}
        </RNScrollView>
      </View>

      {/* Floor plan — 2D pan via gesture-handler ScrollView; zoom uses +/- only */}
      <View style={styles.mapStage}>
        <View
          style={styles.mapCard}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) {
              setMapViewport((prev) =>
                prev && Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1 ? prev : { w: width, h: height },
              );
            }
          }}
        >
          <MapScrollView
            ref={scrollRef}
            style={styles.mapScroll}
            contentContainerStyle={[
              styles.mapContent,
              { width: imageWidth, height: imageHeight },
            ]}
            centerContent={false}
            // Native pinch zoom on iOS breaks two-axis panning; use + / − for zoom instead.
            maximumZoomScale={1}
            minimumZoomScale={1}
            bouncesZoom={false}
            scrollEnabled
            directionalLockEnabled={false}
            nestedScrollEnabled
            overScrollMode="always"
            showsVerticalScrollIndicator
            showsHorizontalScrollIndicator
            alwaysBounceVertical={false}
            alwaysBounceHorizontal={false}
            onLayout={(e) => {
              const { width, height } = e.nativeEvent.layout;
              setScrollViewport((prev) =>
                prev.w === width && prev.h === height
                  ? prev
                  : { w: Math.max(0, width), h: Math.max(0, height) },
              );
            }}
          >
            <Pressable
              style={[styles.mapImageWrap, { width: imageWidth, height: imageHeight }]}
              onPress={placementMode === 'tap' ? handleFloorPlanTap : undefined}
            >
              <FloorPlanImage
                floorId={activeFloorId}
                width={imageWidth}
                height={imageHeight}
                graph={graph}
              />
              <Svg
                style={StyleSheet.absoluteFill}
                viewBox={`0 0 ${imageWidth} ${imageHeight}`}
                pointerEvents="none"
              >
            {floorSegments.map((seg, idx) => {
              if (seg.waypoints.length < 2) return null;
              const points = seg.waypoints
                .map(([x, y]) => `${toImageX(x, imageWidth)},${toImageY(y, imageHeight)}`)
                .join(' ');
              // The last waypoint is where this floor segment leads — mark it
              // so the user can see the line's direction at a glance.
              const [endX, endY] = seg.waypoints[seg.waypoints.length - 1];
              // If there's a later route segment whose start lives on a
              // different floor, this segment terminates at a transport node
              // (elevator/stairs). Otherwise it ends at the destination room
              // and the red dest marker already covers it.
              const isTransportEnd =
                routeSegments.indexOf(seg) < routeSegments.length - 1;
              return (
                <React.Fragment key={idx}>
                  <Polyline
                    points={points}
                    fill="none"
                    stroke="rgba(25,80,140,0.35)"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <Polyline
                    points={points}
                    fill="none"
                    stroke="#4285F4"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {isTransportEnd && (
                    <>
                      <Circle
                        cx={toImageX(endX, imageWidth)}
                        cy={toImageY(endY, imageHeight)}
                        r={7}
                        fill="#4285F4"
                        opacity={0.25}
                      />
                      <Circle
                        cx={toImageX(endX, imageWidth)}
                        cy={toImageY(endY, imageHeight)}
                        r={4.5}
                        fill="#4285F4"
                        stroke="#fff"
                        strokeWidth={1.5}
                      />
                    </>
                  )}
                </React.Fragment>
              );
            })}
            {(() => {
              const sn = startNode ?? (routeSegments.length > 0 ? getEntrance() : null);
              if (!sn || sn.floorId !== activeFloorId) return null;
              return (
                <>
                  <Circle cx={toImageX(sn.x, imageWidth)} cy={toImageY(sn.y, imageHeight)} r={7} fill="#34A853" opacity={0.25} />
                  <Circle cx={toImageX(sn.x, imageWidth)} cy={toImageY(sn.y, imageHeight)} r={4.5} fill="#34A853" stroke="#fff" strokeWidth={1.5} />
                </>
              );
            })()}
            {destNode && destNode.floorId === activeFloorId && (
              <>
                <Circle cx={toImageX(destNode.x, imageWidth)} cy={toImageY(destNode.y, imageHeight)} r={7} fill="#EA4335" opacity={0.25} />
                <Circle cx={toImageX(destNode.x, imageWidth)} cy={toImageY(destNode.y, imageHeight)} r={4.5} fill="#EA4335" stroke="#fff" strokeWidth={1.5} />
              </>
            )}
            {userPos && userPos.floorId === activeFloorId && (
              <>
                <Circle cx={toImageX(userPos.x, imageWidth)} cy={toImageY(userPos.y, imageHeight)} r={14} fill="#4285F4" opacity={0.15} />
                <Circle cx={toImageX(userPos.x, imageWidth)} cy={toImageY(userPos.y, imageHeight)} r={8} fill="#4285F4" opacity={0.3} />
                <Circle cx={toImageX(userPos.x, imageWidth)} cy={toImageY(userPos.y, imageHeight)} r={5} fill="#4285F4" stroke="#fff" strokeWidth={2} />
              </>
            )}
              </Svg>
            </Pressable>
          </MapScrollView>
          <View style={styles.mapZoomRail} pointerEvents="box-none">
            <TouchableOpacity
              style={[styles.mapZoomBtn, mapZoomMul >= MAP_ZOOM_MAX_MUL - 0.001 && styles.mapZoomBtnDisabled]}
              onPress={() => bumpMapZoom(MAP_ZOOM_STEP)}
              disabled={mapZoomMul >= MAP_ZOOM_MAX_MUL - 0.001}
              accessibilityLabel="Zoom in floor plan"
            >
              <MaterialIcons name="add" size={22} color={mapZoomMul >= MAP_ZOOM_MAX_MUL - 0.001 ? '#cbd5e1' : PRIMARY} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mapZoomBtn, mapZoomMul <= MAP_ZOOM_MIN_MUL + 0.001 && styles.mapZoomBtnDisabled]}
              onPress={() => bumpMapZoom(-MAP_ZOOM_STEP)}
              disabled={mapZoomMul <= MAP_ZOOM_MIN_MUL + 0.001}
              accessibilityLabel="Zoom out floor plan"
            >
              <MaterialIcons name="remove" size={22} color={mapZoomMul <= MAP_ZOOM_MIN_MUL + 0.001 ? '#cbd5e1' : PRIMARY} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Route instruction card (shown when route is active) */}
      {routeSegments.length > 0 && (
        <View style={styles.instructionCard}>
          <View style={styles.instructionRow}>
            <TouchableOpacity
              disabled={activeSegmentIdx === 0}
              onPress={() => {
                const prev = activeSegmentIdx - 1;
                setActiveSegmentIdx(prev);
                const seg = routeSegments[prev];
                if (seg.waypoints.length > 0) setActiveFloorId(seg.floorId);
              }}
            >
              <MaterialIcons
                name="chevron-left"
                size={28}
                color={activeSegmentIdx === 0 ? '#ccc' : '#333'}
              />
            </TouchableOpacity>
            <View style={styles.instructionCenter}>
              <Text style={styles.instructionStep}>
                Step {activeSegmentIdx + 1} of {routeSegments.length}
              </Text>
              <Text style={styles.instructionText}>{currentInstruction}</Text>
            </View>
            <TouchableOpacity
              disabled={activeSegmentIdx >= routeSegments.length - 1}
              onPress={() => {
                const next = activeSegmentIdx + 1;
                setActiveSegmentIdx(next);
                const seg = routeSegments[next];
                if (seg.waypoints.length > 0) setActiveFloorId(seg.floorId);
              }}
            >
              <MaterialIcons
                name="chevron-right"
                size={28}
                color={activeSegmentIdx >= routeSegments.length - 1 ? '#ccc' : '#333'}
              />
            </TouchableOpacity>
          </View>
          {trackingMode === 'off' ? (
            <View style={styles.trackingRow}>
              <TouchableOpacity
                style={[styles.trackingBtn, { flex: 1 }]}
                onPress={handleStartLiveTracking}
              >
                <MaterialIcons name="directions-walk" size={18} color="#fff" />
                <Text style={styles.trackingBtnText}>Start Tracking</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.trackingBtn, { flex: 1, backgroundColor: '#7c3aed' }]}
                onPress={handleStartSimulation}
              >
                <MaterialIcons name="play-arrow" size={18} color="#fff" />
                <Text style={styles.trackingBtnText}>Simulate</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.trackingRow}>
                <TouchableOpacity
                  style={[styles.trackingBtn, styles.trackingBtnActive, { flex: 1 }]}
                  onPress={handleStopTracking}
                >
                  <MaterialIcons name="stop" size={18} color="#fff" />
                  <Text style={styles.trackingBtnText}>
                    Stop {trackingMode === 'live' ? 'Tracking' : 'Simulation'}
                  </Text>
                </TouchableOpacity>
                {trackingMode === 'live' && (
                  <TouchableOpacity
                    style={[styles.trackingBtn, { flex: 1, backgroundColor: '#0891b2' }]}
                    onPress={handleRecalibrate}
                  >
                    <MaterialIcons name="explore" size={18} color="#fff" />
                    <Text style={styles.trackingBtnText}>Recalibrate</Text>
                  </TouchableOpacity>
                )}
              </View>
              {trackingMode === 'live' && (
                <Text style={{ marginTop: 8, fontSize: 12, color: TEXT_MUTED, textAlign: 'center' }}>
                  Steps: {debugSteps} · {debugDistM.toFixed(1)}m / {totalPathM.toFixed(1)}m · {debugDirState}
                </Text>
              )}
            </>
          )}
        </View>
      )}

      {/* Placement prompt — shown when destination came from outside (e.g.
          calendar event) and we still need a starting position */}
      {!isSearching && routeSegments.length === 0 && placementMode !== 'idle' && destNode && (
        <View style={styles.bottomPanel}>
          <Text style={styles.panelLabel}>You are at {graph.buildingName}</Text>
          <Text style={styles.placementHeading}>
            Where are you in the building?
          </Text>
          <Text style={styles.placementSub}>
            {placementMode === 'tap'
              ? `Tap your location on the floor plan above. Switch floors at the top if needed.`
              : `Drop a pin on the floor plan, or use the main entrance to route to ${destNode.label}.`}
          </Text>
          {placementMode === 'tap' ? (
            <TouchableOpacity
              style={[styles.navigateBtn, styles.navigateBtnSecondary]}
              onPress={() => setPlacementMode('prompt')}
            >
              <MaterialIcons name="close" size={18} color={PRIMARY} />
              <Text style={[styles.navigateBtnText, { color: PRIMARY }]}>Cancel pin drop</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.placementButtons}>
              <TouchableOpacity
                style={[styles.navigateBtn, styles.navigateBtnSecondary, styles.placementBtn]}
                onPress={handleEnterTapMode}
              >
                <MaterialIcons name="touch-app" size={18} color={PRIMARY} />
                <Text style={[styles.navigateBtnText, { color: PRIMARY }]}>Drop a pin</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.navigateBtn, styles.placementBtn]}
                onPress={handleUseMainEntrance}
              >
                <MaterialIcons name="meeting-room" size={18} color="#fff" />
                <Text style={styles.navigateBtnText}>Main entrance</Text>
              </TouchableOpacity>
            </View>
          )}
          {routeError ? <Text style={styles.errorText}>{routeError}</Text> : null}
        </View>
      )}

      {/* Bottom panel — start/dest input (shown when no active route) */}
      {!isSearching && routeSegments.length === 0 && placementMode === 'idle' && (
        <View style={styles.bottomPanel}>
          <Text style={styles.panelLabel}>Route</Text>
          <TouchableOpacity
            style={styles.inputRow}
            activeOpacity={0.7}
            onPress={() => {
              setSelectingFor('start');
              setIsSearching(true);
            }}
          >
            <View style={[styles.dot, styles.dotStart]} />
            <View style={styles.inputRowText}>
              <Text style={styles.inputLabel}>From</Text>
              <Text style={[styles.inputValue, !startNode && styles.inputValuePlaceholder]} numberOfLines={1}>
                {startNode ? startNode.label : 'Main entrance (default)'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#cbd5e1" />
          </TouchableOpacity>
          <View style={styles.inputDivider} />
          <TouchableOpacity
            style={styles.inputRow}
            activeOpacity={0.7}
            onPress={() => {
              setSelectingFor('dest');
              setIsSearching(true);
            }}
          >
            <View style={[styles.dot, styles.dotDest]} />
            <View style={styles.inputRowText}>
              <Text style={styles.inputLabel}>To</Text>
              <Text style={[styles.inputValue, !destNode && styles.inputValuePlaceholder]} numberOfLines={1}>
                {destNode ? destNode.label : 'Search for a room'}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color="#cbd5e1" />
          </TouchableOpacity>
          {routeError ? (
            <Text style={styles.errorText}>{routeError}</Text>
          ) : null}
          {destNode && (
            <TouchableOpacity style={styles.navigateBtn} onPress={handleNavigate}>
              <MaterialIcons name="directions" size={20} color="#fff" />
              <Text style={styles.navigateBtnText}>Get Directions</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Search overlay */}
      {isSearching && (
        <View style={styles.searchOverlay}>
          <View style={styles.searchBar}>
            <TouchableOpacity onPress={() => setIsSearching(false)} hitSlop={12}>
              <MaterialIcons name="arrow-back" size={24} color={PRIMARY} />
            </TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              placeholder={selectingFor === 'dest' ? 'Search room number...' : 'Enter start room...'}
              placeholderTextColor="#999"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <MaterialIcons name="close" size={20} color="#999" />
              </TouchableOpacity>
            )}
          </View>
          <FlatList
            style={styles.searchList}
            data={searchResults}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => {
              const floor = graph.floors.find((f) => f.id === item.floorId);
              return (
                <TouchableOpacity
                  style={styles.searchResult}
                  onPress={() => handleSelectRoom(item)}
                >
                  <MaterialIcons name="meeting-room" size={20} color={PRIMARY} />
                  <View style={styles.searchResultText}>
                    <Text style={styles.searchResultLabel}>{item.label}</Text>
                    <Text style={styles.searchResultFloor}>{floor?.name ?? ''}</Text>
                  </View>
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              searchQuery.length > 0 ? (
                <Text style={styles.emptyText}>No rooms found</Text>
              ) : (
                <Text style={styles.emptyText}>Type a room number (e.g. 4.302)</Text>
              )
            }
          />
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 6 : 12,
    paddingBottom: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  backBtn: {
    padding: 4,
    marginRight: 10,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    letterSpacing: -0.3,
  },
  titleHint: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearBtnText: {
    fontSize: 14,
    color: '#b91c1c',
    fontWeight: '700',
  },

  floorTabsContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
  },
  floorTabs: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    alignItems: 'center',
  },
  floorTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: PAGE_BG,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  floorTabActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  floorTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  floorTabTextActive: {
    color: '#fff',
  },
  routeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#fecaca',
    borderWidth: 1,
    borderColor: '#b91c1c',
  },

  mapStage: {
    flex: 1,
    backgroundColor: PAGE_BG,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  mapCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  mapScroll: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  mapContent: {
    alignItems: 'flex-start',
  },
  mapImageWrap: {
    position: 'relative',
    backgroundColor: '#f8fafc',
  },
  mapZoomRail: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    gap: 8,
  },
  mapZoomBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: CARD_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  mapZoomBtnDisabled: {
    opacity: 0.55,
  },

  instructionCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 14,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  instructionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructionCenter: {
    flex: 1,
    alignItems: 'center',
  },
  instructionStep: {
    fontSize: 11,
    fontWeight: '600',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'center',
  },
  trackingRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  trackingBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: PRIMARY,
  },
  trackingBtnActive: {
    backgroundColor: '#b91c1c',
  },
  trackingBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },

  bottomPanel: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 18,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  inputRowText: {
    flex: 1,
    minWidth: 0,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: TEXT_MUTED,
    marginBottom: 2,
  },
  inputValue: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  inputValuePlaceholder: {
    color: '#94a3b8',
    fontWeight: '500',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 2,
    elevation: 1,
  },
  dotStart: {
    backgroundColor: '#22c55e',
  },
  dotDest: {
    backgroundColor: '#ef4444',
  },
  inputDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f1f5f9',
    marginLeft: 36,
  },
  errorText: {
    fontSize: 13,
    color: '#b91c1c',
    marginTop: 10,
    textAlign: 'center',
    fontWeight: '500',
  },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 14,
    gap: 8,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  navigateBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  navigateBtnSecondary: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderColor: PRIMARY,
    shadowOpacity: 0,
    elevation: 0,
  },
  placementHeading: {
    marginTop: 4,
    fontSize: 18,
    fontWeight: '700',
    color: TEXT_PRIMARY,
  },
  placementSub: {
    marginTop: 6,
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 18,
  },
  placementButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  placementBtn: {
    flex: 1,
    marginTop: 0,
  },

  // Search overlay
  searchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: PAGE_BG,
    zIndex: 100,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: CARD_BORDER,
    gap: 10,
    marginTop: Platform.OS === 'ios' ? 4 : 12,
  },
  searchList: {
    flex: 1,
    backgroundColor: PAGE_BG,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: TEXT_PRIMARY,
    paddingVertical: 0,
    fontWeight: '500',
  },
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    gap: 12,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#334155',
  },
  searchResultFloor: {
    fontSize: 12,
    fontWeight: '500',
    color: TEXT_MUTED,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: TEXT_MUTED,
    marginTop: 40,
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 24,
  },
});
