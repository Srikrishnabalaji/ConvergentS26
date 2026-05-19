import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import type { CalendarProps, DateData } from 'react-native-calendars';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
// expo-notifications removed (requires paid Apple Developer account)
// import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { geocodeSearch, type SearchItem, GeocodingNetworkError } from '@/lib/services/geocoding';
import { DEFAULT_USER_LOCATION } from '@/constants/map';
import gdcGraphData from '@/assets/gdc_graph.json';
import {
  searchRooms,
  type BuildingGraph,
  type GraphNode,
} from '@/lib/services/indoor-navigation';
import { parseLocationString, UT_BUILDINGS } from '@/lib/data/utBuildings';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PageShell } from '@/components/ui';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';
import { log } from '@/lib/logger';
import { accentForId } from '@/lib/utils';

const PRIMARY = '#0B617E';
const SECONDARY = '#C08A5E';
const SECONDARY_DEEP = '#9F6E45';


type MarkedDatesMap = NonNullable<CalendarProps['markedDates']>;

type GroupRow = { id: string; name: string };

function unwrapGroup(g: unknown): GroupRow | null {
  if (g == null) return null;
  const row = Array.isArray(g) ? g[0] : g;
  if (row && typeof row === 'object' && 'id' in row && 'name' in row) {
    const o = row as { id: unknown; name: unknown };
    return { id: String(o.id), name: String(o.name) };
  }
  return null;
}

type RecurrenceType = 'daily' | 'weekly' | 'monthly';

type EventRow = {
  id: string;
  user_id: string;
  title: string;
  location: string | null;
  time: string;
  notify: boolean;
  notify_in_advance: number | null;
  event_date: string;
  group_id: string | null;
  recurrence: RecurrenceType | null;
  recurrence_interval: number;
  recur_end_date: string | null;
};

type CalendarEventItem = {
  id: string;
  userId: string;
  title: string;
  location: string;
  time: string;
  notify: boolean;
  notifyInAdvance: number | null;
  groupId: string | null;
  recurrence: RecurrenceType | null;
  recurrenceInterval: number;
  recurEndDate: string | null;
  startDate: string;
};

type NewEventForm = {
  title: string;
  building: string;
  room: string;
  time: string;
  notify: boolean;
  notifyInAdvance: number | null;
  groupId: string | null;
  recurrence: RecurrenceType | null;
  recurrenceInterval: number;
  recurEndDate: string;
  startDate: string | null;
};

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
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match || match.length < 4) return new Date();
  const hoursStr = match[1];
  const minutesStr = match[2];
  const period = match[3];
  if (!hoursStr || !minutesStr || !period) return new Date();
  let hours = parseInt(hoursStr, 10);
  const minutes = parseInt(minutesStr, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return new Date();
  if (period.toUpperCase() === 'PM' && hours < 12) hours += 12;
  if (period.toUpperCase() === 'AM' && hours === 12) hours = 0;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
};

