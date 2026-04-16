import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Modal,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
import { supabase } from '../../lib/supabase';
import { geocodeSearch, type SearchItem, GeocodingNetworkError } from '@/lib/services/geocoding';
import { DEFAULT_USER_LOCATION } from '@/constants/map';
import { searchRooms } from '@/lib/services/indoor-navigation';
import gdcGraphData from '@/assets/gdc_graph.json';
import type { BuildingGraph, GraphNode } from '@/lib/services/indoor-navigation';
import { parseLocationString, UT_BUILDINGS } from '@/lib/data/utBuildings';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const getTodayString = () => {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0'),
  ].join('-');
};

const parseTimeString = (timeStr: string) => {
  if (!timeStr || timeStr.toLowerCase() === 'now') return new Date();
  try {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return new Date();
    const [, hoursStr, minutesStr, period] = match;
    let hours = parseInt(hoursStr, 10);
    const minutes = parseInt(minutesStr, 10);
    if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;
  } catch {
    return new Date();
  }
};

const extractBuilding = (location: string): string =>
  location
    .replace(/[-–]\s*(room|rm|suite|ste|floor|fl|#)\s*[\w.]+/gi, '')
    .replace(/\s+(room|rm|suite|ste|floor|fl|#)\s*[\w.]+/gi, '')
    .trim();

const validateBuilding = async (location: string): Promise<boolean> => {
  if (!location.trim()) return true;
  const building = extractBuilding(location);
  if (!building) return true;
  try {
    const results = await geocodeSearch(building, DEFAULT_USER_LOCATION);
    return results.length > 0;
  } catch (e) {
    if (e instanceof GeocodingNetworkError) return true;
    return false;
  }
};

function formatUpcomingDate(dateStr: string): string {
  const today = getTodayString();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tomorrow = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  if (dateStr === today) return 'Today';
  if (dateStr === tomorrow) return 'Tomorrow';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function formatSelectedDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function eventGroupId(e: { groupId?: unknown; group_id?: unknown }): string | null {
  const g = e.groupId ?? e.group_id;
  if (g == null || g === '') return null;
  return String(g);
}

const TODAY = getTodayString();
const PRIMARY = '#0B617E';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------
export default function CalendarScreen() {
  const router = useRouter();
  const { groupId: paramGroupId } = useLocalSearchParams<{ groupId?: string }>();
  const paramGroupIdSingle = Array.isArray(paramGroupId) ? paramGroupId[0] : paramGroupId;

  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [events, setEvents] = useState<Record<string, any[]>>({});
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [selectedGroupFilterId, setSelectedGroupFilterId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timeValue, setTimeValue] = useState(new Date());

  const [locationSuggestions, setLocationSuggestions] = useState<SearchItem[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [roomSuggestions, setRoomSuggestions] = useState<GraphNode[]>([]);
  const [roomSearching, setRoomSearching] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);
  const roomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [newEvent, setNewEvent] = useState<{
    title: string;
    building: string;
    room: string;
    time: string;
    notify: boolean;
    notifyInAdvance: number | null;
    groupId: string | null;
  }>({
    title: '',
    building: '',
    room: '',
    time: '',
    notify: false,
    notifyInAdvance: null,
    groupId: null,
  });

  // -------------------------------------------------------------------------
  // Fetch data
  // -------------------------------------------------------------------------
  const fetchEvents = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Only fetch groups the current user belongs to
    const { data: memberData } = await supabase
      .from('group_members')
      .select('groups(id, name)')
      .eq('user_id', user.id);

    if (memberData) {
      const userGroups = memberData
        .map((r: any) => r.groups)
        .filter(Boolean)
        .sort((a: any, b: any) => a.name.localeCompare(b.name));
      setGroups(userGroups);
    }

    const { data: eventData, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      console.error('Error fetching events:', error);
      return;
    }

    if (eventData) {
      const formattedEvents: Record<string, any[]> = {};
      eventData.forEach((event: any) => {
        if (!formattedEvents[event.event_date]) formattedEvents[event.event_date] = [];
        formattedEvents[event.event_date].push({
          id: event.id,
          title: event.title,
          location: event.location,
          time: event.time,
          notify: event.notify,
          notifyInAdvance: event.notify_in_advance,
          groupId: event.group_id,
        });
      });
      setEvents(formattedEvents);
    }
  };

  useEffect(() => {
    fetchEvents();
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }
    })();
  }, []);

  // Deep-link: auto-select a group's chip when navigating from the Groups tab
  useEffect(() => {
    if (paramGroupIdSingle) {
      setSelectedGroupFilterId(paramGroupIdSingle);
    }
  }, [paramGroupIdSingle]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const eventsVisibleByFilter = useMemo(() => {
    if (!selectedGroupFilterId) return events;
    const out: Record<string, any[]> = {};
    Object.keys(events).forEach((date) => {
      const filtered = (events[date] ?? []).filter(
        (e) => eventGroupId(e) === selectedGroupFilterId
      );
      if (filtered.length) out[date] = filtered;
    });
    return out;
  }, [events, selectedGroupFilterId]);

  const markedDates = useMemo(() => {
    const marked: Record<string, any> = {};
    Object.keys(eventsVisibleByFilter).forEach((date) => {
      if ((eventsVisibleByFilter[date]?.length ?? 0) > 0) {
        marked[date] = { marked: true, dotColor: PRIMARY };
      }
    });
    marked[selectedDate] = {
      ...(marked[selectedDate] ?? {}),
      selected: true,
      selectedColor: PRIMARY,
    };
    return marked;
  }, [selectedDate, eventsVisibleByFilter]);

  const sortedEvents = useMemo(() => {
    const dayEvents = eventsVisibleByFilter[selectedDate] ?? [];
    return [...dayEvents].sort(
      (a, b) => parseTimeString(a.time).getTime() - parseTimeString(b.time).getTime()
    );
  }, [eventsVisibleByFilter, selectedDate]);

  const upcomingEvents = useMemo(() => {
    const now = new Date();
    const todayStr = getTodayString();
    const result: Array<{ date: string; event: any }> = [];
    const sortedDates = Object.keys(eventsVisibleByFilter).sort();
    for (const date of sortedDates) {
      if (date < todayStr) continue;
      for (const event of eventsVisibleByFilter[date] ?? []) {
        if (date === todayStr) {
          if (parseTimeString(event.time) < now) continue;
        }
        result.push({ date, event });
      }
    }
    result.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return parseTimeString(a.event.time).getTime() - parseTimeString(b.event.time).getTime();
    });
    return result.slice(0, 3);
  }, [eventsVisibleByFilter]);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  const handleEventPress = (location: string) => {
    if (!location?.trim()) return;
    const { building, room } = parseLocationString(location);
    router.push({
      pathname: '/(tabs)/map',
      params: {
        searchQuery: building || location,
        ...(room ? { roomQuery: room } : {}),
        calNav: String(Date.now()),
      },
    });
  };

  // -------------------------------------------------------------------------
  // Time picker
  // -------------------------------------------------------------------------
  const onTimeChange = (_event: any, selectedTime?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedTime) {
      setTimeValue(selectedTime);
      setNewEvent(prev => ({
        ...prev,
        time: selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
    }
  };

  // -------------------------------------------------------------------------
  // Modal open/close
  // -------------------------------------------------------------------------
  const handleOpenAddModal = () => {
    setEditingEventId(null);
    setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null });
    setTimeValue(new Date());
    setShowTimePicker(false);
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomSuggestions([]);
    setRoomSearching(false);
    setRoomError(null);
  };

  const handleOpenEditModal = (event: any) => {
    setEditingEventId(event.id);
    const stored: string = event.location ?? '';
    const dashIdx = stored.indexOf(' - ');
    const building = dashIdx !== -1 ? stored.slice(0, dashIdx) : stored;
    const room = dashIdx !== -1 ? stored.slice(dashIdx + 3) : '';
    setNewEvent({
      title: event.title,
      building,
      room,
      time: event.time,
      notify: event.notify,
      notifyInAdvance: event.notifyInAdvance ?? null,
      groupId: event.groupId ?? event.group_id ?? null,
    });
    setTimeValue(parseTimeString(event.time));
    setShowTimePicker(false);
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomSuggestions([]);
    setRoomSearching(false);
    setRoomError(null);
  };

  // -------------------------------------------------------------------------
  // Location / room autocomplete
  // -------------------------------------------------------------------------
  const handleBuildingChange = (text: string) => {
    setNewEvent(prev => ({ ...prev, building: text, room: '' }));
    setRoomError(null);

    if (!text.trim()) {
      setLocationSuggestions([]);
      setLocationSearching(false);
      return;
    }

    const q = text.trim().toLowerCase();
    const utMatches = UT_BUILDINGS.filter(b =>
      b.code.toLowerCase().startsWith(q) ||
      b.displayName.toLowerCase().includes(q) ||
      b.fullName.toLowerCase().includes(q) ||
      (b.aliases ?? []).some(a => a.startsWith(q))
    ).slice(0, 6);

    if (utMatches.length > 0) {
      setLocationSuggestions(
        utMatches.map(b => ({ id: b.code, name: b.code, address: b.displayName, latitude: 0, longitude: 0 }))
      );
      setLocationSearching(false);
    } else {
      setLocationSuggestions([]);
      setLocationSearching(true);
      if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
      locationDebounceRef.current = setTimeout(async () => {
        try {
          const results = await geocodeSearch(text, DEFAULT_USER_LOCATION);
          setLocationSuggestions(results);
        } catch {
          setLocationSuggestions([]);
        } finally {
          setLocationSearching(false);
        }
      }, 400);
    }
  };

  const handleSelectBuildingSuggestion = (item: SearchItem) => {
    setNewEvent(prev => ({ ...prev, building: item.name, room: '' }));
    setLocationSuggestions([]);
    setRoomError(null);
    Keyboard.dismiss();
  };

  const handleRoomChange = (text: string) => {
    setNewEvent(prev => ({ ...prev, room: text }));
    setRoomError(null);
    setRoomSuggestions([]);
    if (!text.trim()) { setRoomSearching(false); return; }
    if (roomDebounceRef.current) clearTimeout(roomDebounceRef.current);
    setRoomSearching(true);
    roomDebounceRef.current = setTimeout(() => {
      const results = searchRooms(gdcGraphData as BuildingGraph, text);
      setRoomSuggestions(results.slice(0, 5));
      setRoomSearching(false);
    }, 200);
  };

  const handleSelectRoomSuggestion = (node: GraphNode) => {
    setNewEvent(prev => ({ ...prev, room: node.label }));
    setRoomSuggestions([]);
    setRoomError(null);
    Keyboard.dismiss();
  };

  // -------------------------------------------------------------------------
  // Save / delete
  // -------------------------------------------------------------------------
  const handleSaveEvent = async () => {
    if (!newEvent.title.trim()) {
      Alert.alert('Missing title', 'Please enter an event title.');
      return;
    }
    if (!newEvent.time) {
      Alert.alert('Missing time', 'Please select a time for this event.');
      return;
    }

    if (newEvent.building.trim()) {
      const isValid = await validateBuilding(newEvent.building);
      if (!isValid) {
        Alert.alert(
          'Unknown building',
          `"${newEvent.building}" wasn't found on campus. Please check the building name.`
        );
        return;
      }
    }

    if (newEvent.room.trim()) {
      const roomResults = searchRooms(gdcGraphData as BuildingGraph, newEvent.room);
      const exactMatch = roomResults.some(
        n => n.label.toLowerCase() === newEvent.room.trim().toLowerCase()
      );
      if (!exactMatch) {
        Alert.alert(
          'Unknown room',
          `"${newEvent.room}" wasn't found in this building. Please select a room from the suggestions.`
        );
        return;
      }
    }

    const combinedLocation = newEvent.building.trim()
      ? newEvent.room.trim()
        ? `${newEvent.building.trim()} - ${newEvent.room.trim()}`
        : newEvent.building.trim()
      : '';

    if (newEvent.notify && newEvent.notifyInAdvance != null) {
      const [year, month, day] = selectedDate.split('-');
      const eventTime = new Date(
        parseInt(year), parseInt(month) - 1, parseInt(day),
        timeValue.getHours(), timeValue.getMinutes()
      );
      const triggerDate = new Date(eventTime.getTime() - newEvent.notifyInAdvance * 60000);
      if (triggerDate > new Date()) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: newEvent.title,
            body: combinedLocation ? `Head to ${combinedLocation}` : 'Your event is starting!',
            sound: true,
          },
          trigger: { type: 'date', date: triggerDate } as Notifications.DateTriggerInput,
        });
      } else {
        Alert.alert('Note', 'The notification time is in the past — you won\'t be notified for this event.');
      }
    }

    const eventId = editingEventId ?? Date.now().toString();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('events').upsert({
      id: eventId,
      user_id: user?.id,
      event_date: selectedDate,
      title: newEvent.title,
      location: combinedLocation,
      time: newEvent.time,
      notify: newEvent.notify,
      notify_in_advance: newEvent.notifyInAdvance,
      group_id: newEvent.groupId,
    });

    if (error) {
      Alert.alert('Error', 'Could not save event. Please try again.');
      console.error('Supabase error:', error);
      return;
    }

    const localEvent = {
      id: eventId,
      title: newEvent.title,
      location: combinedLocation,
      time: newEvent.time,
      notify: newEvent.notify,
      notifyInAdvance: newEvent.notifyInAdvance,
      groupId: newEvent.groupId,
      group_id: newEvent.groupId,
    };

    setEvents(prev => {
      const current = prev[selectedDate] ?? [];
      return {
        ...prev,
        [selectedDate]: editingEventId
          ? current.map(e => e.id === editingEventId ? localEvent : e)
          : [...current, localEvent],
      };
    });

    setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null });
    setTimeValue(new Date());
    setEditingEventId(null);
    setShowTimePicker(false);
    setShowAddModal(false);
  };

  const handleDeleteEvent = () => {
    if (!editingEventId) return;
    Alert.alert('Delete event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('events').delete().eq('id', editingEventId);
          if (error) {
            Alert.alert('Error', 'Could not delete event.');
            return;
          }
          setEvents(prev => ({
            ...prev,
            [selectedDate]: (prev[selectedDate] ?? []).filter(e => e.id !== editingEventId),
          }));
          setShowAddModal(false);
          setEditingEventId(null);
        },
      },
    ]);
  };

  // -------------------------------------------------------------------------
  // Event card
  // -------------------------------------------------------------------------
  const renderEventCard = (item: any) => {
    const groupName = item.groupId
      ? groups.find(g => String(g.id) === String(item.groupId))?.name
      : null;

    return (
      <View key={String(item.id)} style={styles.eventCardWrap}>
        <TouchableOpacity
          style={styles.eventCardTouchable}
          onPress={() => handleEventPress(item.location)}
          activeOpacity={0.72}
        >
          <View style={styles.eventTimeCol}>
            <Text style={styles.eventTime}>{item.time}</Text>
          </View>
          <View style={styles.eventTextCol}>
            <Text style={styles.eventTitle} numberOfLines={2}>{item.title}</Text>
            {item.location ? (
              <Text style={styles.eventSubtitle} numberOfLines={1}>{item.location}</Text>
            ) : null}
            {groupName ? (
              <View style={styles.eventGroupBadge}>
                <MaterialIcons name="groups" size={11} color={PRIMARY} style={{ marginRight: 3 }} />
                <Text style={styles.eventGroupBadgeText}>{groupName}</Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.eventEditBtn}
          onPress={() => handleOpenEditModal(item)}
          accessibilityLabel="Edit event"
        >
          <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
          <Text style={styles.eventEditBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>

      {/* ── Add / Edit event modal ── */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowAddModal(false)}>
            <Pressable style={styles.modalContent} onPress={e => e.stopPropagation()}>

              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingEventId ? 'Edit Event' : 'New Event'}</Text>
                <Text style={styles.modalDate}>{formatSelectedDate(selectedDate)}</Text>
              </View>

              <ScrollView style={styles.formContainer} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

                {/* Group */}
                <Text style={styles.label}>Group</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, !newEvent.groupId && styles.chipSelected]}
                    onPress={() => setNewEvent(prev => ({ ...prev, groupId: null }))}
                  >
                    <Text style={[styles.chipText, !newEvent.groupId && styles.chipTextSelected]}>None</Text>
                  </TouchableOpacity>
                  {groups.map(group => {
                    const isSelected = String(newEvent.groupId) === String(group.id);
                    return (
                      <TouchableOpacity
                        key={group.id}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => setNewEvent(prev => ({ ...prev, groupId: String(group.id) }))}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{group.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Title */}
                <Text style={styles.label}>Event Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. CS313E Class"
                  value={newEvent.title}
                  onChangeText={text => setNewEvent(prev => ({ ...prev, title: text }))}
                  placeholderTextColor="#999"
                />

                {/* Location */}
                <Text style={styles.label}>Location</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      placeholder="Building (GDC, PCL…)"
                      value={newEvent.building}
                      onChangeText={handleBuildingChange}
                      placeholderTextColor="#999"
                    />
                    {locationSearching && (
                      <Text style={styles.searchingHint}>Searching…</Text>
                    )}
                    {locationSuggestions.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        {locationSuggestions.map(item => (
                          <TouchableOpacity
                            key={item.id}
                            style={styles.suggestionRow}
                            onPress={() => handleSelectBuildingSuggestion(item)}
                          >
                            <MaterialIcons name="location-on" size={16} color={PRIMARY} style={{ marginRight: 8 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.suggestionName} numberOfLines={1}>{item.name}</Text>
                              {item.address ? (
                                <Text style={styles.suggestionAddress} numberOfLines={1}>{item.address}</Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={{ width: 90 }}>
                    <TextInput
                      style={[styles.input, !newEvent.building.trim() && { opacity: 0.5 }]}
                      placeholder="Room"
                      value={newEvent.room}
                      onChangeText={handleRoomChange}
                      placeholderTextColor="#999"
                      editable={!!newEvent.building.trim()}
                    />
                    {roomSearching && <Text style={styles.searchingHint}>…</Text>}
                    {roomSuggestions.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        {roomSuggestions.map(node => (
                          <TouchableOpacity
                            key={node.id}
                            style={styles.suggestionRow}
                            onPress={() => handleSelectRoomSuggestion(node)}
                          >
                            <Text style={styles.suggestionName}>{node.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {roomError ? <Text style={styles.errorHint}>{roomError}</Text> : null}
                  </View>
                </View>

                {/* Time */}
                <Text style={styles.label}>Time *</Text>
                <TouchableOpacity style={styles.timeSelector} onPress={() => setShowTimePicker(true)}>
                  <MaterialIcons name="access-time" size={20} color={PRIMARY} style={{ marginRight: 8 }} />
                  <Text style={[styles.timeSelectorText, !newEvent.time && { color: '#999' }]}>
                    {newEvent.time || 'Tap to select time'}
                  </Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <View style={Platform.OS === 'ios' ? styles.iosPickerContainer : undefined}>
                    <DateTimePicker
                      value={timeValue}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={onTimeChange}
                      textColor="#000000"
                      themeVariant="light"
                    />
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity style={styles.iosPickerDoneButton} onPress={() => setShowTimePicker(false)}>
                        <Text style={styles.iosPickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Alert */}
                <Text style={styles.label}>Alert</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                  {[
                    { label: 'None', value: null },
                    { label: 'At start', value: 0 },
                    { label: '10 min before', value: 10 },
                    { label: '1 hour before', value: 60 },
                  ].map(option => {
                    const isSelected = newEvent.notifyInAdvance === option.value;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => setNewEvent(prev => ({
                          ...prev,
                          notifyInAdvance: option.value,
                          notify: option.value !== null,
                        }))}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{option.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {editingEventId && (
                  <TouchableOpacity style={styles.deleteFormButton} onPress={handleDeleteEvent}>
                    <MaterialIcons name="delete-outline" size={18} color="#dc2626" style={{ marginRight: 6 }} />
                    <Text style={styles.deleteFormText}>Delete Event</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAddModal(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveButton} onPress={handleSaveEvent}>
                  <Text style={styles.saveButtonText}>{editingEventId ? 'Update' : 'Save'}</Text>
                </TouchableOpacity>
              </View>

            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.banner}>
        <View style={styles.headerBlock}>
          <Text style={styles.pageTitle}>Calendar</Text>
          <TouchableOpacity style={styles.headerAddBtn} onPress={handleOpenAddModal} accessibilityLabel="Add event">
            <MaterialIcons name="add" size={22} color={PRIMARY} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.contentContainer}>
        <ScrollView
          style={styles.scrollPage}
          contentContainerStyle={styles.scrollPageContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        >

          {/* ── Group filter chip bar ── */}
          {groups.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipScroll}
              style={styles.filterChipBar}
            >
              <TouchableOpacity
                style={[styles.filterChip, !selectedGroupFilterId && styles.filterChipSelected]}
                onPress={() => setSelectedGroupFilterId(null)}
                activeOpacity={0.8}
              >
                <Text style={[styles.filterChipText, !selectedGroupFilterId && styles.filterChipTextSelected]}>
                  All
                </Text>
              </TouchableOpacity>
              {groups.map(g => {
                const selected = selectedGroupFilterId === String(g.id);
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.filterChip, selected && styles.filterChipSelected]}
                    onPress={() => setSelectedGroupFilterId(String(g.id))}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                      {g.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* ── Calendar ── */}
          <View style={styles.calendarCard}>
            <Calendar
              current={TODAY}
              onDayPress={(day: any) => setSelectedDate(day.dateString)}
              markedDates={markedDates}
              theme={{
                todayTextColor: PRIMARY,
                arrowColor: PRIMARY,
                selectedDayBackgroundColor: PRIMARY,
                selectedDayTextColor: '#ffffff',
                dotColor: PRIMARY,
                monthTextColor: '#334155',
                textDayFontWeight: '500',
                textMonthFontWeight: '700',
                textDayHeaderFontWeight: '600',
              }}
            />
          </View>

          {/* ── Upcoming strip ── */}
          {upcomingEvents.length > 0 && (
            <View style={styles.upcomingSection}>
              <Text style={styles.upcomingSectionLabel}>UPCOMING</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.upcomingScroll}
              >
                {upcomingEvents.map(({ date, event }) => {
                  const groupName = event.groupId
                    ? groups.find(g => String(g.id) === String(event.groupId))?.name
                    : null;
                  const isToday = date === TODAY;
                  return (
                    <TouchableOpacity
                      key={`${date}-${event.id}`}
                      style={[styles.upcomingCard, selectedDate === date && styles.upcomingCardSelected]}
                      onPress={() => setSelectedDate(date)}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.upcomingDateBadge, isToday && styles.upcomingDateBadgeToday]}>
                        <Text style={[styles.upcomingDateBadgeText, isToday && styles.upcomingDateBadgeTextToday]}>
                          {formatUpcomingDate(date)}
                        </Text>
                      </View>
                      <Text style={styles.upcomingCardTime}>{event.time}</Text>
                      <Text style={styles.upcomingCardTitle} numberOfLines={2}>{event.title}</Text>
                      {event.location ? (
                        <Text style={styles.upcomingCardLocation} numberOfLines={1}>{event.location}</Text>
                      ) : null}
                      {groupName ? (
                        <View style={styles.upcomingCardGroupBadge}>
                          <MaterialIcons name="groups" size={10} color={PRIMARY} style={{ marginRight: 3 }} />
                          <Text style={styles.upcomingCardGroupText}>{groupName}</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* ── Events list ── */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Events</Text>
            {sortedEvents.length > 0 && (
              <View style={styles.countPill}>
                <Text style={styles.countPillText}>{sortedEvents.length}</Text>
              </View>
            )}
          </View>
          <Text style={styles.dateSubline}>{formatSelectedDate(selectedDate)}</Text>

          {sortedEvents.length === 0 ? (
            <View style={styles.emptyCard}>
              <View style={styles.emptyIconCircle}>
                <MaterialIcons name="event-available" size={30} color="#cbd5e1" />
              </View>
              <Text style={styles.emptyTitle}>No events</Text>
              <Text style={styles.emptySubtitle}>
                {selectedGroupFilterId
                  ? 'No events for this group on this day. Tap + to add one.'
                  : 'Nothing scheduled for this day. Tap + to add an event.'}
              </Text>
            </View>
          ) : (
            sortedEvents.map(item => renderEventCard(item))
          )}

        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0B617E',
  },
  banner: {
    backgroundColor: '#0B617E',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    shadowColor: '#04303f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 1,
  },
  contentContainer: {
    flex: 1,
    backgroundColor: '#f5f7f9',
  },
  scrollPage: {
    flex: 1,
  },
  scrollPageContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 48,
  },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: {
    fontSize: 40,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -1,
  },
  headerAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },

  // ── Group filter chip bar ──
  filterChipBar: {
    marginBottom: 16,
  },
  filterChipScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#fff',
    borderRadius: 20,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  filterChipSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  filterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  filterChipTextSelected: {
    color: '#fff',
  },

  // ── Calendar ──
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8eef2',
    paddingBottom: 8,
    marginBottom: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    overflow: 'hidden',
  },

  // ── Events section ──
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  countPill: {
    marginLeft: 8,
    backgroundColor: 'rgba(11, 97, 126, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: PRIMARY,
  },
  dateSubline: {
    fontSize: 14,
    color: '#94a3b8',
    marginBottom: 12,
    fontWeight: '500',
  },

  // ── Event card ──
  eventCardWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  eventCardTouchable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  eventTimeCol: {
    minWidth: 64,
    marginRight: 12,
  },
  eventTime: {
    fontWeight: '700',
    fontSize: 13,
    color: PRIMARY,
  },
  eventTextCol: {
    flex: 1,
    minWidth: 0,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 2,
  },
  eventSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
  },
  eventGroupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  eventGroupBadgeText: {
    fontSize: 11,
    color: PRIMARY,
    fontWeight: '600',
  },
  eventEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexShrink: 0,
  },
  eventEditBtnText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '600',
  },

  // ── Empty state ──
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8eef2',
    borderStyle: 'dashed',
    paddingVertical: 32,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 4,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },

  // ── Modal ──
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
  },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d4d8de',
    marginTop: 12,
    marginBottom: 4,
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8eef2',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 2,
  },
  modalDate: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  formContainer: {
    paddingHorizontal: 20,
    paddingTop: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 8,
    marginTop: 16,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  input: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: '#f8fafc',
    color: '#0f172a',
  },
  searchingHint: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 4,
  },
  errorHint: {
    color: '#dc2626',
    fontSize: 12,
    marginTop: 4,
  },
  timeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#f8fafc',
  },
  timeSelectorText: {
    fontSize: 16,
    color: '#0f172a',
  },
  iosPickerContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    marginTop: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  iosPickerDoneButton: {
    backgroundColor: '#e2e8f0',
    padding: 12,
    alignItems: 'center',
  },
  iosPickerDoneText: {
    fontSize: 16,
    fontWeight: '600',
    color: PRIMARY,
  },
  chipRow: {
    marginTop: 4,
    marginBottom: 4,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipSelected: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  chipTextSelected: {
    color: '#fff',
  },
  suggestionsContainer: {
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  suggestionName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  suggestionAddress: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 1,
  },
  deleteFormButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff1f2',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  deleteFormText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#dc2626',
  },
  modalButtons: {
    flexDirection: 'row',
    padding: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    marginRight: 8,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
  },
  saveButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    marginLeft: 8,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },

  // ── Upcoming strip ──
  upcomingSection: {
    marginBottom: 20,
  },
  upcomingSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  upcomingScroll: {
    flexDirection: 'row',
    gap: 10,
    paddingRight: 4,
  },
  upcomingCard: {
    width: 150,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    padding: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  upcomingCardSelected: {
    borderColor: PRIMARY,
    borderWidth: 1.5,
  },
  upcomingDateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 8,
  },
  upcomingDateBadgeToday: {
    backgroundColor: 'rgba(11, 97, 126, 0.12)',
  },
  upcomingDateBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  upcomingDateBadgeTextToday: {
    color: PRIMARY,
  },
  upcomingCardTime: {
    fontSize: 12,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 3,
  },
  upcomingCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 19,
  },
  upcomingCardLocation: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 3,
  },
  upcomingCardGroupBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    backgroundColor: 'rgba(11, 97, 126, 0.08)',
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  upcomingCardGroupText: {
    fontSize: 10,
    color: PRIMARY,
    fontWeight: '600',
  },
});
