import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** Shown when MapLibre native code is unavailable (e.g. web or Expo Go). */
export function MapDevBuildPlaceholder() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Campus map</Text>
      <Text style={styles.body}>
        OpenStreetMap via MapLibre runs in the iOS or Android development build. Use{' '}
        <Text style={styles.mono}>npx expo run:ios</Text> or{' '}
        <Text style={styles.mono}>npx expo run:android</Text>.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#e8eef5',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    color: '#444',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  mono: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 13,
  },
});