/** Parse "YYYY-MM-DD" → Date. Returns today on malformed input. */
const parseISODate = (dateStr: string): Date => {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return new Date();
  const [year, month, day] = parts as [number, number, number];
  return new Date(year, month - 1, day);
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
    if (e instanceof GeocodingNetworkError) return false;
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
  return parseISODate(dateStr).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function formatSelectedDate(dateStr: string): string {
  return parseISODate(dateStr).toLocaleDateString('en-US', {
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

const RECURRENCE_UNIT: Record<RecurrenceType, string> = {
  daily:   'day',
  weekly:  'week',
  monthly: 'month',
};

function getRecurrenceLabel(type: RecurrenceType | null, interval: number): string {
  if (!type) return 'Does not repeat';
  const unit = RECURRENCE_UNIT[type];
  if (interval === 1) return `Every ${unit}`;
  return `Every ${interval} ${unit}s`;
}

type RecurrencePreset = { label: string; value: RecurrenceType | null; interval: number; custom?: boolean };

const RECURRENCE_PRESETS: RecurrencePreset[] = [
  { label: 'Does not repeat', value: null,     interval: 1 },
  { label: 'Every day',       value: 'daily',  interval: 1 },
  { label: 'Every week',      value: 'weekly', interval: 1 },
  { label: 'Every 2 weeks',   value: 'weekly', interval: 2 },
  { label: 'Every month',     value: 'monthly',interval: 1 },
  { label: 'Custom…',         value: null,     interval: 1, custom: true },
];

function toISODateString(d: Date): string {
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function dayBefore(dateStr: string): string {
  const d = parseISODate(dateStr);
  d.setDate(d.getDate() - 1);
  return toISODateString(d);
}

function nextOccurrenceAfter(dateStr: string, recurrence: RecurrenceType, interval: number): string {
  const d = parseISODate(dateStr);
  switch (recurrence) {
    case 'daily':   d.setDate(d.getDate() + interval); break;
    case 'weekly':  d.setDate(d.getDate() + 7 * interval); break;
    case 'monthly': d.setMonth(d.getMonth() + interval); break;
  }
  return toISODateString(d);
}

function expandEvent(row: EventRow): { date: string; item: CalendarEventItem }[] {
  const interval = row.recurrence_interval ?? 1;
  const base: CalendarEventItem = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    location: row.location ?? '',
    time: row.time,
    notify: row.notify,
    notifyInAdvance: row.notify_in_advance,
    groupId: row.group_id,
    recurrence: row.recurrence,
    recurrenceInterval: interval,
    recurEndDate: row.recur_end_date,
    startDate: row.event_date,
  };
  if (!row.recurrence || !row.recur_end_date) {
    return [{ date: row.event_date, item: base }];
  }
  const results: { date: string; item: CalendarEventItem }[] = [];
  const end = parseISODate(row.recur_end_date);
  const current = parseISODate(row.event_date);
  while (current <= end) {
    results.push({ date: toISODateString(current), item: { ...base } });
    switch (row.recurrence) {
      case 'daily':   current.setDate(current.getDate() + interval);          break;
      case 'weekly':  current.setDate(current.getDate() + 7 * interval);      break;
      case 'monthly': current.setMonth(current.getMonth() + interval);        break;
    }
  }
  return results;
}

const TODAY = getTodayString();

// Notifications disabled (requires paid Apple Developer account)

export default function CalendarScreen() {
  const router = useRouter();
  const { groupId: paramGroupId } = useLocalSearchParams<{ groupId?: string }>();
  const paramGroupIdSingle = Array.isArray(paramGroupId) ? paramGroupId[0] : paramGroupId;

  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [events, setEvents] = useState<Record<string, CalendarEventItem[]>>({});
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());
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

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [endDateValue, setEndDateValue] = useState(new Date());
  const [editingOccurrenceDate, setEditingOccurrenceDate] = useState<string | null>(null);
  const [editingOriginalEvent, setEditingOriginalEvent] = useState<CalendarEventItem | null>(null);

  const defaultEndDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 90);
    return d;
  };

  const [newEvent, setNewEvent] = useState<NewEventForm>({
    title: '',
    building: '',
    room: '',
    time: '',
    notify: false,
    notifyInAdvance: null,
    groupId: null,
    recurrence: null,
    recurrenceInterval: 1,
    recurEndDate: toISODateString(defaultEndDate()),
    startDate: null,
  });

  const fetchEvents = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: memberData } = await supabase
      .from('group_members')
      .select('groups(id, name), role')
      .eq('user_id', user.id);

    if (memberData) {
      const userGroups = memberData
        .map((r) => unwrapGroup(r.groups))
        .filter((g): g is GroupRow => g != null)
        .sort((a, b) => a.name.localeCompare(b.name));
      setGroups(userGroups);

      // Track which groups the user is an admin of
      const adminIds = new Set<string>();
      memberData.forEach((r) => {
        if (r.role === 'admin') {
          const group = unwrapGroup(r.groups);
          if (group) {
            adminIds.add(group.id);
          }
        }
      });
      setAdminGroupIds(adminIds);
    }

    setCurrentUserId(user.id);

    const { data: eventData, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      log.error('Calendar', 'Error fetching events:', error);
      return;
    }

    if (eventData) {
      const formattedEvents: Record<string, CalendarEventItem[]> = {};
      (eventData as EventRow[]).forEach((row) => {
        for (const { date, item } of expandEvent(row)) {
          if (!formattedEvents[date]) formattedEvents[date] = [];
          formattedEvents[date].push(item);
        }
      });
      setEvents(formattedEvents);
    }
  };

  useEffect(() => {
    fetchEvents();
    // Notification permissions disabled
  }, []);

  // Refresh events and handle group filter when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      // Refresh events when returning to calendar
      fetchEvents();

      // Set group filter if navigating from group detail
      if (paramGroupIdSingle) {
        const groupIdStr = String(paramGroupIdSingle);
        log.debug('Calendar', 'Received groupId param:', groupIdStr);
        setSelectedGroupFilterId(groupIdStr);
      }
    }, [paramGroupIdSingle])
  );

  const eventsVisibleByFilter = useMemo(() => {
    if (!selectedGroupFilterId) return events;
    const out: Record<string, CalendarEventItem[]> = {};
    Object.keys(events).forEach((date) => {
      const filtered = (events[date] ?? []).filter((e) => eventGroupId(e) === selectedGroupFilterId);
      if (filtered.length) out[date] = filtered;
    });
    return out;
  }, [events, selectedGroupFilterId]);

  const markedDates = useMemo(() => {
    const marked: MarkedDatesMap = {};
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
    const result: { date: string; event: CalendarEventItem }[] = [];
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

  const onEndDateChange = (_event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowEndDatePicker(false);
    if (selectedDate) {
      setEndDateValue(selectedDate);
      setNewEvent((prev) => ({ ...prev, recurEndDate: toISODateString(selectedDate) }));
    }
  };

  const onTimeChange = (_event: DateTimePickerEvent, selectedTime?: Date) => {
    if (Platform.OS === 'android') setShowTimePicker(false);
    if (selectedTime) {
      setTimeValue(selectedTime);
      setNewEvent((prev) => ({
        ...prev,
        time: selectedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
    }
  };

  const handleOpenAddModal = () => {
    setEditingEventId(null);
    const ed = defaultEndDate();
    setEndDateValue(ed);
    setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null, recurrence: null, recurrenceInterval: 1, recurEndDate: toISODateString(ed), startDate: null });
    setTimeValue(new Date());
    setShowTimePicker(false);
    setShowEndDatePicker(false);
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomSuggestions([]);
    setRoomSearching(false);
    setRoomError(null);
    setEditingOccurrenceDate(null);
    setEditingOriginalEvent(null);
  };

  const handleOpenEditModal = (event: CalendarEventItem) => {
    setEditingEventId(event.id);
    const stored: string = event.location ?? '';
    const dashIdx = stored.indexOf(' - ');
    const building = dashIdx !== -1 ? stored.slice(0, dashIdx) : stored;
    const room = dashIdx !== -1 ? stored.slice(dashIdx + 3) : '';
    const ed = event.recurEndDate ? parseISODate(event.recurEndDate) : defaultEndDate();
    setEndDateValue(ed);
    setNewEvent({
      title: event.title,
      building,
      room,
      time: event.time,
      notify: event.notify,
      notifyInAdvance: event.notifyInAdvance ?? null,
      groupId: event.groupId ?? null,
      recurrence: event.recurrence ?? null,
      recurrenceInterval: event.recurrenceInterval ?? 1,
      recurEndDate: event.recurEndDate ?? toISODateString(ed),
      startDate: event.startDate,
    });
    setTimeValue(parseTimeString(event.time));
    setShowTimePicker(false);
    setShowEndDatePicker(false);
    setShowAddModal(true);
    setLocationSuggestions([]);
    setLocationSearching(false);
    setRoomSuggestions([]);
    setRoomSearching(false);
    setRoomError(null);
    setEditingOccurrenceDate(selectedDate);
    setEditingOriginalEvent(event);
  };

  const handleBuildingChange = (text: string) => {
    setNewEvent((prev) => ({ ...prev, building: text, room: '' }));
    setRoomError(null);

    if (!text.trim()) {
      setLocationSuggestions([]);
      setLocationSearching(false);
      return;
    }

    const q = text.trim().toLowerCase();
    const utMatches = UT_BUILDINGS.filter(
      (b) =>
        b.code.toLowerCase().startsWith(q) ||
        b.displayName.toLowerCase().includes(q) ||
        b.fullName.toLowerCase().includes(q) ||
        (b.aliases ?? []).some((a) => a.startsWith(q))
    ).slice(0, 6);

    if (utMatches.length > 0) {
      setLocationSuggestions(
        utMatches.map((b) => ({ id: b.code, name: b.code, address: b.displayName, latitude: 0, longitude: 0 }))
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
    setNewEvent((prev) => ({ ...prev, building: item.name, room: '' }));
    setLocationSuggestions([]);
    setRoomError(null);
    Keyboard.dismiss();
  };

  const handleRoomChange = (text: string) => {
    setNewEvent((prev) => ({ ...prev, room: text }));
    setRoomError(null);
    setRoomSuggestions([]);
    if (!text.trim()) {
      setRoomSearching(false);
      return;
    }
    if (roomDebounceRef.current) clearTimeout(roomDebounceRef.current);
    setRoomSearching(true);
    roomDebounceRef.current = setTimeout(() => {
      const results = searchRooms(gdcGraphData as BuildingGraph, text);
      setRoomSuggestions(results.slice(0, 5));
      setRoomSearching(false);
    }, 200);
  };

  const handleSelectRoomSuggestion = (node: GraphNode) => {
    setNewEvent((prev) => ({ ...prev, room: node.label }));
    setRoomSuggestions([]);
    setRoomError(null);
    Keyboard.dismiss();
  };

  const handleSaveEvent = async () => {
    if (!newEvent.title.trim()) {
      Alert.alert('Missing title', 'Please enter an event title.');
      return;
    }
    if (!newEvent.time) {
      Alert.alert('Missing time', 'Please select a time for this event.');
      return;
    }

    // Check if user is admin of the selected group (if a group is selected)
    if (newEvent.groupId && !adminGroupIds.has(newEvent.groupId)) {
      const groupName = groups.find((g) => String(g.id) === String(newEvent.groupId))?.name || 'this group';
      Alert.alert(
        'Admin Only',
        `Only admins can create events for ${groupName}. You can create personal events by selecting "None" instead.`
      );
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
        (n) => n.label.toLowerCase() === newEvent.room.trim().toLowerCase()
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Error', 'You must be signed in to save events.');
      return;
    }
    if (newEvent.recurrence && !newEvent.recurEndDate) {
      Alert.alert('Missing end date', 'Please set an end date for the recurring event.');
      return;
    }
    if (newEvent.recurrence && newEvent.recurEndDate && newEvent.recurEndDate <= (newEvent.startDate ?? selectedDate)) {
      Alert.alert('Invalid end date', 'The end date must be after the event start date.');
      return;
    }

    const payload = {
      event_date: newEvent.startDate ?? selectedDate,
      title: newEvent.title,
      location: combinedLocation,
      time: newEvent.time,
      notify: newEvent.notify,
      notify_in_advance: newEvent.notifyInAdvance,
      group_id: newEvent.groupId,
      recurrence: newEvent.recurrence,
      recurrence_interval: newEvent.recurrence ? newEvent.recurrenceInterval : 1,
      recur_end_date: newEvent.recurrence ? newEvent.recurEndDate : null,
    };

    const resetForm = () => {
      const ed = defaultEndDate();
      setEndDateValue(ed);
      setNewEvent({ title: '', building: '', room: '', time: '', notify: false, notifyInAdvance: null, groupId: null, recurrence: null, recurrenceInterval: 1, recurEndDate: toISODateString(ed), startDate: null });
      setTimeValue(new Date());
      setEditingEventId(null);
      setEditingOccurrenceDate(null);
      setEditingOriginalEvent(null);
      setShowTimePicker(false);
      setShowEndDatePicker(false);
      setShowAddModal(false);
    };

    // Prompt scope when editing a recurring event
    if (editingEventId && editingOriginalEvent?.recurrence) {
      const occDate = editingOccurrenceDate ?? selectedDate;
      const orig = editingOriginalEvent;

      const doSave = async (scope: 'this' | 'following') => {
        const isFirst = occDate === orig.startDate;

        if (scope === 'following') {
          if (isFirst) {
            // Update the whole series with new settings
            const { error } = await supabase.from('events')
              .update(payload)
              .eq('id', editingEventId)
              .eq('user_id', user.id);
            if (error) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
          } else {
            // Truncate original series to before this occurrence
            const { error: e1 } = await supabase.from('events')
              .update({ recur_end_date: dayBefore(occDate) })
              .eq('id', editingEventId)
              .eq('user_id', user.id);
            if (e1) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
            // Create new series from this occurrence with new settings
            const { error: e2 } = await supabase.from('events').insert({
              ...payload, event_date: occDate, user_id: user.id,
            });
            if (e2) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
          }
        } else {
          // "Just this event"
          if (isFirst) {
            const nextDate = nextOccurrenceAfter(occDate, orig.recurrence!, orig.recurrenceInterval);
            const hasMore = !orig.recurEndDate || nextDate <= orig.recurEndDate;
            if (hasMore) {
              // Advance original series past this occurrence
              const { error: e1 } = await supabase.from('events')
                .update({ event_date: nextDate })
                .eq('id', editingEventId)
                .eq('user_id', user.id);
              if (e1) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
            } else {
              // No more occurrences remain; remove the now-empty series row
              const { error: e1 } = await supabase.from('events')
                .delete()
                .eq('id', editingEventId)
                .eq('user_id', user.id);
              if (e1) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
            }
          } else {
            // Truncate original series to before this occurrence
            const { error: e1 } = await supabase.from('events')
              .update({ recur_end_date: dayBefore(occDate) })
              .eq('id', editingEventId)
              .eq('user_id', user.id);
            if (e1) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
            // Re-create future series with original settings (if future occurrences exist)
            const nextDate = nextOccurrenceAfter(occDate, orig.recurrence!, orig.recurrenceInterval);
            const hasMore = !orig.recurEndDate || nextDate <= orig.recurEndDate;
            if (hasMore) {
              const { error: e2 } = await supabase.from('events').insert({
                user_id: user.id,
                title: orig.title,
                location: orig.location,
                time: orig.time,
                notify: orig.notify,
                notify_in_advance: orig.notifyInAdvance,
                group_id: orig.groupId,
                recurrence: orig.recurrence,
                recurrence_interval: orig.recurrenceInterval,
                recur_end_date: orig.recurEndDate,
                event_date: nextDate,
              });
              if (e2) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
            }
          }
          // One-time event for this specific occurrence with the new settings
          const { error: eNew } = await supabase.from('events').insert({
            ...payload,
            event_date: occDate,
            recurrence: null,
            recurrence_interval: 1,
            recur_end_date: null,
            user_id: user.id,
          });
          if (eNew) { Alert.alert('Error', 'Could not save event. Please try again.'); return; }
        }

        await fetchEvents();
        resetForm();
      };

      Alert.alert(
        'Edit recurring event',
        'How would you like to apply this change?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Just this event', onPress: () => { void doSave('this'); } },
          { text: 'This and following', onPress: () => { void doSave('following'); } },
        ]
      );
      return;
    }

    // Never let the client choose the row id. On insert the DB default
    // (gen_random_uuid::text) assigns it; on update we match by id + user_id
    // so the row's user_id can't be rewritten.
    let savedId: string;
    if (editingEventId) {
      const { error } = await supabase
        .from('events')
        .update(payload)
        .eq('id', editingEventId)
        .eq('user_id', user.id);
      if (error) {
        Alert.alert('Error', 'Could not save event. Please try again.');
        log.error('Calendar', 'Supabase error:', error);
        return;
      }
      savedId = editingEventId;
    } else {
      const { data: inserted, error } = await supabase
        .from('events')
        .insert({ ...payload, user_id: user.id })
        .select('id')
        .single();
      if (error || !inserted) {
        Alert.alert('Error', 'Could not save event. Please try again.');
        log.error('Calendar', 'Supabase error:', error);
        return;
      }
      savedId = inserted.id;
    }

    if (newEvent.recurrence) {
      await fetchEvents();
    } else {
      const eventDate = newEvent.startDate ?? selectedDate;
      const localEvent: CalendarEventItem = {
        id: savedId,
        userId: currentUserId ?? '',
        title: newEvent.title,
        location: combinedLocation,
        time: newEvent.time,
        notify: newEvent.notify,
        notifyInAdvance: newEvent.notifyInAdvance,
        groupId: newEvent.groupId,
        recurrence: null,
        recurrenceInterval: 1,
        recurEndDate: null,
        startDate: eventDate,
      };
      setEvents((prev) => {
        const current = prev[eventDate] ?? [];
        return {
          ...prev,
          [eventDate]: editingEventId
            ? current.map((e) => (e.id === editingEventId ? localEvent : e))
            : [...current, localEvent],
        };
      });
    }

    resetForm();
  };

  const handleDeleteEvent = () => {
    if (!editingEventId) return;
    const isRecurring = !!newEvent.recurrence;
    Alert.alert(
      isRecurring ? 'Delete recurring event' : 'Delete event',
      isRecurring
        ? 'This will delete all occurrences of this recurring event. This cannot be undone.'
        : 'Are you sure you want to delete this event?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
              Alert.alert('Error', 'You must be signed in to delete events.');
              return;
            }
            const { error } = await supabase
              .from('events')
              .delete()
              .eq('id', editingEventId)
              .eq('user_id', user.id);
            if (error) {
              Alert.alert('Error', 'Could not delete event.');
              return;
            }
            if (isRecurring) {
              setEvents((prev) => {
                const next: Record<string, CalendarEventItem[]> = {};
                for (const [date, list] of Object.entries(prev)) {
                  const filtered = list.filter((e) => e.id !== editingEventId);
                  if (filtered.length > 0) next[date] = filtered;
                }
                return next;
              });
            } else {
              setEvents((prev) => ({
                ...prev,
                [selectedDate]: (prev[selectedDate] ?? []).filter((e) => e.id !== editingEventId),
              }));
            }
            setShowAddModal(false);
            setEditingEventId(null);
          },
        },
      ],
    );
  };

  const totalUpcoming = upcomingEvents.length;
  const reminderCount = useMemo(() => {
    let n = 0;
    Object.values(eventsVisibleByFilter).forEach((list) => {
      list?.forEach((e) => {
        if (e.notify) n += 1;
      });
    });
    return n;
  }, [eventsVisibleByFilter]);

  return (
    <PageShell hideBanner safeAreaClassName="bg-canvas" contentClassName="bg-canvas">
      <EventFormModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        editingEventId={editingEventId}
        selectedDate={selectedDate}
        groups={groups}
        adminGroupIds={adminGroupIds}
        newEvent={newEvent}
        setNewEvent={setNewEvent}
        timeValue={timeValue}
        showTimePicker={showTimePicker}
        setShowTimePicker={setShowTimePicker}
        onTimeChange={onTimeChange}
        showEndDatePicker={showEndDatePicker}
        setShowEndDatePicker={setShowEndDatePicker}
        endDateValue={endDateValue}
        onEndDateChange={onEndDateChange}
        onSave={handleSaveEvent}
        onDelete={handleDeleteEvent}
        locationSuggestions={locationSuggestions}
        locationSearching={locationSearching}
        onBuildingChange={handleBuildingChange}
        onSelectBuildingSuggestion={handleSelectBuildingSuggestion}
        roomSuggestions={roomSuggestions}
        roomSearching={roomSearching}
        roomError={roomError}
        onRoomChange={handleRoomChange}
        onSelectRoomSuggestion={handleSelectRoomSuggestion}
      />

      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-32"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {/* Flat header */}
        <View className="px-1 mb-4 flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[36px] font-bold text-ink-strong tracking-[-1.2px] leading-[36px] mb-2">
              Calendar
            </Text>
            <Text className="text-[13.5px] font-medium text-ink-subtle" numberOfLines={1}>
              {totalUpcoming} upcoming
              {reminderCount > 0 ? (
                <>
                  {' · '}
                  <Text style={{ color: SECONDARY, fontWeight: '600' }}>
                    {reminderCount} with reminders
                  </Text>
                </>
              ) : null}
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleOpenAddModal}
            activeOpacity={0.85}
            accessibilityLabel="New event"
            style={[shadows.primaryGlow, { backgroundColor: PRIMARY }]}
            className="flex-row items-center rounded-[12px] px-3.5 py-2.5 gap-1.5 mt-1"
          >
            <MaterialIcons name="add" size={16} color="#fff" />
            <Text className="text-white text-[13px] font-semibold">New event</Text>
          </TouchableOpacity>
        </View>

        {groups.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 8 }}
            className="-mx-1 mb-4"
          >
            <CalChip
              label="All"
              active={!selectedGroupFilterId}
              onPress={() => setSelectedGroupFilterId(null)}
            />
            {groups.map((g) => (
              <CalChip
                key={g.id}
                label={g.name}
                accent={accentForId(g.id)}
                active={selectedGroupFilterId === String(g.id)}
                onPress={() => setSelectedGroupFilterId(String(g.id))}
              />
            ))}
          </ScrollView>
        )}

        <View
          style={shadows.card}
          className="bg-white rounded-[20px] pb-2 mb-5 overflow-hidden"
        >
          <Calendar
            current={TODAY}
            onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
            markedDates={markedDates}
            theme={{
              calendarBackground: '#ffffff',
              todayTextColor: PRIMARY,
              arrowColor: PRIMARY,
              selectedDayBackgroundColor: PRIMARY,
              selectedDayTextColor: '#ffffff',
              dotColor: SECONDARY,
              selectedDotColor: '#ffffff',
              monthTextColor: '#16140F',
              dayTextColor: '#3A352D',
              textSectionTitleColor: '#9A9389',
              textDayFontWeight: '500',
              textMonthFontWeight: '700',
              textDayHeaderFontWeight: '600',
              textMonthFontSize: 16,
              textDayHeaderFontSize: 11,
            }}
          />
        </View>

        {upcomingEvents.length > 0 && (
          <View className="mb-5">
            <CalSectionHeading title="Upcoming" count={upcomingEvents.length} />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingRight: 8, gap: 8 }}
            >
              {upcomingEvents.map(({ date, event }) => {
                const groupName = event.groupId
                  ? groups.find((g) => String(g.id) === String(event.groupId))?.name
                  : null;
                const groupAccent = event.groupId ? accentForId(String(event.groupId)) : null;
                const isToday = date === TODAY;
                const selected = selectedDate === date;
                return (
                  <TouchableOpacity
                    key={`${date}-${event.id}`}
                    onPress={() => setSelectedDate(date)}
                    activeOpacity={0.75}
                    style={[
                      shadows.card,
                      { borderColor: selected ? PRIMARY : 'transparent', borderWidth: 1.5 },
                    ]}
                    className="w-[168px] bg-white rounded-[18px] p-3"
                  >
                    <View className="flex-row items-center gap-2 mb-2">
                      <View
                        style={{ backgroundColor: groupAccent ?? SECONDARY }}
                        className="w-7 h-7 rounded-lg items-center justify-center"
                      >
                        <MaterialIcons name="event" size={14} color="#fff" />
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text
                          style={{ color: isToday ? PRIMARY : '#9A9389' }}
                          className="text-[11px] font-bold uppercase tracking-[1.2px]"
                          numberOfLines={1}
                        >
                          {formatUpcomingDate(date)}
                        </Text>
                        <Text className="text-[12.5px] font-semibold text-ink-strong" numberOfLines={1}>
                          {event.time}
                        </Text>
                      </View>
                    </View>
                    <Text
                      className="text-[14px] font-semibold text-ink-strong leading-[19px] mb-1"
                      numberOfLines={2}
                    >
                      {event.title}
                    </Text>
                    {event.location ? (
                      <Text className="text-[11.5px] text-ink-subtle font-medium" numberOfLines={1}>
                        {event.location}
                      </Text>
                    ) : null}
                    {groupName ? (
                      <View
                        style={{ backgroundColor: groupAccent ?? PRIMARY }}
                        className="flex-row items-center gap-1 self-start rounded-md px-2 py-[2px] mt-2"
                      >
                        <MaterialIcons name="groups" size={9} color="#fff" />
                        <Text className="text-[10px] text-white font-semibold" numberOfLines={1}>
                          {groupName}
                        </Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View className="mt-1 mb-2">
          <CalSectionHeading title="Events" count={sortedEvents.length || undefined} />
          <Text className="text-[13.5px] text-ink-subtle font-medium px-1 -mt-1">
            {formatSelectedDate(selectedDate)}
          </Text>
        </View>

        {sortedEvents.length === 0 ? (
          <View
            style={{ borderColor: '#E9E5DC', borderStyle: 'dashed', borderWidth: 1 }}
            className="bg-white rounded-[20px] items-center py-8 px-5"
          >
            <View
              style={{ backgroundColor: 'rgba(11, 97, 126, 0.08)' }}
              className="w-14 h-14 rounded-[16px] items-center justify-center mb-3"
            >
              <MaterialIcons name="event" size={22} color={PRIMARY} />
            </View>
            <Text className="text-[15px] font-semibold text-ink-strong mb-1">Nothing scheduled</Text>
            <Text className="text-[13px] text-ink-subtle text-center leading-[19px] max-w-[260px]">
              {selectedGroupFilterId
                ? 'No events for this group today.'
                : 'Tap "New event" to add something.'}
            </Text>
          </View>
        ) : (
          sortedEvents.map((item) => (
            <EventCard
              key={`${selectedDate}-${item.id}`}
              item={item}
              groups={groups}
              canEdit={item.userId === currentUserId || (!!item.groupId && adminGroupIds.has(item.groupId))}
              onOpen={() => handleEventPress(item.location)}
              onEdit={() => handleOpenEditModal(item)}
            />
          ))
        )}
      </ScrollView>
    </PageShell>
  );
}

function EventCard({
  item,
  groups,
  canEdit,
  onOpen,
  onEdit,
}: {
  item: CalendarEventItem;
  groups: GroupRow[];
  canEdit: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const groupName = item.groupId
    ? groups.find((g) => String(g.id) === String(item.groupId))?.name
    : null;
  const accent = item.groupId ? accentForId(String(item.groupId)) : SECONDARY;
  const [timeNum, timeAmPm] = item.time.includes(' ')
    ? item.time.split(' ')
    : [item.time, ''];

  return (
    <View
      style={shadows.card}
      className="flex-row items-stretch bg-white rounded-[18px] mb-2 p-3 overflow-hidden relative"
    >
      <View style={{ backgroundColor: accent }} className="w-[3px] rounded-sm mr-3" />
      <TouchableOpacity
        className="flex-1 flex-row min-w-0 mr-2"
        onPress={onOpen}
        activeOpacity={0.72}
      >
        <View className="min-w-[60px] mr-3">
          <Text className="text-[14.5px] font-bold text-ink-strong tracking-[-0.2px] leading-[16px]">
            {timeNum}
          </Text>
          {timeAmPm ? (
            <Text className="text-[10.5px] font-semibold text-ink-dim tracking-[0.6px] mt-0.5">
              {timeAmPm}
            </Text>
          ) : null}
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-[15px] font-semibold text-ink-strong tracking-[-0.2px] mb-0.5" numberOfLines={2}>
            {item.title}
          </Text>
          {item.location ? (
            <View className="flex-row items-center gap-1">
              <MaterialIcons name="place" size={11} color="#6B6660" />
              <Text className="text-[12.5px] text-ink-subtle font-medium flex-1" numberOfLines={1}>
                {item.location}
              </Text>
            </View>
          ) : null}
          <View className="flex-row items-center gap-2 mt-1.5 flex-wrap">
            {groupName ? (
              <View
                style={{ backgroundColor: accent }}
                className="flex-row items-center gap-1 rounded-lg px-2 py-[2px]"
              >
                <MaterialIcons name="groups" size={10} color="#fff" />
                <Text className="text-[11px] text-white font-semibold" numberOfLines={1}>
                  {groupName}
                </Text>
              </View>
            ) : null}
            {item.recurrence ? (
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="repeat" size={10} color={PRIMARY} />
                <Text style={{ color: PRIMARY }} className="text-[11px] font-semibold">
                  {getRecurrenceLabel(item.recurrence, item.recurrenceInterval)}
                </Text>
              </View>
            ) : null}
            {item.notify ? (
              <View className="flex-row items-center gap-1">
                <MaterialIcons name="notifications-active" size={10} color={SECONDARY_DEEP} />
                <Text style={{ color: SECONDARY_DEEP }} className="text-[11px] font-semibold">
                  Notify
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
      {canEdit && (
        <TouchableOpacity
          onPress={onEdit}
          accessibilityLabel="Edit event"
          style={{ backgroundColor: '#F0EDE5' }}
          className="w-8 h-8 rounded-[10px] items-center justify-center self-center"
        >
          <MaterialIcons name="edit" size={14} color="#3A352D" />
        </TouchableOpacity>
      )}
    </View>
  );
}

function CalChip({
  label,
  active,
  accent,
  onPress,
}: {
  label: string;
  active: boolean;
  accent?: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={{
        backgroundColor: active ? PRIMARY : '#fff',
        borderColor: active ? PRIMARY : '#E9E5DC',
      }}
      className="flex-row items-center gap-1.5 rounded-full px-3 py-[7px] mr-1.5 border"
    >
      {accent ? (
        <View
          style={{ backgroundColor: active ? '#fff' : accent }}
          className="w-2 h-2 rounded-full"
        />
      ) : null}
      <Text
        style={{ color: active ? '#fff' : '#3A352D' }}
        className="text-[13px] font-semibold"
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CalSectionHeading({ title, count }: { title: string; count?: number }) {
  return (
    <View className="flex-row items-center gap-2 px-1 mb-2.5">
      <Text
        style={{ color: PRIMARY }}
        className="text-[12px] font-semibold uppercase tracking-[1.2px]"
      >
        {title}
      </Text>
      {typeof count === 'number' && count > 0 ? (
        <View
          style={{ backgroundColor: 'rgba(11, 97, 126, 0.10)' }}
          className="px-[7px] py-[2px] rounded-lg"
        >
          <Text style={{ color: PRIMARY }} className="text-[11px] font-bold">
            {count}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

type EventFormModalProps = {
  visible: boolean;
  onClose: () => void;
  editingEventId: string | null;
  selectedDate: string;
  groups: GroupRow[];
  adminGroupIds: Set<string>;
  newEvent: NewEventForm;
  setNewEvent: React.Dispatch<React.SetStateAction<NewEventForm>>;
  timeValue: Date;
  showTimePicker: boolean;
  setShowTimePicker: (v: boolean) => void;
  onTimeChange: (e: DateTimePickerEvent, selectedTime?: Date) => void;
  showEndDatePicker: boolean;
  setShowEndDatePicker: (v: boolean) => void;
  endDateValue: Date;
  onEndDateChange: (e: DateTimePickerEvent, selectedDate?: Date) => void;
  onSave: () => void;
  onDelete: () => void;
  locationSuggestions: SearchItem[];
  locationSearching: boolean;
  onBuildingChange: (t: string) => void;
  onSelectBuildingSuggestion: (i: SearchItem) => void;
  roomSuggestions: GraphNode[];
  roomSearching: boolean;
  roomError: string | null;
  onRoomChange: (t: string) => void;
  onSelectRoomSuggestion: (n: GraphNode) => void;
};

function EventFormModal(props: EventFormModalProps) {
  const insets = useSafeAreaInsets();
  const { height: screenHeight } = useWindowDimensions();
  // Limit the scrollable form area so the sheet never overflows the screen.
  const maxScrollHeight = screenHeight * 0.52;
  const {
    visible,
    onClose,
    editingEventId,
    selectedDate,
    groups,
    adminGroupIds,
    newEvent,
    setNewEvent,
    timeValue,
    showTimePicker,
    setShowTimePicker,
    onTimeChange,
    showEndDatePicker,
    setShowEndDatePicker,
    endDateValue,
    onEndDateChange,
    onSave,
    onDelete,
    locationSuggestions,
    locationSearching,
    onBuildingChange,
    onSelectBuildingSuggestion,
    roomSuggestions,
    roomSearching,
    roomError,
    onRoomChange,
    onSelectRoomSuggestion,
  } = props;

  const [showCustomRepeat, setShowCustomRepeat] = useState(false);
  const [customFreq, setCustomFreq] = useState<RecurrenceType>('weekly');
  const [customIntervalVal, setCustomIntervalVal] = useState(1);
  const [kbVisible, setKbVisible] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () => setKbVisible(true));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const footerPaddingBottom = kbVisible ? 8 : Math.max(insets.bottom, 16);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Backdrop — separate so it doesn't participate in KAV layout */}
      <Pressable
        onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }}
      />
      {/* Sheet — KAV wraps only the sheet so keyboard lifts it cleanly */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={shadows.sheet}
          className="bg-white rounded-t-3xl"
        >
          <View className="self-center w-10 h-[5px] rounded-[3px] bg-[#d4d8de] mt-3 mb-1" />
          <View className="px-5 pb-3.5 pt-2 border-b border-line">
            <Text className="text-[22px] font-bold text-primary mb-0.5">
              {editingEventId ? 'Edit Event' : 'New Event'}
            </Text>
            <Text className="text-[13px] text-ink-subtle font-medium">
              {formatSelectedDate(selectedDate)}
            </Text>
          </View>

          <ScrollView
            className="px-5 pt-1"
            style={{ maxHeight: maxScrollHeight }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
                <FormLabel>Group</FormLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1 mt-1" contentContainerStyle={{ flexGrow: 0 }}>
                  <FormChip
                    label="None"
                    active={!newEvent.groupId}
                    onPress={() => setNewEvent((prev) => ({ ...prev, groupId: null }))}
                  />
                  {/* Admin groups first */}
                  {groups
                    .filter((group) => adminGroupIds.has(group.id))
                    .map((group) => (
                      <FormChip
                        key={group.id}
                        label={group.name}
                        active={String(newEvent.groupId) === String(group.id)}
                        disabled={false}
                        onPress={() => {
                          setNewEvent((prev) => ({ ...prev, groupId: String(group.id) }));
                        }}
                      />
                    ))}
                  {/* Non-admin groups after */}
                  {groups
                    .filter((group) => !adminGroupIds.has(group.id))
                    .map((group) => (
                      <FormChip
                        key={group.id}
                        label={group.name}
                        active={String(newEvent.groupId) === String(group.id)}
                        disabled={true}
                        onPress={() => {}}
                      />
                    ))}
                </ScrollView>
                {groups.length > 0 && groups.some(g => !adminGroupIds.has(g.id)) && (
                  <Text className="text-[11px] text-ink-dim mt-1 mb-1">
                    Only admins can create group events. Disabled groups are ones you&apos;re not an admin of.
                  </Text>
                )}

                <FormLabel>Event Title *</FormLabel>
                <FormInput
                  placeholder="e.g. CS313E Class"
                  value={newEvent.title}
                  onChangeText={(text) => setNewEvent((prev) => ({ ...prev, title: text }))}
                />

                <FormLabel>Location</FormLabel>
                <View className="flex-row items-start gap-2">
                  <View className="flex-1">
                    <FormInput
                      placeholder="Building (GDC, PCL…)"
                      value={newEvent.building}
                      onChangeText={onBuildingChange}
                    />
                    {locationSearching && <Text className="text-ink-dim text-xs mt-1">Searching…</Text>}
                    {locationSuggestions.length > 0 && (
                      <View className="mt-1 border border-line-neutral rounded-xl bg-white overflow-hidden">
                        {locationSuggestions.map((item) => (
                          <TouchableOpacity
                            key={item.id}
                            className="flex-row items-center py-2.5 px-3.5 border-b border-line-neutral"
                            onPress={() => onSelectBuildingSuggestion(item)}
                          >
                            <MaterialIcons name="location-on" size={16} color={PRIMARY} style={{ marginRight: 8 }} />
                            <View className="flex-1">
                              <Text className="text-sm font-semibold text-ink" numberOfLines={1}>
                                {item.name}
                              </Text>
                              {item.address ? (
                                <Text className="text-xs text-ink-dim mt-[1px]" numberOfLines={1}>
                                  {item.address}
                                </Text>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                  <View style={{ width: 90 }}>
                    <FormInput
                      placeholder="Room"
                      value={newEvent.room}
                      onChangeText={onRoomChange}
                      editable={!!newEvent.building.trim()}
                      className={!newEvent.building.trim() ? 'opacity-50' : ''}
                    />
                    {roomSearching && <Text className="text-ink-dim text-xs mt-1">…</Text>}
                    {roomSuggestions.length > 0 && (
                      <View className="mt-1 border border-line-neutral rounded-xl bg-white overflow-hidden">
                        {roomSuggestions.map((node) => (
                          <TouchableOpacity
                            key={node.id}
                            className="flex-row items-center py-2.5 px-3.5 border-b border-line-neutral"
                            onPress={() => onSelectRoomSuggestion(node)}
                          >
                            <Text className="text-sm font-semibold text-ink">{node.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    {roomError ? <Text className="text-danger text-xs mt-1">{roomError}</Text> : null}
                  </View>
                </View>

                <FormLabel>Time *</FormLabel>
                <TouchableOpacity
                  className="flex-row items-center border border-line-neutral rounded-xl p-3.5 bg-surface-subtle"
                  onPress={() => setShowTimePicker(true)}
                >
                  <MaterialIcons name="access-time" size={20} color={PRIMARY} style={{ marginRight: 8 }} />
                  <Text className={cn('text-base', newEvent.time ? 'text-ink' : 'text-ink-faint')}>
                    {newEvent.time || 'Tap to select time'}
                  </Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <View
                    className={cn(
                      Platform.OS === 'ios' &&
                        'bg-surface-subtle rounded-xl mt-2 overflow-hidden border border-line-neutral'
                    )}
                  >
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
                        className="bg-line-neutral p-3 items-center"
                        onPress={() => setShowTimePicker(false)}
                      >
                        <Text className="text-base font-semibold text-primary">Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                <FormLabel>Alert</FormLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1 mt-1">
                  {[
                    { label: 'None', value: null },
                    { label: 'At start', value: 0 },
                    { label: '10 min before', value: 10 },
                    { label: '1 hour before', value: 60 },
                  ].map((option) => (
                    <FormChip
                      key={option.label}
                      label={option.label}
                      active={newEvent.notifyInAdvance === option.value}
                      onPress={() =>
                        setNewEvent((prev) => ({
                          ...prev,
                          notifyInAdvance: option.value,
                          notify: option.value !== null,
                        }))
                      }
                    />
                  ))}
                </ScrollView>

                <FormLabel>Repeat</FormLabel>
                <TouchableOpacity
                  className="flex-row items-center justify-between border border-line-neutral rounded-xl p-3.5 bg-surface-subtle mb-1 mt-1"
                  onPress={() => {
                    const isCurrentPreset = (p: RecurrencePreset) =>
                      p.value === newEvent.recurrence && p.interval === newEvent.recurrenceInterval;
                    const noneIsSelected = !newEvent.recurrence;

                    if (Platform.OS === 'ios') {
                      const sheetOptions = [
                        ...RECURRENCE_PRESETS.map((p) => p.label),
                        'Cancel',
                      ];
                      ActionSheetIOS.showActionSheetWithOptions(
                        { options: sheetOptions, cancelButtonIndex: sheetOptions.length - 1 },
                        (idx) => {
                          const preset = RECURRENCE_PRESETS[idx];
                          if (!preset) return;
                          if (preset.custom) {
                            setCustomFreq(newEvent.recurrence ?? 'weekly');
                            setCustomIntervalVal(newEvent.recurrenceInterval > 0 ? newEvent.recurrenceInterval : 1);
                            setShowCustomRepeat(true);
                            return;
                          }
                          setNewEvent((prev) => ({ ...prev, recurrence: preset.value, recurrenceInterval: preset.interval }));
                        },
                      );
                    } else {
                      Alert.alert(
                        'Repeat',
                        undefined,
                        [
                          ...RECURRENCE_PRESETS.map((p) => {
                            const checked = !p.custom && (p.value === null ? noneIsSelected : isCurrentPreset(p));
                            return {
                              text: checked ? `✓ ${p.label}` : p.label,
                              onPress: () => {
                                if (p.custom) {
                                  setCustomFreq(newEvent.recurrence ?? 'weekly');
                                  setCustomIntervalVal(newEvent.recurrenceInterval > 0 ? newEvent.recurrenceInterval : 1);
                                  setShowCustomRepeat(true);
                                  return;
                                }
                                setNewEvent((prev) => ({ ...prev, recurrence: p.value, recurrenceInterval: p.interval }));
                              },
                            };
                          }),
                          { text: 'Cancel', style: 'cancel' as const },
                        ],
                      );
                    }
                  }}
                >
                  <View className="flex-row items-center gap-2">
                    <MaterialIcons name="repeat" size={20} color={newEvent.recurrence ? PRIMARY : '#94a3b8'} />
                    <Text className={newEvent.recurrence ? 'text-base text-ink font-medium' : 'text-base text-ink-faint'}>
                      {getRecurrenceLabel(newEvent.recurrence, newEvent.recurrenceInterval)}
                    </Text>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
                </TouchableOpacity>

                {newEvent.recurrence ? (
                  <>
                    <FormLabel>Until</FormLabel>
                    <TouchableOpacity
                      className="flex-row items-center border border-line-neutral rounded-xl p-3.5 bg-surface-subtle mb-1"
                      onPress={() => setShowEndDatePicker(true)}
                    >
                      <MaterialIcons name="event" size={20} color={PRIMARY} style={{ marginRight: 8 }} />
                      <Text className={cn('text-base', newEvent.recurEndDate ? 'text-ink' : 'text-ink-faint')}>
                        {newEvent.recurEndDate
                          ? parseISODate(newEvent.recurEndDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : 'Tap to set end date'}
                      </Text>
                    </TouchableOpacity>
                    {showEndDatePicker && (
                      <View className={cn(Platform.OS === 'ios' && 'bg-surface-subtle rounded-xl mt-2 overflow-hidden border border-line-neutral')}>
                        <DateTimePicker
                          value={endDateValue}
                          mode="date"
                          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                          onChange={onEndDateChange}
                          minimumDate={new Date()}
                          textColor="#000000"
                          themeVariant="light"
                        />
                        {Platform.OS === 'ios' && (
                          <TouchableOpacity
                            className="bg-line-neutral p-3 items-center"
                            onPress={() => setShowEndDatePicker(false)}
                          >
                            <Text className="text-base font-semibold text-primary">Done</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </>
                ) : null}

                {editingEventId && (
                  <TouchableOpacity
                    className="flex-row items-center justify-center bg-danger-bgAlt py-3.5 rounded-xl mb-2 mt-2 border border-danger-borderAlt"
                    onPress={onDelete}
                  >
                    <MaterialIcons name="delete-outline" size={18} color="#dc2626" style={{ marginRight: 6 }} />
                    <Text className="text-[15px] font-semibold text-danger">Delete Event</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>

              <View
                className="flex-row px-5 pt-3 border-t border-line-faint"
                style={{ paddingBottom: footerPaddingBottom }}
              >
                <TouchableOpacity
                  onPress={onClose}
                  className="flex-1 py-3.5 rounded-xl bg-surface-raised items-center mr-2"
                >
                  <Text className="text-base font-semibold text-ink-subtle">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={onSave}
                  className="flex-1 py-3.5 rounded-xl bg-primary items-center ml-2"
                >
                  <Text className="text-base font-bold text-white">
                    {editingEventId ? 'Update' : 'Save'}
                  </Text>
                </TouchableOpacity>
              </View>

              {showCustomRepeat && (
                <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
                  <View className="self-center w-10 h-[5px] rounded-[3px] bg-[#d4d8de] mt-3 mb-1" />
                  <View className="px-5 pb-3.5 pt-2 border-b border-line">
                    <Text className="text-[22px] font-bold text-primary">Custom Repeat</Text>
                  </View>
                  <ScrollView className="px-5" showsVerticalScrollIndicator={false}>
                    <Text className="text-[11px] font-bold text-ink-subtle mb-3 mt-5 tracking-[0.8px] uppercase">Frequency</Text>
                    <View className="border border-line-neutral rounded-2xl overflow-hidden mb-5">
                      {([
                        { label: 'Daily',   value: 'daily'   as RecurrenceType },
                        { label: 'Weekly',  value: 'weekly'  as RecurrenceType },
                        { label: 'Monthly', value: 'monthly' as RecurrenceType },
                      ] as { label: string; value: RecurrenceType }[]).map((opt, i) => (
                        <TouchableOpacity
                          key={opt.value}
                          onPress={() => setCustomFreq(opt.value)}
                          className={cn(
                            'flex-row items-center justify-between px-4 py-3.5',
                            i < 2 ? 'border-b border-line-neutral' : '',
                          )}
                        >
                          <Text className="text-[15px] font-medium text-ink-strong">{opt.label}</Text>
                          {customFreq === opt.value && <MaterialIcons name="check" size={18} color={PRIMARY} />}
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text className="text-[11px] font-bold text-ink-subtle mb-3 tracking-[0.8px] uppercase">Every</Text>
                    <View className="flex-row items-center gap-4 border border-line-neutral rounded-2xl px-4 py-3 mb-4">
                      <TouchableOpacity
                        onPress={() => setCustomIntervalVal((n) => Math.max(1, n - 1))}
                        className="w-9 h-9 rounded-full bg-surface-subtle items-center justify-center"
                      >
                        <MaterialIcons name="remove" size={20} color={customIntervalVal <= 1 ? '#cbd5e1' : '#3A352D'} />
                      </TouchableOpacity>
                      <Text className="flex-1 text-center text-[22px] font-bold text-ink-strong">
                        {customIntervalVal} {customIntervalVal === 1 ? RECURRENCE_UNIT[customFreq] : `${RECURRENCE_UNIT[customFreq]}s`}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setCustomIntervalVal((n) => Math.min(99, n + 1))}
                        className="w-9 h-9 rounded-full bg-surface-subtle items-center justify-center"
                      >
                        <MaterialIcons name="add" size={20} color="#3A352D" />
                      </TouchableOpacity>
                    </View>
                    <Text className="text-[13px] text-ink-subtle text-center mb-4">
                      {customIntervalVal === 1
                        ? `Event will occur every ${RECURRENCE_UNIT[customFreq]}.`
                        : `Event will occur every ${customIntervalVal} ${RECURRENCE_UNIT[customFreq]}s.`}
                    </Text>
                  </ScrollView>
                  <View
                    className="flex-row px-5 pt-3 border-t border-line-faint"
                    style={{ paddingBottom: footerPaddingBottom }}
                  >
                    <TouchableOpacity
                      onPress={() => setShowCustomRepeat(false)}
                      className="flex-1 py-3.5 rounded-xl bg-surface-raised items-center mr-2"
                    >
                      <Text className="text-base font-semibold text-ink-subtle">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setNewEvent((prev) => ({ ...prev, recurrence: customFreq, recurrenceInterval: customIntervalVal }));
                        setShowCustomRepeat(false);
                      }}
                      className="flex-1 py-3.5 rounded-xl bg-primary items-center ml-2"
                    >
                      <Text className="text-base font-bold text-white">Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
          )}
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FormLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-[11px] font-bold text-ink-subtle mb-2 mt-4 tracking-[0.8px] uppercase">
      {children}
    </Text>
  );
}

function FormInput({
  className,
  ...rest
}: React.ComponentProps<typeof TextInput> & { className?: string }) {
  return (
    <TextInput
      placeholderTextColor="#999"
      className={cn(
        'border border-line-neutral rounded-xl p-3.5 text-base bg-surface-subtle text-ink',
        className
      )}
      {...rest}
    />
  );
}

function FormChip({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'py-2 px-3.5 rounded-[10px] mr-2 border',
        active ? 'bg-primary border-primary' : 'bg-surface-raised border-line-neutral',
        disabled && 'opacity-40'
      )}
    >
      <Text className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-ink-subtle')}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

