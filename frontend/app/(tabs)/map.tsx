import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Alert,
  Platform,
  Animated as RNAnimated,
  ActivityIndicator,
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
import { IndoorMapView } from '@/components/map/IndoorMapView';
import type { BuildingGraph } from '@/lib/services/indoor-navigation';
import gdcGraphData from '@/assets/gdc_graph.json';
import { shadows } from '@/constants/shadows';
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
import {
  geocodeSearch,
  GeocodingNetworkError,
  localCampusSearchItem,
  type SearchItem,
} from '@/lib/services/geocoding';
import {
  fetchWalkingRoute,
  haversineKm,
  distanceToPolylineM,
  trimRouteToPosition,
  polylineDistanceKm,
} from '@/lib/services/routing';
import { useLocalSearchParams } from 'expo-router';

type MapViewState = 'default' | 'searching' | 'navigation' | 'walking' | 'building' | 'indoor';
type IndoorExitTarget = 'navigation' | 'walking' | 'building';

function destinationHasIndoorMap(place: SearchItem): boolean {
  const blob = `${place.name} ${place.address}`.toLowerCase();
  return (
    blob.includes('gdc') ||
    blob.includes('gates dell') ||
    blob.includes('gates computer science') ||
    blob.includes('melinda gates') ||
    blob.includes('bill and melinda gates')
  );
}

