import React from 'react';
import { Image, StyleSheet } from 'react-native';
import type { BuildingGraph } from '@/lib/services/indoor-navigation';

// ---------------------------------------------------------------------------
// Pre-bundled floor-plan PNGs (frontend/assets/floorplans/gdc_floor_*.png).
// Regenerate from the source PDF with backend/extract_floor_images.py if needed.
// ---------------------------------------------------------------------------

const FLOOR_IMAGES: Record<string, number> = {
  f0: require('@/assets/floorplans/gdc_floor_1.png'),
  f1: require('@/assets/floorplans/gdc_floor_2.png'),
  f2: require('@/assets/floorplans/gdc_floor_3.png'),
  f3: require('@/assets/floorplans/gdc_floor_4.png'),
  f4: require('@/assets/floorplans/gdc_floor_5.png'),
  f5: require('@/assets/floorplans/gdc_floor_6.png'),
  f6: require('@/assets/floorplans/gdc_floor_7.png'),
};

type Props = {
  floorId: string;
  width: number;
  height: number;
  /** Kept for API compatibility with IndoorMapView — no longer used. */
  graph?: BuildingGraph;
};

/**
 * Renders the active floor as a PNG.
 *
 * Routing polyline, start/destination markers, and tap handling are layered on
 * top by IndoorMapView.
 */
export function FloorPlanImage({ floorId, width, height }: Props) {
  const source = FLOOR_IMAGES[floorId];
  if (!source || !width || !height) return null;

  return (
    <Image
      source={source}
      style={[styles.image, { width, height }]}
      resizeMode="stretch"
    />
  );
}

const styles = StyleSheet.create({
  image: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
