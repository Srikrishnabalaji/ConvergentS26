import React from 'react';
import { View, Text, SafeAreaView, StyleSheet } from 'react-native';

export default function MapScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View className="flex-1 items-center justify-center">
        <Text className="text-[32px] font-bold text-black">Map</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
});
