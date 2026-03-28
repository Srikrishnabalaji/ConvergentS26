import React, { useState, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  FlatList, 
  TouchableOpacity, 
  SafeAreaView,
  Modal,
  TextInput,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { Calendar } from 'react-native-calendars';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

// Dummy Data mapped to a recent date
const DUMMY_EVENTS: Record<string, any[]> = {
  '2026-03-25': [
    { id: '1', title: 'Time to Head Out!', location: 'ECJ, Room 132', time: 'now' },
    { id: '2', title: 'CS313E Class', location: 'ECJ - Room 0132', time: '1:00 PM' },
  ],
  '2026-03-26': [
    { id: '3', title: 'Study Group', location: 'PCL Library', time: '3:00 PM' }
  ]
};

export default function CalendarScreen() {
  const [selectedDate, setSelectedDate] = useState('2026-03-25');
  const [events, setEvents] = useState<Record<string, any[]>>(DUMMY_EVENTS);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    location: '',
    time: '',
  });
  const router = useRouter();

  //dots
  const markedDates = useMemo(() => {
    const marked: Record<string, any> = {};
    
    Object.keys(events).forEach(date => {
      marked[date] = {
        marked: true,
        dotColor: '#00adf5',
      };
    });
    
    // Add selection to the selected date
    if (marked[selectedDate]) {
      marked[selectedDate] = {...marked[selectedDate],
        selected: true,
        selectedColor: '#333',
      };
    } else {
      marked[selectedDate] = {
        selected: true,
        selectedColor: '#333',
      };
    }
    
    return marked;
  }, [selectedDate, events]);

  const handleEventPress = (location: string) => {
    router.push({
      pathname: '/(tabs)/map',
      params: { searchQuery: location }
    });
  };

  const handleAddEvent = () => {
    if (!newEvent.title.trim()) {
      Alert.alert('Error', 'Please enter an event title');
      return;
    }
    if (!newEvent.time.trim()) {
      Alert.alert('Error', 'Please enter a time');
      return;
    }

    const eventToAdd = {
      id: Date.now().toString(),
      title: newEvent.title,
      location: newEvent.location,
      time: newEvent.time,
    };

    setEvents(prev => ({...prev,
      [selectedDate]: [...(prev[selectedDate] || []), eventToAdd]
    }));

    // Reset form
    setNewEvent({ title: '', location: '', time: '' });
    setShowAddModal(false);
    Alert.alert('Success', 'Event added successfully!');
  };

  const handleDeleteEvent = (eventId: string) => {
    Alert.alert(
      'Delete Event',
      'Are you sure you want to delete this event?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEvents(prev => ({...prev,
              [selectedDate]: prev[selectedDate].filter(e => e.id !== eventId)
            }));
          }
        }
      ]
    );
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
            <Text style={styles.eventTitle}>{item.title}</Text>
            <Text style={styles.eventSubtitle}>{item.location}</Text>
          </View>
          <Text style={styles.arrowIcon}>→</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => handleDeleteEvent(item.id)}
        style={styles.deleteButton}
      >
        <MaterialIcons name="delete-outline" size={20} color="#ff3b30" />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Add Event Modal */}
      <Modal
        visible={showAddModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAddModal(false)}
      >
        <KeyboardAvoidingView 
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalOverlay}
        >
          <Pressable 
            style={styles.modalOverlay}
            onPress={() => setShowAddModal(false)}
          >
            <Pressable 
              style={styles.modalContent}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Add Event</Text>
                <Text style={styles.modalDate}>{selectedDate}</Text>
              </View>

              <ScrollView style={styles.formContainer}>
                <Text style={styles.label}>Event Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., CS313E Class"
                  value={newEvent.title}
                  onChangeText={(text) => setNewEvent(prev => ({...prev, title: text }))}
                />

                <Text style={styles.label}>Location</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., ECJ - Room 0132"
                  value={newEvent.location}
                  onChangeText={(text) => setNewEvent(prev => ({...prev, location: text }))}
                />

                <Text style={styles.label}>Time *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g., 1:00 PM"
                  value={newEvent.time}
                  onChangeText={(text) => setNewEvent(prev => ({...prev, time: text }))}
                />
              </ScrollView>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setShowAddModal(false)}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={handleAddEvent}
                >
                  <Text style={styles.addButtonText}>Add Event</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <View style={styles.container}>
        {/* Header with Add Button */}
        <View className="flex-row items-center justify-between mt-4 mb-4 px-5">
          <Text className="text-[34px] font-bold text-black">Calendar</Text>
          <TouchableOpacity
            className="w-11 h-11 rounded-full bg-gray-200 items-center justify-center"
            onPress={() => setShowAddModal(true)}
          >
            <MaterialIcons name="add" size={28} color="#000" />
          </TouchableOpacity>
        </View>

        <Calendar
          onDayPress={(day: any) => setSelectedDate(day.dateString)}
          markedDates={markedDates}
          theme={{ 
            todayTextColor: '#00adf5', 
            arrowColor: 'black' 
          }}
        />
        
        <View style={styles.listContainer}>
          <Text style={styles.dateHeader}>Events for {selectedDate}</Text>
          <FlatList
            data={events[selectedDate] || []}
            keyExtractor={(item) => item.id}
            renderItem={renderEventCard}
            ListEmptyComponent={<Text style={styles.emptyText}>No events scheduled.</Text>}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: { 
    flex: 1, 
    backgroundColor: '#ffffff' 
  },
  listContainer: { 
    flex: 1, 
    padding: 20 
  },
  dateHeader: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    marginBottom: 15, 
    color: '#333' 
  },
  eventCardWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  eventCard: { 
    flexDirection: 'row', 
    backgroundColor: 'white', 
    padding: 15, 
    borderRadius: 10, 
    borderWidth: 1, 
    borderColor: '#ddd',
    alignItems: 'center',
    flex: 1,
  },
  deleteButton: {
    padding: 10,
    marginLeft: 8,
  },
  eventTimeBox: { 
    justifyContent: 'center', 
    marginRight: 15 
  },
  eventTime: { 
    fontWeight: 'bold', 
    fontSize: 14 
  },
  eventDetails: { 
    flex: 1, 
    justifyContent: 'center' 
  },
  eventTitle: { 
    fontSize: 16, 
    fontWeight: 'bold', 
    marginBottom: 5 
  },
  eventSubtitle: { 
    fontSize: 14, 
    color: '#666' 
  },
  arrowIcon: { 
    fontSize: 20, 
    color: '#999', 
    marginLeft: 10 
  },
  emptyText: { 
    fontStyle: 'italic', 
    color: '#888' 
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: 'white',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 20,
    maxHeight: '80%',
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingBottom: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
    marginBottom: 5,
  },
  modalDate: {
    fontSize: 14,
    color: '#666',
  },
  formContainer: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
  },
  modalButtons: {
    flexDirection: 'row',
    padding: 20,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  cancelButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
  },
  addButton: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    backgroundColor: '#000',
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});