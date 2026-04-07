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
import { Image } from 'expo-image';
import Svg, { Polyline, Circle } from 'react-native-svg';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  type BuildingGraph,
  type GraphNode,
  type RouteSegment,
  astar,
  buildRoute,
  searchRooms,
  resolveRoomFromQuery,
  findEntrance,
  findNearest,
} from '@/lib/services/indoor-navigation';

// ---------------------------------------------------------------------------
// Floor plan image map — maps floorId to require()'d asset
// ---------------------------------------------------------------------------
const FLOOR_IMAGES: Record<string, any> = {
  f0: require('@/assets/floorplans/gdc_floor_1.png'),
  f1: require('@/assets/floorplans/gdc_floor_2.png'),
  f2: require('@/assets/floorplans/gdc_floor_3.png'),
  f3: require('@/assets/floorplans/gdc_floor_4.png'),
  f4: require('@/assets/floorplans/gdc_floor_5.png'),
  f5: require('@/assets/floorplans/gdc_floor_6.png'),
  f6: require('@/assets/floorplans/gdc_floor_7.png'),
};

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
  // Active floor
  const [activeFloorId, setActiveFloorId] = useState(graph.floors[0]?.id ?? 'f0');

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
      const segments = buildRoute(graph, result.nodeIds);
      setRouteSegments(segments);
      setActiveSegmentIdx(0);
      const firstFloor = segments.find((s) => s.waypoints.length > 0);
      if (firstFloor) setActiveFloorId(firstFloor.floorId);
      return true;
    },
    [graph],
  );

  const handleNavigate = useCallback(() => {
    if (!destNode) return;
    // Default start: most-connected node on floor 1 (acts as the "entrance")
    const start = startNode ?? findEntrance(graph, graph.floors[0].id);
    if (!start) return;
    computeRoute(start, destNode);
  }, [graph, startNode, destNode, computeRoute]);

  // ------ Placement flow handlers ------
  const handleUseMainEntrance = useCallback(() => {
    const dest = destNode ?? externalDestRef.current;
    if (!dest) return;
    const entrance = findEntrance(graph, graph.floors[0].id);
    if (!entrance) return;
    setStartNode(entrance);
    setActiveFloorId(entrance.floorId);
    setPlacementMode('idle');
    computeRoute(entrance, dest);
  }, [graph, destNode, computeRoute]);

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
              <Image
                source={FLOOR_IMAGES[activeFloorId]}
                style={StyleSheet.absoluteFill}
                contentFit="fill"
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
                </React.Fragment>
              );
            })}
            {(() => {
              const sn = startNode ?? (routeSegments.length > 0 ? findEntrance(graph, graph.floors[0].id) : null);
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
