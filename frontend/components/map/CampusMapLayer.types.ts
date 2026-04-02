import type { CameraRef } from '@maplibre/maplibre-react-native';

type LatLng = { latitude: number; longitude: number };

export type CampusMapLayerProps = {
  cameraRef: React.RefObject<CameraRef | null>;
  initialCenter: LatLng;
  initialLongitudeDelta: number;
  mapWidth: number;
  showsUserLocation: boolean;
  followUserLocation: boolean;
  destination: (LatLng & { title: string; subtitle: string }) | null;
  routeCoordinates: LatLng[];
  showRoute: boolean;
  repositionMarker: {
    coordinate: LatLng;
    onDragEnd: (coord: LatLng) => void;
  } | null;
};
