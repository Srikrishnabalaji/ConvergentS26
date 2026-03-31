import React, { useState } from 'react';
import { StyleSheet, Text, View, FlatList } from 'react-native';
import { Calendar } from 'react-native-calendars';

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

  const renderEventCard = ({ item }: { item: any }) => (
    <View style={styles.eventCard}>
      <View style={styles.eventTimeBox}>
        <Text style={styles.eventTime}>{item.time}</Text>
      </View>
      <View style={styles.eventDetails}>
        <Text style={styles.eventTitle}>{item.title}</Text>
        <Text style={styles.eventSubtitle}>{item.location}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Calendar
        onDayPress={(day: any) => setSelectedDate(day.dateString)}
        markedDates={{
          [selectedDate]: { selected: true, selectedColor: '#007C6E' }
        }}
        theme={{ 
          todayTextColor: '#007C6E', 
          arrowColor: '#007C6E' 
        }}
      />
      <View style={styles.listContainer}>
        <Text style={styles.dateHeader}>Events for {selectedDate}</Text>
        <FlatList
          data={DUMMY_EVENTS[selectedDate] || []}
          keyExtractor={(item) => item.id}
          renderItem={renderEventCard}
          ListEmptyComponent={<Text style={styles.emptyText}>No events scheduled.</Text>}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  listContainer: { flex: 1, padding: 20 },
  dateHeader: { fontSize: 16, fontWeight: 'bold', marginBottom: 15, color: '#333' },
  eventCard: { flexDirection: 'row', backgroundColor: 'white', padding: 15, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#ddd' },
  eventTimeBox: { justifyContent: 'center', marginRight: 15 },
  eventTime: { fontWeight: 'bold', fontSize: 14 },
  eventDetails: { flex: 1, justifyContent: 'center' },
  eventTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  eventSubtitle: { fontSize: 14, color: '#666' },
  emptyText: { fontStyle: 'italic', color: '#888' }
});