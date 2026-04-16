import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

const PRIMARY = '#0B617E';

type Props = {
  duration: string;
  distance: string;
  eta: string;
  address: string;
  loading?: boolean;
  isWalking?: boolean;
  showingOverview?: boolean;
  onStart: () => void;
  onExit?: () => void;
  onOverview?: () => void;
};

export function RouteInfoCard({
  duration,
  distance,
  eta,
  address,
  loading,
  isWalking,
  showingOverview,
  onStart,
  onExit,
  onOverview,
}: Props) {
  return (
    <View style={styles.container}>
      {loading ? (
        <>
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={PRIMARY} />
            <Text style={styles.loadingText}>Finding walking route…</Text>
          </View>
          <Text style={styles.address}>{address}</Text>
        </>
      ) : (
        <>
          <Text style={styles.duration}>{duration}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{distance}</Text>
            {eta ? (
              <>
                <Text style={styles.metaDot}>·</Text>
                <MaterialIcons name="schedule" size={14} color="#888" />
                <Text style={styles.metaText}>Arrives {eta}</Text>
              </>
            ) : null}
          </View>
          <Text style={styles.address} numberOfLines={1}>
            {isWalking ? `Walking to ${address}` : address}
          </Text>
        </>
      )}

      <View style={styles.buttons}>
        {!isWalking ? (
          <TouchableOpacity
            style={[styles.startButton, loading && styles.buttonDisabled]}
            onPress={onStart}
            activeOpacity={0.8}
            disabled={loading}
          >
            <MaterialIcons name="play-arrow" size={20} color="#fff" />
            <Text style={styles.startText}>Start</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={styles.overviewButton}
              onPress={onOverview}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name={showingOverview ? 'navigation' : 'zoom-out-map'}
                size={18}
                color="#333"
              />
              <Text style={styles.overviewText}>
                {showingOverview ? 'Resume' : 'Overview'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.exitButton}
              onPress={onExit}
              activeOpacity={0.8}
            >
              <MaterialIcons name="close" size={20} color="#dc2626" />
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>
          </>
        )}
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
    fontSize: 28,
    fontWeight: '700',
    color: '#000',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  metaText: {
    fontSize: 15,
    color: '#666',
  },
  metaDot: {
    fontSize: 15,
    color: '#ccc',
  },
  address: {
    fontSize: 14,
    color: '#999',
    marginBottom: 20,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
  },
  startButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  startText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  overviewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f0f0',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  overviewText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  exitButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(220, 38, 38, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(220, 38, 38, 0.35)',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 6,
  },
  exitText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#dc2626',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
});
