import React from 'react';

import { MapDevBuildPlaceholder } from './MapDevBuildPlaceholder';
import type { CampusMapLayerProps } from './CampusMapLayer.types';

/** MapLibre is native-only; web build shows the same dev-build hint as Expo Go. */
export function CampusMapLayer(_props: CampusMapLayerProps) {
  return <MapDevBuildPlaceholder />;
}
