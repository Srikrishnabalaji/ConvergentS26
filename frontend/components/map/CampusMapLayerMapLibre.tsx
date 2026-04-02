import React, { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  MapView,
  Camera,
  UserLocation,
  UserTrackingMode,
  ShapeSource,
  LineLayer,
  CircleLayer,
  PointAnnotation,
} from '@maplibre/maplibre-react-native';

import type { CampusMapLayerProps } from './CampusMapLayer.types';

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

  style.layers = (style.layers as Array<Record<string, unknown>>).filter(
    (layer) => !HIDDEN_LAYERS.has(layer.id as string),
  );

  for (const layer of style.layers as Array<Record<string, unknown>>) {
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

const _stylePromise: Promise<string | object> = (async () => {
  try {
    const res = await fetch(OPENFREEMAP_LIBERTY_URL);
    if (!res.ok) return OPENFREEMAP_LIBERTY_URL;
    const json = await res.json();
    return patchStyle(json);
  } catch {
    return OPENFREEMAP_LIBERTY_URL;
  }
})();

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
}: CampusMapLayerProps) {
  const [mapStyle, setMapStyle] = useState<string | object | null>(null);

  useEffect(() => {
    let cancelled = false;
    _stylePromise.then((s) => {
      if (!cancelled) setMapStyle(s);
    });
    return () => { cancelled = true; };
  }, []);

  const defaultZoom = useMemo(
    () => longitudeDeltaToZoom(initialLongitudeDelta, Math.max(mapWidth, 320)),
    [initialLongitudeDelta, mapWidth],
  );

  const routeGeoJSON = useMemo(() => {
    if (routeCoordinates.length < 2) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'LineString' as const,
          coordinates: routeCoordinates.map((c) => [c.longitude, c.latitude]),
        },
      }],
    };
  }, [routeCoordinates]);

  const destPointGeoJSON = useMemo(() => {
    if (!destination) return null;
    return {
      type: 'FeatureCollection' as const,
      features: [{
        type: 'Feature' as const,
        properties: {},
        geometry: {
          type: 'Point' as const,
          coordinates: [destination.longitude, destination.latitude],
        },
      }],
    };
  }, [destination]);

  if (!mapStyle) {
    return <View style={[StyleSheet.absoluteFillObject, styles.loading]} />;
  }

  return (
    <MapView
      style={StyleSheet.absoluteFillObject}
      mapStyle={mapStyle}
      logoEnabled={false}
      attributionEnabled
      attributionPosition={{ bottom: 8, left: 8 }}
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
        followUserMode={UserTrackingMode.Follow}
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

      {showRoute && routeGeoJSON && (
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
      )}

      {destination && destPointGeoJSON && (
        <ShapeSource id="dest-source" shape={destPointGeoJSON}>
          <CircleLayer
            id="dest-shadow"
            style={{
              circleRadius: 14,
              circleColor: 'rgba(0,0,0,0.08)',
              circleBlur: 0.8,
              circleTranslate: [0, 4],
            }}
          />
          <CircleLayer
            id="dest-outer"
            style={{
              circleRadius: 12,
              circleColor: '#ffffff',
            }}
          />
          <CircleLayer
            id="dest-inner"
            style={{
              circleRadius: 9,
              circleColor: '#EA4335',
            }}
          />
          <CircleLayer
            id="dest-center"
            style={{
              circleRadius: 3.5,
              circleColor: '#ffffff',
            }}
          />
        </ShapeSource>
      )}

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
  );
}

const styles = StyleSheet.create({
  loading: {
    backgroundColor: '#f2efe9',
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
