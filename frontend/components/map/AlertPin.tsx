import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { ALERT_COLORS, ALERT_ICONS } from '@/lib/alerts';
import type { AlertType } from '@/lib/alerts';

export const PIN_SIZE = 28;

type Props = {
  type: AlertType;
  /** Number of individual reports in this cluster; shows a badge when > 1 */
  count?: number;
};

export function AlertPin({ type, count = 1 }: Props) {
  const color = ALERT_COLORS[type];
  const icon = ALERT_ICONS[type] as any;
  return (
    <View style={[styles.pin, { backgroundColor: color, borderColor: color }]}>
      <MaterialIcons name={icon} size={15} color="#fff" />
      {count > 1 && (
        <View style={styles.countBadge}>
          <Text style={styles.countText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  countBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#1e293b',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  countText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
});
