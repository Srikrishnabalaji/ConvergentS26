import React from 'react';
import { Image, StyleSheet } from 'react-native';
import type { BuildingGraph } from '@/lib/services/indoor-navigation';

// ---------------------------------------------------------------------------
// Pre-bundled stylized floor-plan images.
//
// These PNGs are generated *once* by backend/generate_stylized_floorplans.py,
// which sends each raw floor-plan page through Gemini 2.5 Flash Image with a
// strict preservation + MazeMap-style prompt. The results are committed here
// and rendered as-is at runtime — there is no runtime AI call or per-user
// cost. Re-run the backend script to regenerate a floor.
// ---------------------------------------------------------------------------

const FLOOR_IMAGES: Record<string, number> = {
  f0: require('@/assets/floorplans-stylized/gdc_floor_1_stylized.png'),
  f1: require('@/assets/floorplans-stylized/gdc_floor_2_stylized.png'),
  f2: require('@/assets/floorplans-stylized/gdc_floor_3_stylized.png'),
  f3: require('@/assets/floorplans-stylized/gdc_floor_4_stylized.png'),
  f4: require('@/assets/floorplans-stylized/gdc_floor_5_stylized.png'),
  f5: require('@/assets/floorplans-stylized/gdc_floor_6_stylized.png'),
  f6: require('@/assets/floorplans-stylized/gdc_floor_7_stylized.png'),
};

type Props = {
  floorId: string;
  width: number;
  height: number;
  /** Kept for API compatibility with IndoorMapView — no longer used. */
  graph?: BuildingGraph;
};

/**
 * Renders the active floor as a stylized PNG.
 *
 * All walls, rooms, labels, and styling are baked into the image by the
 * offline Gemini pipeline. The routing polyline, start/destination markers,
 * and tap handling are layered on top by IndoorMapView.
 */
export function SVGFloorPlan({ floorId, width, height }: Props) {
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
