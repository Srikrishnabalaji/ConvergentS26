import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  TouchableOpacity,
  TextInput,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
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
  findEntrance,
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

// Cropped image dimensions (from extract_floor_images.py)
const IMAGE_ASPECT = 2878 / 1546; // ≈ 1.862

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
  useEffect(() => {
    if (!initialDestination) return;
    const results = searchRooms(graph, initialDestination);
    if (results.length > 0) {
      handleSelectRoom(results[0]);
    }
  }, []);

  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);

  // Make the floor plan 2x screen width so it's large enough to read room
  // numbers. Users scroll horizontally & vertically, and pinch to zoom further.
  const imageWidth = SCREEN.width * 2;
  const imageHeight = imageWidth / IMAGE_ASPECT;

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
  const handleNavigate = useCallback(() => {
    if (!destNode) return;
    setRouteError('');

    // Default start: first room on floor 1 (no entrance/hallway nodes in current data)
    const start = startNode ?? findEntrance(graph, graph.floors[0].id);
    if (!start) return;

    const result = astar(graph, start.id, destNode.id);
    if (!result) {
      setRouteError('No route found — floors may not be connected yet. Try a room on the same floor as your start.');
      return;
    }

    const segments = buildRoute(graph, result.nodeIds);
    setRouteSegments(segments);
    setActiveSegmentIdx(0);

    // Jump to the first floor that has waypoints
    const firstFloor = segments.find((s) => s.waypoints.length > 0);
    if (firstFloor) setActiveFloorId(firstFloor.floorId);
  }, [graph, startNode, destNode]);

  // Clear route
  const handleClearRoute = useCallback(() => {
    setRouteSegments([]);
    setActiveSegmentIdx(0);
    setDestNode(null);
    setStartNode(null);
    setRouteError('');
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
        <TouchableOpacity onPress={onExit} style={styles.backBtn}>
          <MaterialIcons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {graph.buildingName} — Indoor
        </Text>
        {routeSegments.length > 0 && (
          <TouchableOpacity onPress={handleClearRoute} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Floor tabs — single horizontal row */}
      <View style={styles.floorTabsContainer}>
        <ScrollView
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
        </ScrollView>
      </View>

      {/* Floor plan + route overlay — scrollable in both axes, zoomable */}
      <ScrollView
        ref={scrollRef}
        style={styles.mapScroll}
        contentContainerStyle={styles.mapContent}
        maximumZoomScale={3}
        minimumZoomScale={0.5}
        bouncesZoom
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
      >
        <View style={{ width: imageWidth, height: imageHeight }}>
          <Image
            source={FLOOR_IMAGES[activeFloorId]}
            style={{ width: imageWidth, height: imageHeight }}
            contentFit="fill"
          />
          {/* SVG overlay for route + markers */}
          <Svg
            style={StyleSheet.absoluteFill}
            viewBox={`0 0 ${imageWidth} ${imageHeight}`}
          >
            {/* Route polylines — Google Maps style */}
            {floorSegments.map((seg, idx) => {
              if (seg.waypoints.length < 2) return null;
              const points = seg.waypoints
                .map(([x, y]) => `${toImageX(x, imageWidth)},${toImageY(y, imageHeight)}`)
                .join(' ');
              return (
                <React.Fragment key={idx}>
                  {/* Border/outline for contrast */}
                  <Polyline
                    points={points}
                    fill="none"
                    stroke="rgba(25,80,140,0.35)"
                    strokeWidth={4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Main route line */}
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
            {/* Start marker — green pin */}
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
            {/* Destination marker — red pin */}
            {destNode && destNode.floorId === activeFloorId && (
              <>
                <Circle cx={toImageX(destNode.x, imageWidth)} cy={toImageY(destNode.y, imageHeight)} r={7} fill="#EA4335" opacity={0.25} />
                <Circle cx={toImageX(destNode.x, imageWidth)} cy={toImageY(destNode.y, imageHeight)} r={4.5} fill="#EA4335" stroke="#fff" strokeWidth={1.5} />
              </>
            )}
          </Svg>
        </View>
      </ScrollView>

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

      {/* Bottom panel — start/dest input (shown when no active route) */}
      {!isSearching && routeSegments.length === 0 && (
        <View style={styles.bottomPanel}>
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => {
              setSelectingFor('start');
              setIsSearching(true);
            }}
          >
            <View style={[styles.dot, { backgroundColor: '#4CAF50' }]} />
            <Text style={[styles.inputPlaceholder, startNode && { color: '#333' }]}>
              {startNode ? `From: ${startNode.label}` : 'Start: Main Entrance (default)'}
            </Text>
          </TouchableOpacity>
          <View style={styles.inputDivider} />
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => {
              setSelectingFor('dest');
              setIsSearching(true);
            }}
          >
            <View style={[styles.dot, { backgroundColor: '#E53935' }]} />
            <Text style={[styles.inputPlaceholder, destNode && { color: '#333' }]}>
              {destNode ? `To: ${destNode.label}` : 'Where are you going?'}
            </Text>
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
            <TouchableOpacity onPress={() => setIsSearching(false)}>
              <MaterialIcons name="arrow-back" size={24} color="#333" />
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
    backgroundColor: '#fff',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 4 : 12,
    paddingBottom: 6,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    flex: 1,
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  clearBtnText: {
    fontSize: 14,
    color: '#E53935',
    fontWeight: '600',
  },

  // Floor tabs — constrained height
  floorTabsContainer: {
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  floorTabs: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    alignItems: 'center',
  },
  floorTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  floorTabActive: {
    backgroundColor: PRIMARY,
  },
  floorTabText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
  },
  floorTabTextActive: {
    color: '#fff',
  },
  routeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E53935',
  },

  // Map scroll — takes remaining space
  mapScroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  mapContent: {
    // No centering — image is wider than screen, user scrolls to explore
  },

  // Instruction card
  instructionCard: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: 20,
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
    color: '#999',
    marginBottom: 2,
  },
  instructionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
    textAlign: 'center',
  },

  // Bottom panel
  bottomPanel: {
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ddd',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  inputPlaceholder: {
    fontSize: 15,
    color: '#999',
  },
  inputDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#ddd',
    marginLeft: 22,
  },
  errorText: {
    fontSize: 13,
    color: '#E53935',
    marginTop: 8,
    textAlign: 'center',
  },
  navigateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 12,
    gap: 8,
  },
  navigateBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },

  // Search overlay
  searchOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#fff',
    zIndex: 100,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
    gap: 8,
    marginTop: Platform.OS === 'ios' ? 4 : 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#000',
    paddingVertical: 0,
  },
  searchResult: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  searchResultFloor: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    fontSize: 14,
  },
});
