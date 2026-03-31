import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  SafeAreaView,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  Alert,
  Platform,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SearchPanel, type SearchItem } from '@/components/map/SearchPanel';
import { RouteInfoCard } from '@/components/map/RouteInfoCard';
import { LocationConfirmCard } from '@/components/map/LocationConfirmCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MapViewState = 'default' | 'searching' | 'navigation' | 'building';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const UT_CAMPUS_REGION = {
  latitude: 30.2849,
  longitude: -97.7341,
  latitudeDelta: 0.013,
  longitudeDelta: 0.013,
};

const DEFAULT_USER_LOCATION = {
  latitude: 30.2824,
  longitude: -97.7323,
};

const RECENTS_STORAGE_KEY = '@convergent_map_recents';
const MAX_RECENTS = 8;
const DEFAULT_BUILDING_FLOORS = 3;

// ---------------------------------------------------------------------------
// Nominatim geocoding (OpenStreetMap — free, no API key)
// ---------------------------------------------------------------------------
async function geocodeSearch(query: string): Promise<SearchItem[]> {
  // Bias towards Austin, TX area but don't exclude other results
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '10',
    addressdetails: '1',
    viewbox: '-97.82,30.35,-97.65,30.22',
    bounded: '0',
  });

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params}`,
    { headers: { 'User-Agent': 'ConvergentApp/1.0 (university-project)' } },
  );

  if (!res.ok) return [];

  const data: any[] = await res.json();

  return data.map((place) => {
    const parts = (place.display_name as string).split(',').map((s: string) => s.trim());
    return {
      id: String(place.place_id),
      name: parts[0],
      address: parts.slice(1, 4).join(', '),
      latitude: parseFloat(place.lat),
      longitude: parseFloat(place.lon),
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Fetch a real walking route from OSRM (free, no API key). */
async function fetchWalkingRoute(
  start: { latitude: number; longitude: number },
  end: { latitude: number; longitude: number },
): Promise<{
  coords: { latitude: number; longitude: number }[];
  distanceKm: number;
  durationMin: number;
}> {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/foot/` +
      `${start.longitude},${start.latitude};${end.longitude},${end.latitude}` +
      `?overview=full&geometries=geojson`;

    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM request failed');

    const data = await res.json();
    const route = data.routes?.[0];
    if (!route) throw new Error('No route found');

    const coords = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }),
    );

    return {
      coords,
      distanceKm: route.distance / 1000,
      durationMin: Math.max(1, Math.round(route.duration / 60)),
    };
  } catch {
    // Fallback: straight line if OSRM fails
    return {
      coords: [start, end],
      distanceKm: haversineKm(
        start.latitude, start.longitude,
        end.latitude, end.longitude,
      ),
      durationMin: Math.max(
        1,
        Math.round(
          (haversineKm(start.latitude, start.longitude, end.latitude, end.longitude) / 5) * 60,
        ),
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function MapScreen() {
  // State
  const [viewState, setViewState] = useState<MapViewState>('default');
  const [query, setQuery] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<SearchItem | null>(null);
  const [userLocation, setUserLocation] = useState(DEFAULT_USER_LOCATION);
  const [selectedFloor, setSelectedFloor] = useState(1);
  const [recentSearches, setRecentSearches] = useState<SearchItem[]>([]);
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [repositionCoord, setRepositionCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [showFloorDropdown, setShowFloorDropdown] = useState(false);
  const [routeCoords, setRouteCoords] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeDistKm, setRouteDistKm] = useState(0);
  const [routeWalkMin, setRouteWalkMin] = useState(0);

  const mapRef = useRef<MapView>(null);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recents from AsyncStorage on mount
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENTS_STORAGE_KEY);
        if (stored) setRecentSearches(JSON.parse(stored));
      } catch {}
    })();
  }, []);

  // Persist recents whenever they change
  const saveRecents = useCallback(async (recents: SearchItem[]) => {
    setRecentSearches(recents);
    try {
      await AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents));
    } catch {}
  }, []);

  // Request location on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    })();
  }, []);

  // Debounced geocoding search
  useEffect(() => {
    if (query.length === 0) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await geocodeSearch(query);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 400);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Fetch real walking route when a place is selected
  useEffect(() => {
    if (!selectedPlace) {
      setRouteCoords([]);
      setRouteDistKm(0);
      setRouteWalkMin(0);
      return;
    }

    let cancelled = false;
    (async () => {
      const result = await fetchWalkingRoute(userLocation, {
        latitude: selectedPlace.latitude,
        longitude: selectedPlace.longitude,
      });
      if (!cancelled) {
        setRouteCoords(result.coords);
        setRouteDistKm(result.distanceKm);
        setRouteWalkMin(result.durationMin);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPlace, userLocation]);

  // Handlers
  const handleSelectPlace = useCallback(
    (item: SearchItem) => {
      setSelectedPlace(item);
      setQuery(item.name);
      setViewState('navigation');
      Keyboard.dismiss();

      // Add to recents (dedup, cap at MAX_RECENTS)
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s.id !== item.id);
        const updated = [item, ...filtered].slice(0, MAX_RECENTS);
        AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });

      // Fit map to show both user and destination
      mapRef.current?.fitToCoordinates(
        [userLocation, { latitude: item.latitude, longitude: item.longitude }],
        { edgePadding: { top: 140, right: 60, bottom: 280, left: 60 }, animated: true },
      );
    },
    [userLocation],
  );

  const handleBack = useCallback(() => {
    if (viewState === 'searching') {
      setViewState('default');
      setQuery('');
      setSearchResults([]);
      Keyboard.dismiss();
    } else if (viewState === 'navigation') {
      setViewState('default');
      setSelectedPlace(null);
      setQuery('');
      mapRef.current?.animateToRegion(UT_CAMPUS_REGION, 400);
    } else if (viewState === 'building') {
      setViewState('navigation');
      setIsRepositioning(false);
      setRepositionCoord(null);
      setShowFloorDropdown(false);
      if (selectedPlace) {
        mapRef.current?.fitToCoordinates(
          [userLocation, { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude }],
          { edgePadding: { top: 140, right: 60, bottom: 280, left: 60 }, animated: true },
        );
      }
    }
  }, [viewState, userLocation, selectedPlace]);

  const handleStartNavigation = useCallback(() => {
    if (!selectedPlace) return;
    setViewState('building');
    setSelectedFloor(1);
    mapRef.current?.animateToRegion(
      {
        latitude: selectedPlace.latitude - 0.001,
        longitude: selectedPlace.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      },
      500,
    );
  }, [selectedPlace]);

  const handleConfirmLocation = useCallback(() => {
    Alert.alert(
      'Location Confirmed',
      'Indoor navigation will be available once the CV model is integrated. The floor plan for this building will appear here.',
      [{ text: 'OK' }],
    );
  }, []);

  const handleReposition = useCallback(() => {
    setIsRepositioning(true);
    setRepositionCoord(userLocation);
  }, [userLocation]);

  const handleSteps = useCallback(() => {
    if (!selectedPlace) return;
    Alert.alert(
      'Walking Directions',
      `1. Head towards ${selectedPlace.name}\n2. Follow the suggested route\n3. Arrive at ${selectedPlace.name}\n   ${selectedPlace.address}\n\nEstimated: ${routeWalkMin} min (${routeDistKm.toFixed(1)} km)`,
      [{ text: 'Got it' }],
    );
  }, [selectedPlace, routeWalkMin, routeDistKm]);

  const handleClearRecents = useCallback(() => {
    saveRecents([]);
  }, [saveRecents]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Search overlay (full-screen white panel)
  if (viewState === 'searching') {
    return (
      <SafeAreaView style={styles.searchOverlay}>
        {/* Search bar */}
        <View style={styles.searchBarRow}>
          <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
            <MaterialIcons name="chevron-left" size={28} color="#000" />
          </TouchableOpacity>
          <View style={styles.searchInputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search here"
              placeholderTextColor="#999"
              autoFocus
              returnKeyType="search"
            />
          </View>
          {query.length > 0 ? (
            <TouchableOpacity
              style={styles.micBtn}
              onPress={() => {
                setQuery('');
                setSearchResults([]);
              }}
            >
              <MaterialIcons name="close" size={20} color="#666" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.micBtn}>
              <MaterialIcons name="mic" size={22} color="#666" />
            </TouchableOpacity>
          )}
        </View>
        {/* Results */}
        <SearchPanel
          recentSearches={recentSearches}
          searchResults={searchResults}
          query={query}
          loading={searchLoading}
          onSelect={handleSelectPlace}
          onClearRecents={handleClearRecents}
        />
      </SafeAreaView>
    );
  }

  // Map-based views (default, navigation, building)
  return (
    <View style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={UT_CAMPUS_REGION}
        showsUserLocation={!isRepositioning}
        showsMyLocationButton={false}
        showsCompass={false}
      >
        {/* Destination pin */}
        {selectedPlace && (viewState === 'navigation' || viewState === 'building') && (
          <Marker
            coordinate={{
              latitude: selectedPlace.latitude,
              longitude: selectedPlace.longitude,
            }}
            title={selectedPlace.name}
            description={selectedPlace.address}
          />
        )}

        {/* Route polyline */}
        {(viewState === 'navigation' || viewState === 'building') && routeCoords.length > 1 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#4A90D9"
            strokeWidth={4}
            lineDashPattern={viewState === 'building' ? undefined : [0, 10]}
            lineCap="round"
          />
        )}

        {/* Draggable user marker when repositioning */}
        {isRepositioning && repositionCoord && (
          <Marker
            coordinate={repositionCoord}
            draggable
            onDragEnd={(e) => setRepositionCoord(e.nativeEvent.coordinate)}
          >
            <View style={styles.userDotOuter}>
              <View style={styles.userDotInner} />
            </View>
          </Marker>
        )}
      </MapView>

      {/* Floating search bar */}
      <SafeAreaView style={styles.floatingBar} pointerEvents="box-none">
        <View style={styles.searchBarRow}>
          {viewState !== 'default' ? (
            <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
              <MaterialIcons name="chevron-left" size={28} color="#000" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            style={styles.searchInputWrap}
            activeOpacity={0.9}
            onPress={() => setViewState('searching')}
          >
            <Text
              style={[styles.searchInput, { color: query ? '#000' : '#999' }]}
              numberOfLines={1}
            >
              {query || 'Search here'}
            </Text>
          </TouchableOpacity>
          {viewState === 'building' ? (
            <View style={styles.buildingBarIcons}>
              <TouchableOpacity style={styles.iconBtn}>
                <MaterialIcons name="person" size={22} color="#333" />
              </TouchableOpacity>
              {/* Floor selector */}
              <TouchableOpacity
                style={styles.floorSelector}
                onPress={() => setShowFloorDropdown((v) => !v)}
              >
                <Text style={styles.floorText}>{selectedFloor}</Text>
                <MaterialIcons name="arrow-drop-down" size={20} color="#333" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.micBtn}
              onPress={() => setViewState('searching')}
            >
              <MaterialIcons name="mic" size={22} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {/* Floor dropdown */}
        {showFloorDropdown && (
          <View style={styles.floorDropdown}>
            {Array.from({ length: DEFAULT_BUILDING_FLOORS }, (_, i) => i + 1).map(
              (floor) => (
                <TouchableOpacity
                  key={floor}
                  style={[
                    styles.floorOption,
                    floor === selectedFloor && styles.floorOptionActive,
                  ]}
                  onPress={() => {
                    setSelectedFloor(floor);
                    setShowFloorDropdown(false);
                  }}
                >
                  <Text
                    style={[
                      styles.floorOptionText,
                      floor === selectedFloor && styles.floorOptionTextActive,
                    ]}
                  >
                    Floor {floor}
                  </Text>
                </TouchableOpacity>
              ),
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Bottom cards */}
      {viewState === 'navigation' && selectedPlace && (
        <RouteInfoCard
          duration={`${routeWalkMin} min`}
          distance={`${routeDistKm.toFixed(1)} km`}
          address={selectedPlace.address}
          onStart={handleStartNavigation}
          onSteps={handleSteps}
        />
      )}
      {viewState === 'building' && (
        <LocationConfirmCard
          onConfirm={handleConfirmLocation}
          onReposition={handleReposition}
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const SEARCH_BAR_SHADOW = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.1,
  shadowRadius: 8,
  elevation: 4,
} as const;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Full-screen search overlay
  searchOverlay: {
    flex: 1,
    backgroundColor: '#fff',
  },

  // Floating search bar (over map)
  floatingBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

  // Search bar row
  searchBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: Platform.OS === 'ios' ? 8 : 16,
    paddingHorizontal: 6,
    paddingVertical: 12,
    ...SEARCH_BAR_SHADOW,
  },
  backBtn: {
    paddingHorizontal: 4,
  },
  searchInputWrap: {
    flex: 1,
    paddingHorizontal: 8,
  },
  searchInput: {
    fontSize: 16,
    color: '#000',
    paddingVertical: 0,
  },
  micBtn: {
    paddingHorizontal: 8,
  },

  // Building mode icons
  buildingBarIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  iconBtn: {
    padding: 6,
  },
  floorSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  floorText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },

  // Floor dropdown
  floorDropdown: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 64 : 72,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 4,
    minWidth: 120,
    ...SEARCH_BAR_SHADOW,
  },
  floorOption: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  floorOptionActive: {
    backgroundColor: '#f5f5f5',
  },
  floorOptionText: {
    fontSize: 15,
    color: '#333',
  },
  floorOptionTextActive: {
    fontWeight: '600',
    color: '#000',
  },

  // Draggable user dot
  userDotOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(74, 144, 217, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4A90D9',
    borderWidth: 2.5,
    borderColor: '#fff',
  },
});
