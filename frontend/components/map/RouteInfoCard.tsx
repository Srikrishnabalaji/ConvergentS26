import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

type Props = {
  duration: string;
  distance: string;
  address: string;
  onStart: () => void;
  onSteps: () => void;
};

export function RouteInfoCard({
  duration,
  distance,
  address,
  onStart,
  onSteps,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.duration}>
        {duration}{' '}
        <Text style={styles.distance}>({distance})</Text>
      </Text>
      <Text style={styles.address}>{address}</Text>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.startButton}
          onPress={onStart}
          activeOpacity={0.8}
        >
          <MaterialIcons name="play-arrow" size={20} color="#fff" />
          <Text style={styles.startText}>Start</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.stepsButton}
          onPress={onSteps}
          activeOpacity={0.8}
        >
          <MaterialIcons name="format-list-numbered" size={18} color="#333" />
          <Text style={styles.stepsText}>Steps</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 24,
    paddingHorizontal: 24,
    paddingBottom: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 10,
  },
  duration: {
    fontSize: 22,
    fontWeight: '700',
    color: '#000',
  },
  distance: {
    fontSize: 22,
    fontWeight: '400',
    color: '#666',
  },
  address: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  startText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  stepsButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  stepsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});
