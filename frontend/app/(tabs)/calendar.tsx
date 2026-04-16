import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
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
  View,
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import type { CalendarProps, DateData } from 'react-native-calendars';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications';
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
import { Chip, IconButton, PageShell, SectionLabel } from '@/components/ui';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

const PRIMARY = '#0B617E';

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

type EventRow = {
  id: string;
  title: string;
  location: string | null;
  time: string;
  notify: boolean;
  notify_in_advance: number | null;
  event_date: string;
  group_id: string | null;
};

type CalendarEventItem = {
  id: string;
  title: string;
  location: string;
  time: string;
  notify: boolean;
  notifyInAdvance: number | null;
  groupId: string | null;
};

type NewEventForm = {
  title: string;
  building: string;
  room: string;
  time: string;
  notify: boolean;
  notifyInAdvance: number | null;
  groupId: string | null;
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
    weekday: 'short',
    month: 'short',
    day: 'numeric',
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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function CalendarScreen() {
  const router = useRouter();
  const { groupId: paramGroupId } = useLocalSearchParams<{ groupId?: string }>();
  const paramGroupIdSingle = Array.isArray(paramGroupId) ? paramGroupId[0] : paramGroupId;

  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [events, setEvents] = useState<Record<string, CalendarEventItem[]>>({});
  const [groups, setGroups] = useState<GroupRow[]>([]);
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

  const [newEvent, setNewEvent] = useState<NewEventForm>({
    title: '',
    building: '',
    room: '',
    time: '',
    notify: false,
    notifyInAdvance: null,
    groupId: null,
  });

  const fetchEvents = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: memberData } = await supabase
      .from('group_members')
      .select('groups(id, name)')
      .eq('user_id', user.id);

    if (memberData) {
      const userGroups = memberData
        .map((r) => unwrapGroup(r.groups))
        .filter((g): g is GroupRow => g != null)
        .sort((a, b) => a.name.localeCompare(b.name));
      setGroups(userGroups);
    }

    const { data: eventData, error } = await supabase
      .from('events')
      .select('*')
      .eq('user_id', user.id);

    if (error) {
      if (__DEV__) console.error('Error fetching events:', error);
      return;
    }

    if (eventData) {
      const formattedEvents: Record<string, CalendarEventItem[]> = {};
      (eventData as EventRow[]).forEach((event) => {
        if (!formattedEvents[event.event_date]) formattedEvents[event.event_date] = [];
        formattedEvents[event.event_date].push({
          id: event.id,
          title: event.title,
          location: event.location ?? '',
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

  useEffect(() => {
    if (paramGroupIdSingle) setSelectedGroupFilterId(paramGroupIdSingle);
  }, [paramGroupIdSingle]);

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

  const handleOpenEditModal = (event: CalendarEventItem) => {
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
      groupId: event.groupId ?? null,
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
            title: newEvent.title,
            body: combinedLocation ? `Head to ${combinedLocation}` : 'Your event is starting!',
            sound: true,
          },
          trigger: { type: 'date', date: triggerDate } as Notifications.DateTriggerInput,
        });
      } else {
        Alert.alert('Note', "The notification time is in the past — you won't be notified for this event.");
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
      if (__DEV__) console.error('Supabase error:', error);
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

    setEvents((prev) => {
      const current = prev[selectedDate] ?? [];
      return {
        ...prev,
        [selectedDate]: editingEventId
          ? current.map((e) => (e.id === editingEventId ? localEvent : e))
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
          setEvents((prev) => ({
            ...prev,
            [selectedDate]: (prev[selectedDate] ?? []).filter((e) => e.id !== editingEventId),
          }));
          setShowAddModal(false);
          setEditingEventId(null);
        },
      },
    ]);
  };

  return (
    <PageShell
      title="Calendar"
      right={
        <IconButton tone="surface" onPress={handleOpenAddModal} accessibilityLabel="Add event">
          <MaterialIcons name="add" size={22} color={PRIMARY} />
        </IconButton>
      }
    >
      <EventFormModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        editingEventId={editingEventId}
        selectedDate={selectedDate}
        groups={groups}
        newEvent={newEvent}
        setNewEvent={setNewEvent}
        timeValue={timeValue}
        showTimePicker={showTimePicker}
        setShowTimePicker={setShowTimePicker}
        onTimeChange={onTimeChange}
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
        contentContainerClassName="px-5 pt-4 pb-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {groups.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="flex-row items-center py-0.5"
            className="mb-4"
          >
            <Chip
              label="All"
              active={!selectedGroupFilterId}
              onPress={() => setSelectedGroupFilterId(null)}
              className="mr-2"
            />
            {groups.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                active={selectedGroupFilterId === String(g.id)}
                onPress={() => setSelectedGroupFilterId(String(g.id))}
                className="mr-2"
              />
            ))}
          </ScrollView>
        )}

        <View
          style={shadows.card}
          className="bg-white rounded-2xl border border-line pb-2 mb-5 overflow-hidden"
        >
          <Calendar
            current={TODAY}
            onDayPress={(day: DateData) => setSelectedDate(day.dateString)}
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

        {upcomingEvents.length > 0 && (
          <View className="mb-5">
            <SectionLabel>UPCOMING</SectionLabel>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerClassName="flex-row gap-2.5 pr-1"
            >
              {upcomingEvents.map(({ date, event }) => {
                const groupName = event.groupId
                  ? groups.find((g) => String(g.id) === String(event.groupId))?.name
                  : null;
                const isToday = date === TODAY;
                const selected = selectedDate === date;
                return (
                  <TouchableOpacity
                    key={`${date}-${event.id}`}
                    onPress={() => setSelectedDate(date)}
                    activeOpacity={0.75}
                    style={shadows.card}
                    className={cn(
                      'w-[150px] bg-white rounded-card border p-3',
                      selected ? 'border-primary border-[1.5px]' : 'border-line'
                    )}
                  >
                    <View
                      className={cn(
                        'self-start rounded-md px-[7px] py-[3px] mb-2',
                        isToday ? 'bg-primary/10' : 'bg-surface-raised'
                      )}
                    >
                      <Text
                        className={cn(
                          'text-[11px] font-semibold',
                          isToday ? 'text-primary' : 'text-ink-subtle'
                        )}
                      >
                        {formatUpcomingDate(date)}
                      </Text>
                    </View>
                    <Text className="text-xs font-bold text-primary mb-[3px]">{event.time}</Text>
                    <Text className="text-sm font-semibold text-ink leading-[19px]" numberOfLines={2}>
                      {event.title}
                    </Text>
                    {event.location ? (
                      <Text className="text-[11px] text-ink-dim mt-[3px]" numberOfLines={1}>
                        {event.location}
                      </Text>
                    ) : null}
                    {groupName ? (
                      <View className="flex-row items-center mt-1.5 bg-primary/[0.08] rounded-md px-1.5 py-0.5 self-start">
                        <MaterialIcons name="groups" size={10} color={PRIMARY} style={{ marginRight: 3 }} />
                        <Text className="text-[10px] text-primary font-semibold">{groupName}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View className="flex-row items-center mb-1">
          <SectionLabel className="mb-0 mt-0">Events</SectionLabel>
          {sortedEvents.length > 0 && (
            <View className="ml-2 bg-primary/[0.12] px-2 py-0.5 rounded-lg">
              <Text className="text-xs font-bold text-primary">{sortedEvents.length}</Text>
            </View>
          )}
        </View>
        <Text className="text-sm text-ink-dim mb-3 font-medium">{formatSelectedDate(selectedDate)}</Text>

        {sortedEvents.length === 0 ? (
          <View
            className="bg-white rounded-2xl border border-line border-dashed items-center py-8 px-5 mt-1"
          >
            <View className="w-16 h-16 rounded-full bg-surface-subtle items-center justify-center mb-3">
              <MaterialIcons name="event-available" size={30} color="#cbd5e1" />
            </View>
            <Text className="text-base font-semibold text-ink-body mb-1.5">No events</Text>
            <Text className="text-sm text-ink-dim text-center leading-5 max-w-[260px]">
              {selectedGroupFilterId
                ? 'No events for this group on this day. Tap + to add one.'
                : 'Nothing scheduled for this day. Tap + to add an event.'}
            </Text>
          </View>
        ) : (
          sortedEvents.map((item) => (
            <EventCard
              key={String(item.id)}
              item={item}
              groups={groups}
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
  onOpen,
  onEdit,
}: {
  item: CalendarEventItem;
  groups: GroupRow[];
  onOpen: () => void;
  onEdit: () => void;
}) {
  const groupName = item.groupId
    ? groups.find((g) => String(g.id) === String(item.groupId))?.name
    : null;

  return (
    <View
      style={shadows.card}
      className="flex-row items-center bg-white rounded-card border border-line mb-2.5 py-3 px-3"
    >
      <TouchableOpacity
        className="flex-1 flex-row items-center min-w-0 mr-2"
        onPress={onOpen}
        activeOpacity={0.72}
      >
        <View className="min-w-[64px] mr-3">
          <Text className="font-bold text-[13px] text-primary">{item.time}</Text>
        </View>
        <View className="flex-1 min-w-0">
          <Text className="text-[15px] font-semibold text-ink mb-0.5" numberOfLines={2}>
            {item.title}
          </Text>
          {item.location ? (
            <Text className="text-[13px] text-ink-dim" numberOfLines={1}>
              {item.location}
            </Text>
          ) : null}
          {groupName ? (
            <View className="flex-row items-center mt-1">
              <MaterialIcons name="groups" size={11} color={PRIMARY} style={{ marginRight: 3 }} />
              <Text className="text-[11px] text-primary font-semibold">{groupName}</Text>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onEdit}
        accessibilityLabel="Edit event"
        className="flex-row items-center py-[5px] px-[9px] rounded-lg bg-white border border-line-neutral shrink-0"
      >
        <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
        <Text className="text-primary text-xs font-semibold">Edit</Text>
      </TouchableOpacity>
    </View>
  );
}

type EventFormModalProps = {
  visible: boolean;
  onClose: () => void;
  editingEventId: string | null;
  selectedDate: string;
  groups: GroupRow[];
  newEvent: NewEventForm;
  setNewEvent: React.Dispatch<React.SetStateAction<NewEventForm>>;
  timeValue: Date;
  showTimePicker: boolean;
  setShowTimePicker: (v: boolean) => void;
  onTimeChange: (e: DateTimePickerEvent, selectedTime?: Date) => void;
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
  const {
    visible,
    onClose,
    editingEventId,
    selectedDate,
    groups,
    newEvent,
    setNewEvent,
    timeValue,
    showTimePicker,
    setShowTimePicker,
    onTimeChange,
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <Pressable onPress={onClose} className="flex-1 bg-[rgba(15,23,42,0.45)] justify-end">
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={shadows.sheet}
            className="bg-white rounded-t-3xl"
          >
            <View style={{ maxHeight: '88%' }}>
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
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <FormLabel>Group</FormLabel>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1 mt-1">
                  <FormChip
                    label="None"
                    active={!newEvent.groupId}
                    onPress={() => setNewEvent((prev) => ({ ...prev, groupId: null }))}
                  />
                  {groups.map((group) => (
                    <FormChip
                      key={group.id}
                      label={group.name}
                      active={String(newEvent.groupId) === String(group.id)}
                      onPress={() => setNewEvent((prev) => ({ ...prev, groupId: String(group.id) }))}
                    />
                  ))}
                </ScrollView>

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

              <View className="flex-row p-5 pt-3 border-t border-line-faint">
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
            </View>
          </Pressable>
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
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={cn(
        'py-2 px-3.5 rounded-[10px] mr-2 border',
        active ? 'bg-primary border-primary' : 'bg-surface-raised border-line-neutral'
      )}
    >
      <Text className={cn('text-[13px] font-semibold', active ? 'text-white' : 'text-ink-subtle')}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}
