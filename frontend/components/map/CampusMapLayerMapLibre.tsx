import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  MapView,
  Camera,
  UserLocation,
  UserTrackingMode,
  ShapeSource,
  LineLayer,
  PointAnnotation,
  Images,
  SymbolLayer,
} from '@maplibre/maplibre-react-native';

import type { CampusMapLayerProps } from './CampusMapLayer.types';

const DESTINATION_PIN_IMAGE = require('../../assets/map/destination-pin.png');

type RoutePoint = { latitude: number; longitude: number };

/** Remove consecutive duplicate points — MapLibre logs "Invalid geometry" on degenerate lines. */
function lineStringCoordinates(points: RoutePoint[]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of points) {
    const pair: [number, number] = [p.longitude, p.latitude];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== pair[0] || prev[1] !== pair[1]) out.push(pair);
  }
  return out.length >= 2 ? out : [];
}

function longitudeDeltaToZoom(longitudeDelta: number, mapWidth: number): number {
  const z = Math.log2((360 * (mapWidth / 256)) / longitudeDelta);
  return Math.min(20, Math.max(10, Math.round(z)));
}

const OPENFREEMAP_LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';

const HIDDEN_LAYERS = new Set([
  'poi_transit',
  'airport',
  'road_transit_rail',
  'road_transit_rail_hatching',
  'tunnel_transit_rail',
  'tunnel_transit_rail_hatching',
  'bridge_transit_rail',
  'bridge_transit_rail_hatching',
  'road_one_way_arrow',
  'road_one_way_arrow_opposite',
]);

const POI_RANKED_LAYERS = new Set(['poi_r1', 'poi_r7', 'poi_r20']);

const EXCLUDE_TRANSIT_EXPR: unknown[] = [
  '!', ['match', ['get', 'class'], ['bus', 'rail', 'airport'], true, false],
];

const LAYER_ZOOM_OVERRIDES: Record<string, number> = {
  poi_r1:                         13,
  poi_r7:                         14.5,
  poi_r20:                        15.5,
  'highway-shield-non-us':        16,
  'highway-shield-us-interstate': 16,
  road_shield_us:                 16,
};

function patchStyle(style: Record<string, unknown>): object {
  if (!Array.isArray(style.layers)) return style;

  style.layers = (style.layers as Record<string, unknown>[]).filter(
    (layer) => !HIDDEN_LAYERS.has(layer.id as string),
  );

  for (const layer of style.layers as Record<string, unknown>[]) {
    const id = layer.id as string;

    const minzoom = LAYER_ZOOM_OVERRIDES[id];
    if (minzoom !== undefined) {
      layer.minzoom = minzoom;
    }

    if (POI_RANKED_LAYERS.has(id) && Array.isArray(layer.filter)) {
      const f = layer.filter as unknown[];
      if (f[0] === 'all') {
        f.push(EXCLUDE_TRANSIT_EXPR);
      } else {
        layer.filter = ['all', f, EXCLUDE_TRANSIT_EXPR];
      }
    }
  }
  return style;
}

async function fetchMapStyle(): Promise<string | object> {
  try {
    const res = await fetch(OPENFREEMAP_LIBERTY_URL);
    if (!res.ok) return OPENFREEMAP_LIBERTY_URL;
    const json = await res.json();
    return patchStyle(json);
  } catch {
    return OPENFREEMAP_LIBERTY_URL;
  }
}

let _resolvedStyle: string | object | null = null;
const _initialStylePromise = fetchMapStyle().then((s) => {
  _resolvedStyle = s;
  return s;
});

const EMPTY_GEOJSON = {
  type: 'FeatureCollection' as const,
  features: [] as any[],
};

