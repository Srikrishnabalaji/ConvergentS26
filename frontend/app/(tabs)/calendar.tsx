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
  Switch,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications'; 
import { supabase } from '../../lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { geocodeSearch, type SearchItem, GeocodingNetworkError } from '@/lib/services/geocoding';
import { DEFAULT_USER_LOCATION } from '@/constants/map';
import { searchRooms } from '@/lib/services/indoor-navigation';
import gdcGraphData from '@/assets/gdc_graph.json';
import type { BuildingGraph, GraphNode } from '@/lib/services/indoor-navigation';

const getTodayString = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseTimeString = (timeStr: string) => {
  if (!timeStr || timeStr.toLowerCase() === 'now') return new Date();
  
  try {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
    
    if (!match) 
      return new Date();
    
    let [, hoursStr, minutesStr, period] = match;
    let hours = parseInt(hoursStr, 10);
    let minutes = parseInt(minutesStr, 10);
    
    if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
    if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
    
    const d = new Date();
    d.setHours(hours, minutes, 0, 0);
    return d;

  } catch (e) {
    return new Date(); 
  }
};

const extractBuilding = (location: string): string => {
  return location
    .replace(/[-–]\s*(room|rm|suite|ste|floor|fl|#)\s*[\w.]+/gi, '')
    .replace(/\s+(room|rm|suite|ste|floor|fl|#)\s*[\w.]+/gi, '')
    .trim();
};

const validateBuilding = async (location: string): Promise<boolean> => {
  if (!location.trim()) return true; // location is optional, blank is fine
  const building = extractBuilding(location);
  if (!building) return true;
  try {
    const results = await geocodeSearch(building, DEFAULT_USER_LOCATION);
    return results.length > 0;
  } catch (e) {
    if (e instanceof GeocodingNetworkError) return true; // don't block save if offline
    return false;
  }
};

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

//dummy data 
const DUMMY_EVENTS: Record<string, any[]> = {
  [TODAY]: [
    { id: '2', title: 'CS313E Class', location: 'ECJ - Room 0132', time: '1:00 PM', notify: false },
    { id: '1', title: 'test', location: 'gdc', time: '8:00 AM', notify: true },
  ],
  '2026-03-26': [
    { id: '3', title: 'Study Group', location: 'PCL Library', time: '3:00 PM', notify: true }
  ]
};

export default function CalendarScreen() {
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [events, setEvents] = useState<Record<string, any[]>>({});
  const [groups, setGroups] = useState<{id: any, name: string}[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timeValue, setTimeValue] = useState(new Date());

  const [locationSuggestions, setLocationSuggestions] = useState<SearchItem[]>([]);
  const [locationSearching, setLocationSearching] = useState(false);
  const locationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const roomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [roomValidating, setRoomValidating] = useState(false);
  const [roomError, setRoomError] = useState<string | null>(null);

  const [roomSuggestions, setRoomSuggestions] = useState<GraphNode[]>([]);
  const [roomSearching, setRoomSearching] = useState(false);

  const [newEvent, setNewEvent] = useState<{
    title: string;
    building: string;
    room: string;
    time: string;
    notify: boolean;
    notifyInAdvance: number | null;
    groupId: any | null;
  }>({
    title: '',
    building: '',
    room: '',
    time: '',
    notify: false,
    notifyInAdvance: null,
    groupId: null,
  });
  const router = useRouter();
  const { groupId: paramGroupId, groupName } = useLocalSearchParams<{
    groupId?: string;
    groupName?: string;
  }>();
  const groupNameDisplay = Array.isArray(groupName) ? groupName[0] : groupName;
  const paramGroupIdSingle = Array.isArray(paramGroupId) ? paramGroupId[0] : paramGroupId;

  const [groupEventsOnly, setGroupEventsOnly] = useState(false);
  const [selectedGroupFilterId, setSelectedGroupFilterId] = useState<string | null>(null);

  const fetchEvents = async () => {
    //groups
    const { data: groupData } = await supabase.from('groups').select('id, name');
    if (groupData) setGroups(groupData);

    //events
    const { data: eventData, error } = await supabase.from('events').select('*');
    if (error) {
      console.error('Error fetching events:', error);
      return;
    }

    if (eventData) {
      const formattedEvents: Record<string, any[]> = {};
      eventData.forEach((event:any) => {
        if (!formattedEvents[event.event_date]) {
          formattedEvents[event.event_date] = [];
        }
        formattedEvents[event.event_date].push({
          id: event.id,
          title: event.title,
          location: event.location,
          time: event.time,
          notify: event.notify,
          notifyInAdvance: event.notify_in_advance,
          groupId: event.group_id
        });
      });
      setEvents(formattedEvents);
    }
  };


  useEffect(() => {
    fetchEvents();
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') console.log('Notification permissions not granted!');
    })();
  }, []);

  useEffect(() => {
    if (paramGroupIdSingle) {
      setGroupEventsOnly(true);
      setSelectedGroupFilterId(paramGroupIdSingle);
    }
  }, [paramGroupIdSingle]);


  function eventGroupId(e: { groupId?: unknown; group_id?: unknown }): string | null {
    const g = e.groupId ?? e.group_id;
    if (g == null || g === '') return null;
    return String(g);
  }

  const eventsVisibleByFilter = useMemo(() => {
    if (!groupEventsOnly) {
      return events;
    }
    if (!selectedGroupFilterId) {
      return {};
    }
    const out: Record<string, any[]> = {};
    Object.keys(events).forEach((date) => {
      const list = events[date] ?? [];
      const filtered = list.filter(
        (e) => eventGroupId(e) === selectedGroupFilterId
      );
      if (filtered.length) out[date] = filtered;
    });
    return out;
  }, [events, groupEventsOnly, selectedGroupFilterId]);

  const markedDates = useMemo(() => {
    const marked: Record<string, any> = {};
    Object.keys(eventsVisibleByFilter).forEach((date) => {
      if(events[date] && events[date].length > 0) {
        marked[date] = { marked: true, dotColor: PRIMARY };
      }
    });

    marked[selectedDate] = {
      ...(marked[selectedDate] || {}),
      selected: true,
      selectedColor: PRIMARY,
    };
    return marked;
  }, [selectedDate, eventsVisibleByFilter]);

  const handleEventPress = (location: string) => {
    const dashIdx = location.indexOf(' - ');
    const building = dashIdx !== -1 ? location.slice(0, dashIdx) : location;
    const room = dashIdx !== -1 ? location.slice(dashIdx + 3) : '';
    router.push({
      pathname: '/(tabs)/map',
      params: {
        searchQuery: building,
        ...(room ? { roomQuery: room } : {}),
      },
    });
  };

  const onTimeChange = (event: any, selectedTime?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }
    
    if (selectedTime) {
      setTimeValue(selectedTime);
      const formattedTime = selectedTime.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      setNewEvent(prev => ({ ...prev, time: formattedTime }));
    }
  };

  const handleOpenAddModal = () => {
    setEditingEventId(null);
    setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null});
    setTimeValue(new Date());
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomSuggestions([]);
    setRoomSearching(false);
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
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomError(null);
    setRoomSuggestions([]);
    setRoomSearching(false);
  };


  const handleBuildingChange = (text: string) => {
    setNewEvent(prev => ({ ...prev, building: text, room: '' }));
    setLocationSuggestions([]);
    setRoomError(null);

    if (locationDebounceRef.current) clearTimeout(locationDebounceRef.current);
    if (!text.trim()) { setLocationSearching(false); return; }

    setLocationSearching(true);
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

  const handleSaveEvent = async () => { 
    if (!newEvent.title.trim()) {
      Alert.alert('Error', 'Please enter an event title');
      return;
    }
    if (!newEvent.time) {
      Alert.alert('Error', 'Please select a time');
      return;
    }

    if (newEvent.building.trim()) {
      const isValid = await validateBuilding(newEvent.building);
      if (!isValid) {
        Alert.alert(
          'Unknown Building',
          `"${newEvent.building}" wasn't found on campus. Please check the building name.`,
          [{ text: 'OK' }]
        );
        return;
      }
    }

    if (newEvent.room.trim()) {
      const roomResults = searchRooms(gdcGraphData as BuildingGraph, newEvent.room);
      const exactMatch = roomResults.some(
        (n) => n.label.toLowerCase() === newEvent.room.trim().toLowerCase()
      );
      if (!exactMatch) {
        Alert.alert(
          'Unknown Room',
          `"${newEvent.room}" wasn't found in this building. Please select a room from the suggestions.`,
          [{ text: 'OK' }]
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
        parseInt(year),
        parseInt(month) - 1, 
        parseInt(day),
        timeValue.getHours(),
        timeValue.getMinutes()
      );

      const triggerDate = new Date(eventTime.getTime() - newEvent.notifyInAdvance * 60000);

      if (triggerDate > new Date()) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `${newEvent.title}`,
            body: combinedLocation ? `Head to ${combinedLocation}` : 'Your event is starting now!',
            sound: true,
          },
          trigger: { type: 'date', date: triggerDate } as Notifications.DateTriggerInput,
        });
      } else {
        Alert.alert("Note", "The time you selected is in the past, so you will not be notified");
      }
    }

    const eventId = editingEventId ? editingEventId : Date.now().toString();
    const dbEventData = {
      id: eventId,
      event_date: selectedDate,
      title: newEvent.title,
      location: combinedLocation,
      time: newEvent.time,
      notify: newEvent.notify,
      notify_in_advance: newEvent.notifyInAdvance,
      group_id: newEvent.groupId
    };

    const { error } = await supabase.from('events').upsert(dbEventData);

    if (error) {
      Alert.alert('Database Error', 'Could not save event.');
      console.error('Supabase error:', error);
      return;
    }

    const localEventData = {
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
      const currentDayEvents = prev[selectedDate] || [];
      if (editingEventId) {
        return {
          ...prev,
          [selectedDate]: currentDayEvents.map(e => e.id === editingEventId ? localEventData : e)
        };
      } else {
        return {
          ...prev,
          [selectedDate]: [...currentDayEvents, localEventData]
        };
      }
    });

    setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null});
    setTimeValue(new Date());
    setEditingEventId(null);
    setShowTimePicker(false);
    setShowAddModal(false);
  };


  const handleDeleteEvent = () => {
    if (!editingEventId) return;

    Alert.alert('Delete Event', 'Are you sure you want to delete this event?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
        
          const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', editingEventId);

          if (error) {
            Alert.alert('Error', 'Could not delete event from database');
            console.error('Supabase delete error:', error);
            return;
          }

          setEvents(prev => ({
            ...prev,
            [selectedDate]: prev[selectedDate].filter(e => e.id !== editingEventId)
          }));
          setShowAddModal(false);
          setEditingEventId(null);
        }
      }
    ]);
  };


  const renderEventCard = ({ item }: { item: any }) => (
    <View style={styles.eventCardWrap}>
      <TouchableOpacity
        style={styles.eventCardTouchable}
        onPress={() => handleEventPress(item.location)}
        activeOpacity={0.72}
      >
        <View style={styles.eventTimeCol}>
          <Text style={styles.eventTime}>{item.time}</Text>
        </View>
        <View style={styles.eventTextCol}>
          <Text style={styles.eventTitle} numberOfLines={2}>
            {item.title}
          </Text>
          {item.location ? (
            <Text style={styles.eventSubtitle} numberOfLines={1}>
              {item.location}
            </Text>
          ) : null}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.eventEditBtn}
        onPress={() => handleOpenEditModal(item)}
        accessibilityRole="button"
        accessibilityLabel="Edit event"
      >
        <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
        <Text style={styles.eventEditBtnText}>Edit</Text>
      </TouchableOpacity>
    </View>
  );

  const sortedEvents = useMemo(() => {
    const dayEvents = events[selectedDate] || [];
    let list = dayEvents;
    if (groupEventsOnly && selectedGroupFilterId) {
      list = dayEvents.filter((e) => eventGroupId(e) === selectedGroupFilterId);
    } else if (groupEventsOnly && !selectedGroupFilterId) {
      list = [];
    }
    return [...list].sort((a, b) => {
      const timeA = parseTimeString(a.time).getTime();
      const timeB = parseTimeString(b.time).getTime();
      return timeA - timeB;
    });
  }, [events, selectedDate, groupEventsOnly, selectedGroupFilterId]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <Pressable style={styles.modalOverlay} onPress={() => setShowAddModal(false)}>
            <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
              
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingEventId ? 'Edit Event' : 'Add Event'}</Text>
                <Text style={styles.modalDate}>{selectedDate}</Text>
              </View>

              <ScrollView style={styles.formContainer} showsVerticalScrollIndicator={false}>
                <Text style={styles.label}>Event Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., CS313E Class"
                  value={newEvent.title}
                  onChangeText={(text) => setNewEvent(prev => ({...prev, title: text }))}
                  placeholderTextColor="#999"
                />

                {/* <Text style={styles.label}>Building</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., GDC, ECJ, PCL..."
                  value={newEvent.building}
                  onChangeText={handleBuildingChange}
                  placeholderTextColor="#999"
                />
                {locationSearching && (
                  <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Searching...</Text>
                )}
                {locationSuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {locationSuggestions.map((item) => (
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

                <Text style={styles.label}>Room <Text style={{ color: '#94a3b8', fontWeight: '400' }}>(optional)</Text></Text>
                <TextInput
                  style={[styles.input, !newEvent.building.trim() && { opacity: 0.5 }]}
                  placeholder="e.g., 2.216, 0132..."
                  value={newEvent.room}
                  onChangeText={handleRoomChange}
                  placeholderTextColor="#999"
                  editable={!!newEvent.building.trim()}
                />
                {roomSearching && (
                  <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Searching rooms...</Text>
                )}
                {roomSuggestions.length > 0 && (
                  <View style={styles.suggestionsContainer}>
                    {roomSuggestions.map((node) => (
                      <TouchableOpacity
                        key={node.id}
                        style={styles.suggestionRow}
                        onPress={() => handleSelectRoomSuggestion(node)}
                      >
                        <MaterialIcons name="meeting-room" size={16} color={PRIMARY} style={{ marginRight: 8 }} />
                        <Text style={styles.suggestionName}>{node.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
                {roomError ? (
                  <Text style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{roomError}</Text>
                ) : null} */}

                <Text style={styles.label}>Location</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <TextInput
                      style={styles.input}
                      placeholder="Building (GDC, PCL...)"
                      value={newEvent.building}
                      onChangeText={handleBuildingChange}
                      placeholderTextColor="#999"
                    />
                    {locationSearching && (
                      <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Searching...</Text>
                    )}
                    {locationSuggestions.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        {locationSuggestions.map((item) => (
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
                      style={[styles.input, !newEvent.building.trim() && { opacity: 1 }]}
                      placeholder="Room"
                      value={newEvent.room}
                      onChangeText={handleRoomChange}
                      placeholderTextColor="#999"
                      editable={!!newEvent.building.trim()}
                    />
                    {roomSearching && (
                      <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>...</Text>
                    )}
                    {roomSuggestions.length > 0 && (
                      <View style={styles.suggestionsContainer}>
                        {roomSuggestions.map((node) => (
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
                    {roomError ? (
                      <Text style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{roomError}</Text>
                    ) : null}
                  </View>
                </View>

                <Text style={styles.label}>Time *</Text>
                <TouchableOpacity 
                  style={styles.timeSelector}
                  onPress={() => setShowTimePicker(true)}
                >
                  <MaterialIcons name="access-time" size={20} color={PRIMARY} style={{ marginRight: 8 }} />
                  <Text style={[styles.timeSelectorText, !newEvent.time && { color: '#999' }]}>
                    {newEvent.time || 'Tap to select time'}
                  </Text>
                </TouchableOpacity>

                {showTimePicker && (
                  <View style={Platform.OS === 'ios' ? styles.iosPickerContainer : null}>
                    <DateTimePicker
                      value={timeValue}
                      mode="time"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={onTimeChange}
                      textColor="#000000"
                      themeVariant="light"
                    />
                    {Platform.OS === 'ios' && (
                      <TouchableOpacity 
                        style={styles.iosPickerDoneButton}
                        onPress={() => setShowTimePicker(false)}
                      >
                        <Text style={styles.iosPickerDoneText}>Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <Text style={styles.label}>Alert</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                  {[
                    { label: 'None', value: null },
                    { label: 'At start', value: 0 },
                    { label: '10 min before', value: 10 },
                    { label: '1 hour before', value: 60 }
                  ].map((option) => {
                    const isSelected = newEvent.notifyInAdvance === option.value;
                    return (
                      <TouchableOpacity
                        key={option.label}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => setNewEvent(prev => ({ 
                          ...prev, 
                          notifyInAdvance: option.value, 
                          notify: option.value !== null 
                        }))}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                          {option.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
                <Text style={styles.label}>Group</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
                  <TouchableOpacity
                    style={[styles.chip, !newEvent.groupId && styles.chipSelected]}
                    onPress={() => setNewEvent(prev => ({ ...prev, groupId: null }))}
                  >
                    <Text style={[styles.chipText, !newEvent.groupId && styles.chipTextSelected]}>
                      None
                    </Text>
                  </TouchableOpacity>
                
                  {groups.map((group) => {
                    const isSelected = newEvent.groupId === group.id;
                    return (
                      <TouchableOpacity
                        key={group.id}
                        style={[styles.chip, isSelected && styles.chipSelected]}
                        onPress={() => setNewEvent(prev => ({ ...prev, groupId: group.id }))}
                      >
                        <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
                          {group.name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {editingEventId && (
                  <TouchableOpacity style={styles.deleteFormButton} onPress={handleDeleteEvent}>
                    <Text style={styles.deleteFormText}>Delete Event</Text>
                  </TouchableOpacity>
                )}
                
              </ScrollView>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelButton} onPress={() => setShowAddModal(false)}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.addButton} onPress={handleSaveEvent}>
                  <Text style={styles.addButtonText}>{editingEventId ? 'Update Event' : 'Save Event'}</Text>
                </TouchableOpacity>
              </View>

            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <ScrollView
        style={styles.scrollPage}
        contentContainerStyle={styles.scrollPageContent}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        <View style={styles.headerBlock}>
          <View>
            <Text style={styles.pageTitle}>Calendar</Text>
            <Text style={styles.pageSubtitle}>Plan your week and group meetups</Text>
          </View>
          <TouchableOpacity
            style={styles.headerIconBtnPrimary}
            onPress={handleOpenAddModal}
            accessibilityRole="button"
            accessibilityLabel="Add event"
          >
            <MaterialIcons name="add" size={26} color="#fff" />
          </TouchableOpacity>
        </View>

        {groupNameDisplay ? (
          <View style={styles.groupContextRow}>
            <MaterialIcons name="groups" size={20} color={PRIMARY} style={{ marginRight: 8 }} />
            <View style={{ flex: 1 }}>
              <Text style={styles.groupContextLabel}>Opened from group</Text>
              <Text style={styles.groupContextName} numberOfLines={2}>
                {groupNameDisplay}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.filterCard}>
          <View style={styles.filterRow}>
            <View style={styles.filterLabelCol}>
              <Text style={styles.filterTitle}>Group events only</Text>
              <Text style={styles.filterHint}>
                Show calendar and list for one group
              </Text>
            </View>
            <View style={styles.switchSlot}>
              <Switch
                value={groupEventsOnly}
                onValueChange={(on) => {
                  setGroupEventsOnly(on);
                  if (!on) setSelectedGroupFilterId(null);
                  else if (groups.length === 1) setSelectedGroupFilterId(String(groups[0].id));
                }}
                trackColor={switchTrackColors}
                thumbColor={switchThumbColor(groupEventsOnly, PRIMARY)}
                ios_backgroundColor={switchTrackColors.false}
              />
            </View>
          </View>
          {groupEventsOnly ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.groupChipScroll}
            >
              {groups.length === 0 ? (
                <Text style={styles.filterNoGroups}>No groups available</Text>
              ) : (
                groups.map((g) => {
                  const id = String(g.id);
                  const selected = selectedGroupFilterId === id;
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.filterChip, selected && styles.filterChipSelected]}
                      onPress={() => setSelectedGroupFilterId(id)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          ) : null}
        </View>

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

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Events</Text>
          {sortedEvents.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{sortedEvents.length}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.dateSubline}>{selectedDate}</Text>

        {groupEventsOnly && !selectedGroupFilterId ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="groups" size={30} color="#cbd5e1" />
            </View>
            <Text style={styles.emptyTitle}>Select a group</Text>
            <Text style={styles.emptySubtitle}>
              Choose which group&apos;s events to show using the chips above.
            </Text>
          </View>
        ) : sortedEvents.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="event-available" size={30} color="#cbd5e1" />
            </View>
            <Text style={styles.emptyTitle}>No events this day</Text>
            <Text style={styles.emptySubtitle}>
              Tap + to add one, or choose another date on the calendar.
            </Text>
          </View>
        ) : (
          sortedEvents.map((item) => (
            <View key={String(item.id)}>{renderEventCard({ item })}</View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scrollPage: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scrollPageContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  filterCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    padding: 14,
    marginBottom: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  filterLabelCol: {
    flex: 1,
    marginRight: 12,
  },
  switchSlot: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
  filterHint: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  groupChipScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 2,
  },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
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
  filterNoGroups: {
    fontSize: 13,
    color: '#94a3b8',
    paddingVertical: 8,
  },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: PRIMARY,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#64748b',
    maxWidth: 240,
  },
  headerIconBtnPrimary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  groupContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#f0f7f9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cfe4ea',
  },
  groupContextLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: PRIMARY,
    marginBottom: 2,
  },
  groupContextName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  calendarCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
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
    fontSize: 16,
    fontWeight: '600',
    color: PRIMARY,
    marginBottom: 2,
  },
  eventSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
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
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8eef2',
    borderStyle: 'dashed',
    paddingVertical: 28,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 12,
    maxHeight: '88%',
    borderWidth: 1,
    borderColor: '#e8eef2',
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8eef2',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 4,
  },
  modalDate: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: '500',
  },
  formContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    marginBottom: 8,
    marginTop: 14,
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
  deleteFormButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff1f2',
    paddingVertical: 14,
    borderRadius: 12,
    marginBottom: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#fecdd3',
  },
  deleteFormText: {
    fontSize: 16,
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
  addButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    marginLeft: 8,
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: 8,
    marginBottom: 16,
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
});