export default function MapScreen() {
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
  const [initialRoom, setInitialRoom] = useState<string | undefined>(undefined);
  const [roomParamActive, setRoomParamActive] = useState(true);
  const [calendarNavBusy, setCalendarNavBusy] = useState(false);
  const [calendarNavLabel, setCalendarNavLabel] = useState<string | null>(null);

  const [isListening, setIsListening] = useState(false);
  const [voicePartial, setVoicePartial] = useState('');
  const pulseAnim = useRef(new RNAnimated.Value(1)).current;
  const searchFade = useRef(new RNAnimated.Value(0)).current;

  const cameraRef = useRef<CameraRef>(null);
  const inputRef = useRef<TextInput>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const isReroutingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const previewRouteCalcPosRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const indoorExitTargetRef = useRef<IndoorExitTarget>('navigation');

  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const etaString = useMemo(() => {
    if (routeWalkMin <= 0) return '';
    const arrival = new Date(currentTime + routeWalkMin * 60_000);
    return arrival.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }, [currentTime, routeWalkMin]);

  const { searchQuery, roomQuery, calNav } = useLocalSearchParams<{
    searchQuery?: string;
    roomQuery?: string;
    calNav?: string;
  }>();

  useEffect(() => {
    if (calNav) setRoomParamActive(true);
  }, [calNav]);

  const roomQuerySingle = useMemo(() => {
    if (!roomParamActive || roomQuery == null) return undefined;
    const r = Array.isArray(roomQuery) ? roomQuery[0] : roomQuery;
    const t = typeof r === 'string' ? r.trim() : '';
    return t || undefined;
  }, [roomQuery, roomParamActive]);

  const indoorDestinationRoom = useMemo(
    () => (initialRoom && initialRoom.trim() ? initialRoom.trim() : undefined) ?? roomQuerySingle,
    [initialRoom, roomQuerySingle],
  );

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

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(RECENTS_STORAGE_KEY);
        if (stored) setRecentSearches(JSON.parse(stored));
      } catch {}
    })();
  }, []);

  const saveRecents = useCallback(async (recents: SearchItem[]) => {
    setRecentSearches(recents);
    try {
      await AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(recents));
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    })();
  }, []);

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
          const local = localCampusSearchItem(query);
          if (local) {
            setSearchResults([local]);
          } else {
            if (e instanceof GeocodingNetworkError) {
              Alert.alert('Search Unavailable', e.message);
            }
            setSearchResults([]);
          }
        }
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 700);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, userLocation]);

  const stopLocationWatcher = useCallback(() => {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
    isReroutingRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      stopLocationWatcher();
    };
  }, [stopLocationWatcher]);

  const startPreviewWatcher = useCallback(
    async (
      dest: { latitude: number; longitude: number },
      routePreviewFrom?: { latitude: number; longitude: number },
    ) => {
      stopLocationWatcher();
      previewRouteCalcPosRef.current = routePreviewFrom ?? userLocation;
      const watcher = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 10_000 },
        async (loc) => {
          const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLocation(pos);
          const prev = previewRouteCalcPosRef.current;
          if (prev && !isReroutingRef.current) {
            const moved = haversineKm(pos.latitude, pos.longitude, prev.latitude, prev.longitude) * 1000;
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

  const transitionToSearch = useCallback(() => {
    searchFade.setValue(0);
    setViewState('searching');
    RNAnimated.timing(searchFade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [searchFade]);

  const transitionFromSearch = useCallback(() => {
    RNAnimated.timing(searchFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setViewState('default');
      setQuery('');
      setSearchResults([]);
    });
    Keyboard.dismiss();
  }, [searchFade]);

  const handleSelectPlace = useCallback(
    async (
      item: SearchItem,
      routeFromOverride?: { latitude: number; longitude: number },
    ) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const origin = routeFromOverride ?? userLocation;
      setSelectedPlace(item);
      setQuery(item.name);
      setRouteLoading(true);
      setRouteCoords([]);
      setRouteDistMi(0);
      setRouteWalkMin(0);
      Keyboard.dismiss();

      RNAnimated.timing(searchFade, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
        setViewState('navigation');
      });

      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s.id !== item.id);
        const updated = [item, ...filtered].slice(0, MAX_RECENTS);
        AsyncStorage.setItem(RECENTS_STORAGE_KEY, JSON.stringify(updated)).catch(() => {});
        return updated;
      });

      const dest = { latitude: item.latitude, longitude: item.longitude };
      fitMapToCoordinates(cameraRef, [origin, dest], { top: 140, right: 60, bottom: 280, left: 60 });

      try {
        const result = await fetchWalkingRoute(origin, dest);
        setRouteCoords(result.coords);
        setRouteDistMi(result.distanceMi);
        setRouteWalkMin(result.durationMin);

        if (result.coords.length > 1) {
          fitMapToCoordinates(cameraRef, result.coords, { top: 140, right: 60, bottom: 280, left: 60 });
        }

        if (result.isFallback) {
          Alert.alert('Route Unavailable', 'Showing an estimated route. Check your connection for accurate directions.');
        }

        startPreviewWatcher(dest, routeFromOverride ?? origin);
      } finally {
        setRouteLoading(false);
      }
    },
    [userLocation, searchFade, startPreviewWatcher],
  );

  const handleSelectPlaceRef = useRef(handleSelectPlace);
  handleSelectPlaceRef.current = handleSelectPlace;

  useEffect(() => {
    if (!searchQuery) return;
    const q = Array.isArray(searchQuery) ? searchQuery[0] : searchQuery;
    const r = Array.isArray(roomQuery) ? roomQuery[0] : roomQuery;
    if (!q.trim()) return;

    setCalendarNavLabel(q);
    setCalendarNavBusy(true);
    const roomTrim = r && r.trim() ? r.trim() : undefined;
    setInitialRoom(roomTrim);

    let cancelled = false;

    const resolveOrigin = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        }
      } catch {}
      return DEFAULT_USER_LOCATION;
    };

    (async () => {
      try {
        const [firstResults, origin] = await Promise.all([
          geocodeSearch(q, DEFAULT_USER_LOCATION),
          resolveOrigin(),
        ]);
        if (cancelled) return;
        setUserLocation(origin);

        let place = firstResults[0];
        if (!place) {
          const second = await geocodeSearch(q, origin);
          if (cancelled) return;
          place = second[0];
        }

        if (cancelled) return;
        if (place) {
          await handleSelectPlaceRef.current(place, origin);
        } else {
          const local = localCampusSearchItem(q);
          if (local) {
            await handleSelectPlaceRef.current(local, origin);
          } else {
            setQuery(q);
            transitionToSearch();
            Alert.alert('Location not found', `Could not find "${q}". Try typing the building in search.`);
          }
        }
      } catch (e) {
        if (cancelled) return;
        let origin = DEFAULT_USER_LOCATION;
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            origin = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          }
        } catch {}
        const local = localCampusSearchItem(q);
        if (local) {
          setUserLocation(origin);
          try {
            await handleSelectPlaceRef.current(local, origin);
          } catch {
            setQuery(q);
            transitionToSearch();
          }
        } else {
          setQuery(q);
          transitionToSearch();
          if (e instanceof GeocodingNetworkError) {
            Alert.alert('Search Unavailable', e.message);
          }
        }
      } finally {
        if (!cancelled) {
          setCalendarNavBusy(false);
          setCalendarNavLabel(null);
        }
      }
    })();

    return () => {
      cancelled = true;
      setCalendarNavBusy(false);
      setCalendarNavLabel(null);
    };
  }, [searchQuery, roomQuery, calNav, transitionToSearch]);

  const resetToDefault = useCallback(() => {
    stopLocationWatcher();
    setShowOverview(false);
    setViewState('default');
    setQuery('');
    setRouteCoords([]);
    setRouteDistMi(0);
    setRouteWalkMin(0);
    setRouteLoading(false);
    setInitialRoom(undefined);
    setRoomParamActive(false);
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
        fitMapToCoordinates(
          cameraRef,
          [userLocation, { latitude: selectedPlace.latitude, longitude: selectedPlace.longitude }],
          { top: 140, right: 60, bottom: 280, left: 60 },
        );
      }
    } else if (viewState === 'indoor') {
      const target = indoorExitTargetRef.current;
      if (target === 'building') setViewState('building');
      else if (target === 'walking') setViewState('walking');
      else setViewState('navigation');
    }
  }, [viewState, userLocation, selectedPlace, stopLocationWatcher, transitionFromSearch, resetToDefault]);

  const handleDestinationPinPress = useCallback(() => {
    if (!selectedPlace) return;
    if (!destinationHasIndoorMap(selectedPlace)) {
      Alert.alert('Indoor map', 'Floor plans and indoor directions are only available for Gates Dell Complex (GDC) right now.');
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (viewState === 'walking' || viewState === 'navigation' || viewState === 'building') {
      indoorExitTargetRef.current = viewState;
    } else {
      indoorExitTargetRef.current = 'navigation';
    }
    const room = roomQuerySingle ?? initialRoom?.trim();
    if (room) setInitialRoom(room);
    setViewState('indoor');
  }, [selectedPlace, viewState, roomQuerySingle, initialRoom]);

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
        fitMapToCoordinates(cameraRef, result.coords, { top: 140, right: 60, bottom: 280, left: 60 });
      }
      if (result.isFallback) {
        Alert.alert('Route Unavailable', 'Showing an estimated route. Check your connection for accurate directions.');
      }
      startPreviewWatcher(dest, currentLoc);
    } finally {
      setRouteLoading(false);
    }
  }, [stopLocationWatcher, selectedPlace, userLocation, startPreviewWatcher]);

  const handleRouteOverview = useCallback(() => {
    if (showOverview) {
      setShowOverview(false);
    } else {
      setShowOverview(true);
      setTimeout(() => {
        if (routeCoords.length > 1) {
          fitMapToCoordinates(cameraRef, routeCoords, { top: 140, right: 60, bottom: 280, left: 60 });
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
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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
        Alert.alert('Route Unavailable', 'Showing an estimated route. Directions will update when connection improves.');
      }
    } finally {
      setRouteLoading(false);
    }

    setViewState('walking');

    stopLocationWatcher();
    const watcher = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
      (loc) => {
        const pos = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(pos);

        const distToDest = haversineKm(pos.latitude, pos.longitude, dest.latitude, dest.longitude) * 1000;
        if (distToDest < ARRIVAL_THRESHOLD_M) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          stopLocationWatcher();
          setSelectedFloor(1);
          setShowOverview(false);
          if (initialRoom) {
            indoorExitTargetRef.current = 'navigation';
            setViewState('indoor');
          } else {
            setViewState('building');
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
          }
          return;
        }

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
  }, [selectedPlace, userLocation, stopLocationWatcher, initialRoom]);

  const handleConfirmLocation = useCallback(() => {
    indoorExitTargetRef.current = 'building';
    setViewState('indoor');
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
      const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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

  if (viewState === 'searching') {
    return (
      <RNAnimated.View className="absolute inset-0 z-[100]" style={{ opacity: searchFade }}>
        <SafeAreaView className="flex-1 bg-white">
          <View className="flex-row items-center bg-white px-2.5 py-3 border-b border-line-muted">
            <TouchableOpacity onPress={handleBack} className="px-1">
              <MaterialIcons name="chevron-left" size={28} color="#000" />
            </TouchableOpacity>
            <View className="flex-1 px-2">
              <TextInput
                ref={inputRef}
                className="text-base text-black py-0"
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
              <TouchableOpacity className="px-2 items-center justify-center" onPress={stopVoiceSearch}>
                <RNAnimated.View
                  className="w-[22px] h-[22px] rounded-full bg-[#EA4335]"
                  style={{ transform: [{ scale: pulseAnim }] }}
                />
              </TouchableOpacity>
            ) : query.length > 0 ? (
              <TouchableOpacity
                className="px-2 items-center justify-center"
                onPress={() => {
                  setQuery('');
                  setSearchResults([]);
                }}
              >
                <MaterialIcons name="close" size={20} color="#666" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity className="px-2 items-center justify-center" onPress={startVoiceSearch}>
                <MaterialIcons name="mic" size={22} color="#666" />
              </TouchableOpacity>
            )}
          </View>
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

  if (viewState === 'indoor') {
    return (
      <SafeAreaView className="flex-1">
        <IndoorMapView
          graph={gdcGraphData as BuildingGraph}
          onExit={handleBack}
          initialDestination={indoorDestinationRoom}
        />
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1">
      <CampusMapLayer
        cameraRef={cameraRef}
        initialCenter={{ latitude: UT_CAMPUS_REGION.latitude, longitude: UT_CAMPUS_REGION.longitude }}
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
            ? { coordinate: repositionCoord, onDragEnd: setRepositionCoord }
            : null
        }
        onDestinationPress={handleDestinationPinPress}
      />

      <SafeAreaView className="absolute inset-x-0 top-0 z-10" pointerEvents="box-none">
        <View
          className={`flex-row items-center bg-white rounded-[14px] mx-4 px-1.5 py-3 ${
            Platform.OS === 'ios' ? 'mt-2' : 'mt-4'
          }`}
          style={shadows.floating}
        >
          {viewState !== 'default' ? (
            <TouchableOpacity onPress={handleBack} className="px-1">
              <MaterialIcons name="chevron-left" size={28} color="#000" />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity className="flex-1 px-2" activeOpacity={0.9} onPress={transitionToSearch}>
            <Text
              className="text-base py-0"
              style={{ color: query || calendarNavBusy ? '#000' : '#999' }}
              numberOfLines={1}
            >
              {calendarNavBusy && calendarNavLabel
                ? `Finding route to ${calendarNavLabel}…`
                : query || 'Search here'}
            </Text>
          </TouchableOpacity>
          {viewState === 'building' ? (
            <View className="flex-row items-center gap-1">
              <TouchableOpacity
                className="flex-row items-center bg-surface-alt rounded-lg px-2.5 py-1.5"
                onPress={() => setShowFloorDropdown((v) => !v)}
              >
                <Text className="text-[15px] font-semibold text-ink">{selectedFloor}</Text>
                <MaterialIcons name="arrow-drop-down" size={20} color="#333" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              className="px-2 items-center justify-center"
              onPress={() => {
                transitionToSearch();
                setTimeout(startVoiceSearch, 400);
              }}
            >
              <MaterialIcons name="mic" size={22} color="#666" />
            </TouchableOpacity>
          )}
        </View>

        {showFloorDropdown && (
          <View
            className={`absolute right-4 bg-white rounded-xl py-1 min-w-[120px] ${
              Platform.OS === 'ios' ? 'top-16' : 'top-[72px]'
            }`}
            style={shadows.floating}
          >
            {Array.from({ length: DEFAULT_BUILDING_FLOORS }, (_, i) => i + 1).map((floor) => (
              <TouchableOpacity
                key={floor}
                className={`px-4 py-3 ${floor === selectedFloor ? 'bg-surface-alt' : ''}`}
                onPress={() => {
                  setSelectedFloor(floor);
                  setShowFloorDropdown(false);
                }}
              >
                <Text
                  className={`text-[15px] ${
                    floor === selectedFloor ? 'font-semibold text-black' : 'text-ink'
                  }`}
                >
                  Floor {floor}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </SafeAreaView>

      <TouchableOpacity
        className="absolute right-4 w-12 h-12 rounded-full bg-white items-center justify-center z-10"
        style={[shadows.floating, { bottom: viewState === 'default' ? 16 : 210 }]}
        onPress={handleRecenter}
        activeOpacity={0.8}
      >
        <MaterialIcons name="my-location" size={22} color="#333" />
      </TouchableOpacity>

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
        <LocationConfirmCard onConfirm={handleConfirmLocation} onReposition={handleReposition} />
      )}

      {calendarNavBusy ? (
        <View className="absolute inset-0 bg-white/80 items-center justify-center z-50 px-6" pointerEvents="auto">
          <View
            className="items-center bg-white rounded-2xl py-7 px-7 max-w-[320px] w-full border border-line-muted"
            style={shadows.floating}
          >
            <ActivityIndicator size="large" color="#0B617E" />
            <Text className="mt-4 text-lg font-bold text-ink-strong text-center">Getting directions</Text>
            <Text className="mt-2 text-[15px] font-medium text-ink-muted text-center" numberOfLines={2}>
              {calendarNavLabel ? `To ${calendarNavLabel}` : 'Finding location…'}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
