import Constants, { ExecutionEnvironment } from 'expo-constants';
import React, { lazy, Suspense } from 'react';
import { StyleSheet, View } from 'react-native';

import { MapDevBuildPlaceholder } from './MapDevBuildPlaceholder';
import type { CampusMapLayerProps } from './CampusMapLayer.types';

const CampusMapLayerMapLibre = lazy(() => import('./CampusMapLayerMapLibre'));

/**
 * MapLibre is not in the Expo Go binary. We lazy-load it only in dev / release
 * builds so Expo Go shows a placeholder instead of crashing on import.
 */
export function CampusMapLayer(props: CampusMapLayerProps) {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return <MapDevBuildPlaceholder />;
  }

  return (
    <Suspense
      fallback={<View style={[StyleSheet.absoluteFillObject, styles.loading]} />}
    >
      <CampusMapLayerMapLibre {...props} />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  loading: {
    backgroundColor: '#f2efe9',
  },
});
