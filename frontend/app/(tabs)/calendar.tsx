import React, { useState, useMemo, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  TouchableOpacity, 
  //SafeAreaView,
  Modal,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Switch
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Notifications from 'expo-notifications'; 

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
  const [events, setEvents] = useState<Record<string, any[]>>(DUMMY_EVENTS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [showTimePicker, setShowTimePicker] = useState(false);
  const [timeValue, setTimeValue] = useState(new Date());

  const [newEvent, setNewEvent] = useState<{
    title: string;
    location: string;
    time: string;
    notify: boolean;
    notifyInAdvance: number | null;
  }>({
    title: '',
    location: '',
    time: '',
    notify: false,
    notifyInAdvance: null,
  });
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      
      if (finalStatus !== 'granted') {
        console.log('Notification permissions not granted!');
      }
    })();
  }, []);

  const markedDates = useMemo(() => {
    const marked: Record<string, any> = {};
    Object.keys(events).forEach(date => {
      marked[date] = { marked: true, dotColor: '#0B617E' };
    });
    
    marked[selectedDate] = {
      ...(marked[selectedDate] || {}),
      selected: true,
      selectedColor: '#0B617E',
    };
    return marked;
  }, [selectedDate, events]);

  const handleEventPress = (location: string) => {
    router.push({
      pathname: '/(tabs)/map',
      params: { searchQuery: location }
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
    setNewEvent({ title: '', location: '', time: '', notify: false, notifyInAdvance: null});
    setTimeValue(new Date());
    setShowAddModal(true);
  };

  const handleOpenEditModal = (event: any) => {
    setEditingEventId(event.id);
    setNewEvent({
      title: event.title,
      location: event.location,
      time: event.time,
      notify: event.notify,
      notifyInAdvance: event.notifyInAdvance ?? null,
    });
    setTimeValue(parseTimeString(event.time));
    setShowAddModal(true);
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
            body: newEvent.location ? `Head to ${newEvent.location}` : 'Your event is starting now!',
            sound: true,
          },
          trigger: { type: 'date', date: triggerDate } as Notifications.DateTriggerInput,
        });
      } else {
        Alert.alert("Note", "The time you selected is in the past, so you will not be notified");
      }
    }

    const eventData = {
      id: editingEventId ? editingEventId : Date.now().toString(), 
      title: newEvent.title,
      location: newEvent.location,
      time: newEvent.time,
      notify: newEvent.notify,
    };

    setEvents(prev => {
      const currentDayEvents = prev[selectedDate] || [];
      if (editingEventId) {
        return {
          ...prev,
          [selectedDate]: currentDayEvents.map(e => e.id === editingEventId ? eventData : e)
        };
      } else {
        return {
          ...prev,
          [selectedDate]: [...currentDayEvents, eventData]
        };
      }
    });

    setNewEvent({ title: '', location: '', time: '', notify: false, notifyInAdvance: null});
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
        onPress: () => {
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
    <View style={styles.eventCardWrapper}>
      <TouchableOpacity 
        onPress={() => handleEventPress(item.location)}
        activeOpacity={0.7}
        style={{ flex: 1 }}
      >
        <View style={styles.eventCard}>
          <View style={styles.eventTimeBox}>
            <Text style={styles.eventTime}>{item.time}</Text>
          </View>
          <View style={styles.eventDetails}>
            <View style={styles.titleRow}>
              <Text style={styles.eventTitle}>{item.title}</Text>
            </View>
            <Text style={styles.eventSubtitle}>{item.location}</Text>
          </View>
          <MaterialIcons name="location-on" size={24} color="#999" />
        </View>
      </TouchableOpacity>
      
      <View style={styles.actionButtonsContainer}>
        <TouchableOpacity onPress={() => handleOpenEditModal(item)} style={styles.actionButton}>
          <MaterialIcons name="edit" size={22} color="#0B617E" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const sortedEvents = useMemo(() => {
    const dayEvents = events[selectedDate] || [];
    return [...dayEvents].sort((a, b) => {
      const timeA = parseTimeString(a.time).getTime();
      const timeB = parseTimeString(b.time).getTime();
      return timeA - timeB;
    });
  }, [events, selectedDate]);

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

                <Text style={styles.label}>Location</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., ECJ - Room 0132"
                  value={newEvent.location}
                  onChangeText={(text) => setNewEvent(prev => ({...prev, location: text }))}
                  placeholderTextColor="#999"
                />

                <Text style={styles.label}>Time *</Text>
                <TouchableOpacity 
                  style={styles.timeSelector}
                  onPress={() => setShowTimePicker(true)}
                >
                  <MaterialIcons name="access-time" size={20} color="#0B617E" style={{ marginRight: 8 }} />
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

      <View style={styles.container}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Calendar</Text>
          <TouchableOpacity style={styles.headerAddButton} onPress={handleOpenAddModal}>
            <MaterialIcons name="add" size={28} color="#0B617E" />
          </TouchableOpacity>
        </View>

        <Calendar
          current={TODAY}
          onDayPress={(day: any) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          theme={{ todayTextColor: '#0B617E', arrowColor: '#0B617E' }}
        />
        
        <View style={styles.listContainer}>
          <Text style={styles.dateHeader}>Events for {selectedDate}</Text>
          <FlatList
            data={sortedEvents}
            keyExtractor={(item) => item.id}
            renderItem={renderEventCard}
            ListEmptyComponent={<Text style={styles.emptyText}>No events scheduled.</Text>}
            showsVerticalScrollIndicator={false}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  container: { flex: 1, backgroundColor: '#ffffff' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 16, paddingHorizontal: 20 },
  headerTitle: { fontSize: 34, fontWeight: 'bold', color: '#0B617E' },
  headerAddButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#f0f0f0', alignItems: 'center', justifyContent: 'center' },
  listContainer: { flex: 1, paddingHorizontal: 20, paddingTop: 10 },
  dateHeader: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  eventCardWrapper: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  eventCard: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#eaeaea', alignItems: 'center', flex: 1},
  actionButtonsContainer: { flexDirection: 'row', alignItems: 'center', marginLeft: 8 },
  actionButton: { padding: 8 },
  eventTimeBox: { justifyContent: 'center', marginRight: 15, minWidth: 70 },
  eventTime: { fontWeight: '700', fontSize: 14, color: '#000' },
  eventDetails: { flex: 1, justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  eventTitle: { fontSize: 16, fontWeight: '600', color: '#000' },
  eventSubtitle: { fontSize: 14, color: '#666' },
  emptyText: { fontStyle: 'italic', color: '#888', textAlign: 'center', marginTop: 20 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.4)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, maxHeight: '85%' },
  modalHeader: { paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#000', marginBottom: 4 },
  modalDate: { fontSize: 15, color: '#666', fontWeight: '500' },
  formContainer: { paddingHorizontal: 24, paddingTop: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 14, fontSize: 16, backgroundColor: '#fafafa', color: '#000' },
  timeSelector: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#e0e0e0', borderRadius: 12, padding: 14, backgroundColor: '#fafafa' },
  timeSelectorText: { fontSize: 16, color: '#000' },
  iosPickerContainer: { backgroundColor: '#f9f9f9', borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  iosPickerDoneButton: { backgroundColor: '#e0e0e0', padding: 12, alignItems: 'center' },
  iosPickerDoneText: { fontSize: 16, fontWeight: '600', color: '#0B617E' },
  switchContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 24, marginBottom: 20, paddingVertical: 12, paddingHorizontal: 16, backgroundColor: '#f9f9f9', borderRadius: 12, borderWidth: 1, borderColor: '#f0f0f0' },
  switchLabel: { fontSize: 16, fontWeight: '500', color: '#333' },
  deleteFormButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffebe9', paddingVertical: 14, borderRadius: 12, marginBottom: 20, borderWidth: 1, borderColor: '#ffc1c0' },
  deleteFormText: { fontSize: 16, fontWeight: '600', color: '#ff3b30' },
  modalButtons: { flexDirection: 'row', padding: 24, paddingTop: 16, gap: 12, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  cancelButton: { flex: 1, paddingVertical: 16, borderRadius: 12, backgroundColor: '#f5f5f5', alignItems: 'center' },
  cancelButtonText: { fontSize: 16, fontWeight: '600', color: '#666' },
  addButton: { flex: 1, paddingVertical: 16, borderRadius: 12, backgroundColor: '#0B617E', alignItems: 'center' },
  addButtonText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  
  chipRow: { flexDirection: 'row', marginTop: 8, marginBottom: 20 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, backgroundColor: '#f0f0f0', borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: '#e0e0e0' },
  chipSelected: { backgroundColor: '#0B617E', borderColor: '#0B617E' },
  chipText: { fontSize: 14, fontWeight: '500', color: '#666' },
  chipTextSelected: { color: '#fff' },
});