import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { AlertPin, PIN_SIZE } from './AlertPin';
import type { AlertCluster } from '@/lib/alerts';

// Must match the CROP constants in IndoorMapView.tsx exactly
const CROP = { left: 0.03, top: 0.06, right: 0.97, bottom: 0.84 };
const CROP_W = CROP.right - CROP.left;
const CROP_H = CROP.bottom - CROP.top;

function toImageX(nx: number, imgW: number): number {
  return ((nx - CROP.left) / CROP_W) * imgW;
}
function toImageY(ny: number, imgH: number): number {
  return ((ny - CROP.top) / CROP_H) * imgH;
}

type Props = {
  clusters: AlertCluster[];
  imageWidth: number;
  imageHeight: number;
  onClusterPress: (cluster: AlertCluster) => void;
};

export function AlertsOverlay({ clusters = [], imageWidth, imageHeight, onClusterPress }: Props) {
  return (
    <>
      {clusters.map((cluster) => {
        const cx = toImageX(cluster.x, imageWidth);
        const cy = toImageY(cluster.y, imageHeight);
        return (
          <TouchableOpacity
            key={cluster.id}
            style={[
              styles.pinWrapper,
              {
                left: cx - PIN_SIZE / 2,
                top: cy - PIN_SIZE / 2,
              },
            ]}
            onPress={() => onClusterPress(cluster)}
            hitSlop={8}
          >
            <AlertPin type={cluster.type} count={cluster.members.length} />
          </TouchableOpacity>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  pinWrapper: {
    position: 'absolute',
    zIndex: 10,
  },
});
