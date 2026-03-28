import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, SafeAreaView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function MapScreen() {
  const params = useLocalSearchParams();
  const [searchQuery, setSearchQuery] = useState('');

  // Auto-fill search when navigating from calendar
  useEffect(() => {
    if (params.searchQuery) {
      setSearchQuery(params.searchQuery as string);
      // Trigger your search/map update logic here
      handleSearch(params.searchQuery as string);
    }
  }, [params.searchQuery]);

  const handleSearch = (query: string) => {
    // Your existing search logic
    console.log('Searching for:', query);
    // Update map markers, etc.
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Header matching Groups/Calendar screen style */}
        <View className="flex-row items-center justify-between mt-4 mb-4 px-5">
          <Text className="text-[34px] font-bold text-black">Map</Text>
        </View>

        <View className="px-5">
          <TextInput
            style={styles.searchBar}
            placeholder="Search location..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={() => handleSearch(searchQuery)}
          />
        </View>

        {/* Your map component goes here */}
        <View style={styles.mapContainer}>
          <Text className="text-gray-400 text-center">Map</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: { 
    flex: 1,
    backgroundColor: '#ffffff'
  },
  searchBar: {
    height: 50,
    backgroundColor: 'white',
    paddingHorizontal: 15,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
    marginBottom: 10,
  },
  mapContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
  }
});