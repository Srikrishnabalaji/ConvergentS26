import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

type Props = {
  onConfirm: () => void;
  onReposition: () => void;
};

export function LocationConfirmCard({ onConfirm, onReposition }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Is this your exact location?</Text>
      <Text style={styles.subtitle}>
        If not, reposition your location marker
      </Text>
      <View style={styles.buttons}>
        <TouchableOpacity
          style={styles.confirmButton}
          onPress={onConfirm}
          activeOpacity={0.8}
        >
          <MaterialIcons name="check" size={20} color="#fff" />
          <Text style={styles.confirmText}>Yes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.repositionButton}
          onPress={onReposition}
          activeOpacity={0.8}
        >
          <MaterialIcons name="my-location" size={18} color="#333" />
          <Text style={styles.repositionText}>Reposition</Text>
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
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
  },
  subtitle: {
    fontSize: 14,
    color: '#999',
    marginTop: 4,
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#4CAF50',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  confirmText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  repositionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  repositionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});
