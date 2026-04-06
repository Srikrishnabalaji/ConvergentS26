import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Keyboard,
  Alert,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';

import { CampusMapLayer } from '@/components/map/CampusMapLayer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SearchPanel } from '@/components/map/SearchPanel';
import { RouteInfoCard } from '@/components/map/RouteInfoCard';
import { LocationConfirmCard } from '@/components/map/LocationConfirmCard';
import {
  UT_CAMPUS_REGION,
  DEFAULT_USER_LOCATION,
  RECENTS_STORAGE_KEY,
  MAX_RECENTS,
  DEFAULT_BUILDING_FLOORS,
  REROUTE_THRESHOLD_M,
  ARRIVAL_THRESHOLD_M,
  PREVIEW_REROUTE_THRESHOLD_M,
  MAP_WINDOW_WIDTH,
  fitMapToCoordinates,
  animateMapToRegion,
} from '@/constants/map';
import { geocodeSearch, GeocodingNetworkError, type SearchItem } from '@/lib/services/geocoding';
import {
  fetchWalkingRoute,
  haversineKm,
  distanceToPolylineM,
  trimRouteToPosition,
  polylineDistanceKm,
} from '@/lib/services/routing';
import { useLocalSearchParams } from 'expo-router';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type MapViewState = 'default' | 'searching' | 'navigation' | 'walking' | 'building';

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
  const [routeDistMi, setRouteDistMi] = useState(0);
  const [routeWalkMin, setRouteWalkMin] = useState(0);
  const [routeLoading, setRouteLoading] = useState(false);
  const [showOverview, setShowOverview] = useState(false);

  // Voice search
  const [isListening, setIsListening] = useState(false);
  const [voicePartial, setVoicePartial] = useState('');
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;

  // Search overlay fade animation
  const searchFade = useRef(new RNAnimated.Value(0)).current;

  const cameraRef = useRef<CameraRef>(null);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const isReroutingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const previewRouteCalcPosRef = useRef<{ latitude: number; longitude: number } | null>(null);

  // Clock ticks every minute so the ETA stays accurate as real time passes
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // "Arrives at H:MM AM/PM"
  const etaString = useMemo(() => {
    if (routeWalkMin <= 0) return '';
    const arrival = new Date(currentTime + routeWalkMin * 60_000);
    return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [currentTime, routeWalkMin]);

  // Read searchQuery param passed from the calendar
  const { searchQuery } = useLocalSearchParams<{ searchQuery?: string }>();

  useEffect(() => {
    if (!searchQuery) return;
    const q = Array.isArray(searchQuery) ? searchQuery[0] : searchQuery;
    if (!q.trim()) return;

    setQuery(q);

    // Geocode immediately and auto-select the top result
    (async () => {
      try {
        const results = await geocodeSearch(q, userLocation);
        if (results.length > 0) {
          handleSelectPlace(results[0]);
        } else {
          // No match found — at least open the search panel with the text pre-filled
          transitionToSearch();
        }
      } catch {
        transitionToSearch();
      }
    })();
  }, [searchQuery]);

  // -----------------------------------------------------------------------
  // Voice search event handlers
  // -----------------------------------------------------------------------
  useSpeechRecognitionEvent('start', () => setIsListening(true));
  useSpeechRecognitionEvent('end', () => {
    setIsListening(false);
    setVoicePartial('');
    pulseAnim.stopAnimation();
    RNAnimated.spring(pulseAnim, { toValue: 1, useNativeDriver: true }).start();
  });
  useSpeechRecognitionEvent('result', (ev) => {
    const transcript = ev.results?.[0]?.transcript ?? '';
    if (ev.isFinal && transcript.length > 0) {
      setQuery(transcript);
      setIsListening(false);
      ExpoSpeechRecognitionModule.stop();
    } else {
      setVoicePartial(transcript);
    }
  });
  useSpeechRecognitionEvent('error', () => {
    setIsListening(false);
    setVoicePartial('');
  });

  // Pulsing animation while listening
  useEffect(() => {
    if (!isListening) return;
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(pulseAnim, { toValue: 1.35, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isListening, pulseAnim]);

  const startVoiceSearch = useCallback(async () => {
    try {
      const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Microphone and speech recognition permissions are needed for voice search.');
        return;
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      ExpoSpeechRecognitionModule.start({ lang: 'en-US', interimResults: true });
    } catch {
      Alert.alert('Voice Search', 'Speech recognition is not available on this device.');
    }
  }, []);

  const stopVoiceSearch = useCallback(() => {
    ExpoSpeechRecognitionModule.stop();
    setIsListening(false);
    setVoicePartial('');
  }, []);

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

  // Debounced geocoding search (now proximity-aware)
  useEffect(() => {
    if (query.length === 0) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const results = await geocodeSearch(query, userLocation, controller.signal);
        if (!controller.signal.aborted) setSearchResults(results);
      } catch (e) {
        if (!controller.signal.aborted) {
          if (e instanceof GeocodingNetworkError) {
            Alert.alert('Search Unavailable', e.message);
          }
          setSearchResults([]);
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 700);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, userLocation]);

  // Stop location watcher helper
  const stopLocationWatcher = useCallback(() => {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
    isReroutingRef.current = false;
  }, []);

  // Cleanup watcher on unmount
  useEffect(() => {
    return () => {
      stopLocationWatcher();
    };
  }, [stopLocationWatcher]);

  const startPreviewWatcher = useCallback(
    async (dest: { latitude: number; longitude: number }) => {
      stopLocationWatcher();
      previewRouteCalcPosRef.current = userLocation;

      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 10_000 },
        async (loc) => {
          const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(pos);

          const prev = previewRouteCalcPosRef.current;
          if (prev && !isReroutingRef.current) {
            const moved =
              haversineKm(pos.latitude, pos.longitude, prev.latitude, prev.longitude) * 1000;
            if (moved > PREVIEW_REROUTE_THRESHOLD_M) {
              isReroutingRef.current = true;
              previewRouteCalcPosRef.current = pos;
              try {
                const result = await fetchWalkingRoute(pos, dest);
                setRouteCoords(result.coords);
                setRouteDistMi(result.distanceMi);
                setRouteWalkMin(result.durationMin);
              } finally {
                isReroutingRef.current = false;
              }
            }
          }
        },
      );
      locationWatcherRef.current = watcher;
    },
    [userLocation, stopLocationWatcher],
  );

  // -----------------------------------------------------------------------
  // View state transitions with animation
  // -----------------------------------------------------------------------
  const transitionToSearch = useCallback(() => {
    searchFade.setValue(0);
    setViewState('searching');
    RNAnimated.timing(searchFade, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [searchFade]);

  const transitionFromSearch = useCallback(() => {
    RNAnimated.timing(searchFade, {
      toValue: 0,
      duration: 150,
      useNativeDriver: true,
    }).start(() => {
      setViewState('default');
      setQuery('');
      setSearchResults([]);
    });
    Keyboard.dismiss();
  }, [searchFade]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  const handleSelectPlace = useCallback(
    async (item: SearchItem) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSelectedPlace(item);
      setQuery(item.name);
      setRouteLoading(true);
      setRouteCoords([]);
      setRouteDistMi(0);
      setRouteWalkMin(0);
      Keyboard.dismiss();

      // Animate out of search overlay then into navigation
      RNAnimated.timing(searchFade, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start(() => {
        setViewState('navigation');
      });

      // Add to recents (dedup, cap at MAX_RECENTS)
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s.id !== item.id);
        const updated = [item, ...filtered].slice(0, MAX_RECENTS);
        AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });

      // Fit map to show both user and destination
      const dest = { latitude: item.latitude, longitude: item.longitude };
      fitMapToCoordinates(
        cameraRef,
        [userLocation, dest],
        { top: 140, right: 60, bottom: 280, left: 60 },
      );

      // Fetch real walking route
      try {
        const result = await fetchWalkingRoute(userLocation, dest);
        setRouteCoords(result.coords);
        setRouteDistMi(result.distanceMi);
        setRouteWalkMin(result.durationMin);

        if (result.coords.length > 1) {
          fitMapToCoordinates(cameraRef, result.coords, {
            top: 140,
            right: 60,
            bottom: 280,
            left: 60,
          });
        }

        if (result.isFallback) {
          Alert.alert(
            'Route Unavailable',
            'Showing an estimated route. Check your connection for accurate directions.',
          );
        }

        startPreviewWatcher(dest);
      } finally {
        setRouteLoading(false);
      }
    },
    [userLocation, searchFade, startPreviewWatcher],
  );

  const resetToDefault = useCallback(() => {
    stopLocationWatcher();
    setShowOverview(false);
    setViewState('default');
    setQuery('');
    setRouteCoords([]);
    setRouteDistMi(0);
    setRouteWalkMin(0);
    setRouteLoading(false);
    // Delay clearing selectedPlace so PointAnnotation doesn't unmount mid-frame
    setTimeout(() => setSelectedPlace(null), 50);
  }, [stopLocationWatcher]);

  const handleBack = useCallback(() => {
    if (viewState === 'searching') {
      transitionFromSearch();
    } else if (viewState === 'navigation') {
      resetToDefault();
      animateMapToRegion(cameraRef, UT_CAMPUS_REGION, 400);
    } else if (viewState === 'walking') {
      resetToDefault();
      setTimeout(() => animateMapToRegion(cameraRef, UT_CAMPUS_REGION, 400), 100);
    } else if (viewState === 'building') {
      setViewState('navigation');
      stopLocationWatcher();
      setIsRepositioning(false);
      setRepositionCoord(null);
      setShowFloorDropdown(false);
      if (selectedPlace) {
        fitMapToCoordinates(cameraRef, [
          userLocation,
          { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude },
        ], { top: 140, right: 60, bottom: 280, left: 60 });
      }
    }
  }, [viewState, userLocation, selectedPlace, stopLocationWatcher, transitionFromSearch, resetToDefault]);

  const handleExitNavigation = useCallback(async () => {
    stopLocationWatcher();
    setShowOverview(false);
    setViewState('navigation');

    if (!selectedPlace) return;

    const dest = { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude };

    setRouteLoading(true);
    let currentLoc = userLocation;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      currentLoc = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(currentLoc);
    } catch {}

    try {
      const result = await fetchWalkingRoute(currentLoc, dest);
      setRouteCoords(result.coords);
      setRouteDistMi(result.distanceMi);
      setRouteWalkMin(result.durationMin);

      if (result.coords.length > 1) {
        fitMapToCoordinates(cameraRef, result.coords, {
          top: 140,
          right: 60,
          bottom: 280,
          left: 60,
        });
      }

      if (result.isFallback) {
        Alert.alert(
          'Route Unavailable',
          'Showing an estimated route. Check your connection for accurate directions.',
        );
      }

      startPreviewWatcher(dest);
    } finally {
      setRouteLoading(false);
    }
  }, [stopLocationWatcher, selectedPlace, userLocation, startPreviewWatcher]);

  // Route overview: toggle between overview and follow-me
  const handleRouteOverview = useCallback(() => {
    if (showOverview) {
      // Resume following
      setShowOverview(false);
    } else {
      // Show overview: disable follow, fit route
      setShowOverview(true);
      setTimeout(() => {
        if (routeCoords.length > 1) {
          fitMapToCoordinates(cameraRef, routeCoords, {
            top: 140,
            right: 60,
            bottom: 280,
            left: 60,
          });
        }
      }, 50);
    }
  }, [showOverview, routeCoords]);

  const handleStartNavigation = useCallback(async () => {
    if (!selectedPlace) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRouteLoading(true);
    setShowOverview(false);
    let currentLoc = userLocation;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      currentLoc = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLocation(currentLoc);
    } catch {}

    const dest = { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude };

    try {
      const result = await fetchWalkingRoute(currentLoc, dest);
      setRouteCoords(result.coords);
      setRouteDistMi(result.distanceMi);
      setRouteWalkMin(result.durationMin);

      if (result.isFallback) {
        Alert.alert(
          'Route Unavailable',
          'Showing an estimated route. Directions will update when connection improves.',
        );
      }
    } finally {
      setRouteLoading(false);
    }

    setViewState('walking');

    stopLocationWatcher();
    const watcher = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 5,
        timeInterval: 3000,
      },
      (loc) => {
        const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(pos);

        // Check arrival
        const distToDest = haversineKm(pos.latitude, pos.longitude, dest.latitude, dest.longitude) * 1000;
        if (distToDest < ARRIVAL_THRESHOLD_M) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          stopLocationWatcher();
          setViewState('building');
          setSelectedFloor(1);
          setShowOverview(false);
          animateMapToRegion(
            cameraRef,
            {
              latitude: dest.latitude - 0.001,
              longitude: dest.longitude,
              latitudeDelta: 0.005,
              longitudeDelta: 0.005,
            },
            500,
          );
          return;
        }

        // Trim completed portion behind user and check rerouting
        setRouteCoords((currentRouteCoords) => {
          if (currentRouteCoords.length < 2 || isReroutingRef.current) return currentRouteCoords;

          const trimmed = trimRouteToPosition(pos, currentRouteCoords);
          const remainingKm = polylineDistanceKm(trimmed);
          const remainingMi = remainingKm * 0.621371;
          setRouteDistMi(remainingMi);
          setRouteWalkMin(Math.max(1, Math.round((remainingMi / 3.1) * 60)));

          const offRouteDist = distanceToPolylineM(pos, trimmed);
          if (offRouteDist > REROUTE_THRESHOLD_M) {
            isReroutingRef.current = true;
            fetchWalkingRoute(pos, dest)
              .then((result) => {
                setRouteCoords(result.coords);
                setRouteDistMi(result.distanceMi);
                setRouteWalkMin(result.durationMin);
              })
              .finally(() => {
                isReroutingRef.current = false;
              });
          }

          return trimmed;
        });
      },
    );
    locationWatcherRef.current = watcher;
  }, [selectedPlace, userLocation, stopLocationWatcher]);

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

  const handleClearRecents = useCallback(() => {
    saveRecents([]);
  }, [saveRecents]);

  const handleRecenter = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowOverview(false);

    let coord = userLocation;
    try {
      const fresh = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      coord = { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
      setUserLocation(coord);
    } catch {}

    cameraRef.current?.setCamera({
      centerCoordinate: [coord.longitude, coord.latitude],
      zoomLevel: viewState === 'walking' ? 17 : 16,
      animationDuration: 500,
      animationMode: 'easeTo',
    });
  }, [viewState, userLocation]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  // Search overlay (animated fade-in)
  if (viewState === 'searching') {
    return (
      <RNAnimated.View style={[styles.searchOverlayWrap, { opacity: searchFade }]}>
        <SafeAreaView style={styles.searchOverlay}>
          {/* Search bar */}
          <View style={styles.searchOverlayBar}>
            <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
              <MaterialIcons name="chevron-left" size={28} color="#000" />
            </TouchableOpacity>
            <View style={styles.searchInputWrap}>
              <TextInput
                ref={inputRef}
                style={styles.searchInput}
                value={isListening ? voicePartial || 'Listening…' : query}
                onChangeText={setQuery}
                placeholder="Search here"
                placeholderTextColor="#999"
                autoFocus
                returnKeyType="search"
                editable={!isListening}
              />
            </View>
            {isListening ? (
              <TouchableOpacity style={styles.micBtn} onPress={stopVoiceSearch}>
                <RNAnimated.View
                  style={[
                    styles.listeningDot,
                    { transform: [{ scale: pulseAnim }] },
                  ]}
                />
              </TouchableOpacity>
            ) : query.length > 0 ? (
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
              <TouchableOpacity style={styles.micBtn} onPress={startVoiceSearch}>
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
      </RNAnimated.View>
    );
  }

  // Map-based views (default, navigation, walking, building)
  return (
    <View style={styles.container}>
      {/* Map */}
      <CampusMapLayer
        cameraRef={cameraRef}
        initialCenter={{
          latitude: UT_CAMPUS_REGION.latitude,
          longitude: UT_CAMPUS_REGION.longitude,
        }}
        initialLongitudeDelta={UT_CAMPUS_REGION.longitudeDelta}
        mapWidth={MAP_WINDOW_WIDTH}
        showsUserLocation={!isRepositioning}
        followUserLocation={viewState === 'walking' && !showOverview}
        followUserHeading={viewState === 'walking' && !showOverview}
        destination={
          selectedPlace &&
          (viewState === 'navigation' || viewState === 'walking' || viewState === 'building')
            ? {
                latitude: selectedPlace.latitude,
                longitude: selectedPlace.longitude,
                title: selectedPlace.name,
                subtitle: selectedPlace.address,
              }
            : null
        }
        routeCoordinates={routeCoords}
        showRoute={
          (viewState === 'navigation' || viewState === 'walking' || viewState === 'building') &&
          routeCoords.length > 1
        }
        repositionMarker={
          isRepositioning && repositionCoord
            ? {
                coordinate: repositionCoord,
                onDragEnd: setRepositionCoord,
              }
            : null
        }
      />

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
            onPress={transitionToSearch}
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
              onPress={() => {
                transitionToSearch();
                setTimeout(startVoiceSearch, 400);
              }}
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

      {/* Recenter button */}
      <TouchableOpacity
        style={[styles.recenterBtn, { bottom: viewState === 'default' ? 16 : 210 }]}
        onPress={handleRecenter}
        activeOpacity={0.8}
      >
        <MaterialIcons name="my-location" size={22} color="#333" />
      </TouchableOpacity>

      {/* Bottom cards */}
      {viewState === 'navigation' && selectedPlace && (
        <RouteInfoCard
          duration={`${routeWalkMin} min`}
          distance={`${routeDistMi.toFixed(1)} mi`}
          eta={etaString}
          address={selectedPlace.address}
          loading={routeLoading}
          onStart={handleStartNavigation}
        />
      )}
      {viewState === 'walking' && selectedPlace && (
        <RouteInfoCard
          duration={`${routeWalkMin} min`}
          distance={`${routeDistMi.toFixed(1)} mi`}
          eta={etaString}
          address={selectedPlace.address}
          loading={routeLoading}
          onStart={handleStartNavigation}
          onExit={handleExitNavigation}
          onOverview={handleRouteOverview}
          showingOverview={showOverview}
          isWalking
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

  searchOverlayWrap: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  searchOverlay: {
    flex: 1,
    backgroundColor: '#fff',
  },

  searchOverlayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d0d0d0',
  },

  floatingBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },

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
    alignItems: 'center',
    justifyContent: 'center',
  },
  listeningDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#EA4335',
  },

  buildingBarIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
  recenterBtn: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...SEARCH_BAR_SHADOW,
  },
});