export default function CampusMapLayerMapLibre({
  cameraRef,
  initialCenter,
  initialLongitudeDelta,
  mapWidth,
  showsUserLocation,
  followUserLocation,
  destination,
  routeCoordinates,
  showRoute,
  repositionMarker,
  followUserHeading,
  onDestinationPress,
}: CampusMapLayerProps) {
  const [mapStyle, setMapStyle] = useState<string | object | null>(null);
  const [showAttribution, setShowAttribution] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let style = _resolvedStyle ?? (await _initialStylePromise);

      if (typeof style === 'string' && !cancelled) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          await new Promise((r) => setTimeout(r, 2000 * attempt));
          if (cancelled) return;
          style = await fetchMapStyle();
          if (typeof style !== 'string') {
            _resolvedStyle = style;
            break;
          }
        }
      }

      if (!cancelled) setMapStyle(style);
    })();
    return () => { cancelled = true; };
  }, []);

  const defaultZoom = useMemo(
    () => longitudeDeltaToZoom(initialLongitudeDelta, Math.max(mapWidth, 320)),
    [initialLongitudeDelta, mapWidth],
  );

  const routeGeoJSON = useMemo(() => {
    if (!showRoute || routeCoordinates.length < 2) return EMPTY_GEOJSON;
    const coordinates = lineStringCoordinates(routeCoordinates);
    if (coordinates.length < 2) return EMPTY_GEOJSON;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates,
        },
      }],
    };
  }, [routeCoordinates, showRoute]);

  /** Dotted connector from the last OSRM route point to the exact destination coordinate. */
  const connectorGeoJSON = useMemo(() => {
    if (!showRoute || !destination || routeCoordinates.length < 1) return EMPTY_GEOJSON;
    const last = routeCoordinates[routeCoordinates.length - 1];
    // Skip connector if the route already ends within a metre of the destination.
    const dLat = last.latitude  - destination.latitude;
    const dLng = last.longitude - destination.longitude;
    if (Math.sqrt(dLat * dLat + dLng * dLng) < 0.000009) return EMPTY_GEOJSON;
    const coordinates = lineStringCoordinates([last, destination]);
    if (coordinates.length < 2) return EMPTY_GEOJSON;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates,
        },
      }],
    };
  }, [showRoute, destination, routeCoordinates]);

  /** SymbolLayer + iconAnchor bottom keeps the pin tip on the coordinate at every zoom (PointAnnotation layout was unreliable). */
  const destinationGeoJSON = useMemo(() => {
    if (!destination) return EMPTY_GEOJSON;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: { title: destination.title },
        geometry: {
          type: 'Point' as const,
          coordinates: [destination.longitude, destination.latitude],
        },
      }],
    };
  }, [destination]);

  if (!mapStyle) {
    return (
      <View style={[StyleSheet.absoluteFillObject, styles.loading]}>
        <ActivityIndicator size="large" color="#0B617E" />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFillObject}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        mapStyle={mapStyle}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled
        compassViewPosition={1}
      >
      <Camera
        ref={cameraRef}
        defaultSettings={{
          centerCoordinate: [initialCenter.longitude, initialCenter.latitude],
          zoomLevel: defaultZoom,
        }}
        followUserLocation={followUserLocation}
        followUserMode={followUserHeading ? UserTrackingMode.FollowWithHeading : UserTrackingMode.Follow}
        followZoomLevel={17}
        animationMode="easeTo"
      />

      <UserLocation
        visible={showsUserLocation}
        renderMode="native"
        androidRenderMode="gps"
        showsUserHeadingIndicator
        minDisplacement={3}
      />

      <Images images={{ 'destination-pin': DESTINATION_PIN_IMAGE }} />

      {/* Always mounted to avoid Fabric recycling crash */}
      <ShapeSource id="route-source" shape={routeGeoJSON}>
        <LineLayer
          id="route-glow"
          style={{
            lineColor: '#0B617E',
            lineWidth: 10,
            lineOpacity: 0.15,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <LineLayer
          id="route-casing"
          style={{
            lineColor: '#084d63',
            lineWidth: 5,
            lineOpacity: 0.4,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
        <LineLayer
          id="route-main"
          style={{
            lineColor: '#0B617E',
            lineWidth: 3.5,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      {/* Dotted "last-mile" connector from route end → destination pin tip */}
      <ShapeSource id="connector-source" shape={connectorGeoJSON}>
        <LineLayer
          id="connector-line"
          style={{
            lineColor: '#0B617E',
            lineWidth: 2.5,
            lineDasharray: [0, 2.2],
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>

      <ShapeSource
        id="destination-marker"
        shape={destinationGeoJSON}
        hitbox={onDestinationPress ? { width: 64, height: 64 } : undefined}
        onPress={
          onDestinationPress
            ? () => {
                onDestinationPress();
              }
            : undefined
        }
      >
        <SymbolLayer
          id="destination-symbol"
          style={{
            iconImage: 'destination-pin',
            // Image is 235×355 px. 0.17 * 0.7 ≈ 0.12 → ~28pt display width (~30% smaller).
            // iconSize is a viewport-space multiplier, so it stays constant at every zoom.
            iconSize: 0.06,
            // Tip is the very last pixel row of the cropped image, so 'bottom' is exact.
            iconAnchor: 'bottom',
            // Keep icon upright and constant-size when map is tilted.
            iconPitchAlignment: 'viewport',
            iconRotationAlignment: 'viewport',
            iconAllowOverlap: true,
            iconIgnorePlacement: true,
            textField: ['get', 'title'],
            textSize: 13,
            textFont: ['Noto Sans Bold'],
            textColor: '#1a1a1a',
            textHaloColor: '#ffffff',
            textHaloWidth: 2,
            // Pin displays ~43pt tall (355*0.12). textOffset y=-4.2em at textSize=13 →
            // text bottom sits ~55pt above anchor, clearing the pin top by ~12pt.
            textOffset: [0, -4.2],
            textAnchor: 'bottom',
            textJustify: 'center',
            textAllowOverlap: true,
            textIgnorePlacement: true,
            textPitchAlignment: 'viewport',
            textMaxWidth: 14,
          }}
        />
      </ShapeSource>

      {repositionMarker && (
        <PointAnnotation
          id="reposition-user"
          coordinate={[repositionMarker.coordinate.longitude, repositionMarker.coordinate.latitude]}
          draggable
          onDragEnd={(feature) => {
            const coords = feature.geometry?.coordinates;
            if (coords && coords.length >= 2) {
              repositionMarker.onDragEnd({
                latitude: coords[1],
                longitude: coords[0],
              });
            }
          }}
        >
          <View style={styles.repositionOuter}>
            <View style={styles.repositionInner} />
          </View>
        </PointAnnotation>
      )}
      </MapView>

      <Pressable
        onPress={() => setShowAttribution(true)}
        style={styles.attributionBtn}
        accessibilityRole="button"
        accessibilityLabel="Map attribution"
      >
        <Text style={styles.attributionBtnText}>ⓘ</Text>
      </Pressable>

      <Modal
        visible={showAttribution}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAttribution(false)}
      >
        <Pressable style={styles.attrBackdrop} onPress={() => setShowAttribution(false)}>
          <Pressable style={styles.attrCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.attrTitle}>Map data & tiles</Text>
            <Text style={styles.attrBody}>© OpenStreetMap contributors</Text>
            <Text style={styles.attrBody}>Tiles: OpenFreeMap / OpenMapTiles</Text>
            <Pressable
              style={styles.attrCloseBtn}
              onPress={() => setShowAttribution(false)}
              accessibilityRole="button"
              accessibilityLabel="Close attribution"
            >
              <Text style={styles.attrCloseText}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    backgroundColor: '#f2efe9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  attributionBtn: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.18,
        shadowRadius: 3,
      },
      android: { elevation: 3 },
    }),
  },
  attributionBtnText: {
    fontSize: 18,
    color: '#333',
    fontWeight: '600',
    lineHeight: 20,
  },
  attrBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  attrCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
  },
  attrTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111',
    marginBottom: 10,
  },
  attrBody: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
  },
  attrCloseBtn: {
    marginTop: 12,
    alignSelf: 'flex-end',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: '#f0f0f0',
  },
  attrCloseText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },
  repositionOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(66, 133, 244, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 3,
      },
      android: { elevation: 3 },
    }),
  },
  repositionInner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#0B617E',
    borderWidth: 2.5,
    borderColor: '#fff',
  },
});
