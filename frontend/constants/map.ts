import { Dimensions, Platform } from 'react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import type React from 'react';

export const UT_CAMPUS_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  latitudeDelta: 0.013,
  longitudeDelta: 0.013,
};

export const DEFAULT_USER_LOCATION = {
  latitude: 30.2824,
  longitude: -97.7323,
};

export const RECENTS_STORAGE_KEY = '@wavepoint_map_recents';
export const MAX_RECENTS = 8;
export const DEFAULT_BUILDING_FLOORS = 3;
export const REROUTE_THRESHOLD_M = 30;
export const ARRIVAL_THRESHOLD_M = 25;

export const MAP_WINDOW_WIDTH = Dimensions.get('window').width;

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

function longitudeDeltaToZoom(longitudeDelta: number, mapWidth: number): number {
  const z = Math.log2((360 * (mapWidth / 256)) / longitudeDelta);
  return Math.min(20, Math.max(10, Math.round(z)));
}

export function fitMapToCoordinates(
  cameraRef: React.RefObject<CameraRef | null>,
  coords: { latitude: number; longitude: number }[],
  edgePadding: { top: number; right: number; bottom: number; left: number },
  animationDuration = 500,
) {
  if (Platform.OS === 'web' || coords.length === 0) return;

  let north = coords[0].latitude;
  let south = coords[0].latitude;
  let east = coords[0].longitude;
  let west = coords[0].longitude;
  for (const c of coords) {
    north = Math.max(north, c.latitude);
    south = Math.min(south, c.latitude);
    east = Math.max(east, c.longitude);
    west = Math.min(west, c.longitude);
  }

  cameraRef.current?.fitBounds(
    [east, north],
    [west, south],
    [edgePadding.top, edgePadding.right, edgePadding.bottom, edgePadding.left],
    animationDuration,
  );
}

export function animateMapToRegion(
  cameraRef: React.RefObject<CameraRef | null>,
  region: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  },
  animationDuration: number,
) {
  if (Platform.OS === 'web') return;
  cameraRef.current?.setCamera({
    centerCoordinate: [region.longitude, region.latitude],
    zoomLevel: longitudeDeltaToZoom(region.longitudeDelta, MAP_WINDOW_WIDTH),
    animationDuration,
    animationMode: 'easeTo',
  });
}
