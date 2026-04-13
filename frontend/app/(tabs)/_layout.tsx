import { Tabs } from 'expo-router';
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';

const PRIMARY = '#0B617E';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: PRIMARY,
        tabBarInactiveTintColor: '#a0aab4',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: tabStyles.bar,
        tabBarLabelStyle: tabStyles.label,
      }}>
      <Tabs.Screen
        name="myGroups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.3.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="person.2.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => (
            <View style={[tabStyles.mapBtn, focused && tabStyles.mapBtnActive]}>
              <IconSymbol size={26} name="map.fill" color="#fff" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={24} name="gearshape.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}

const tabStyles = StyleSheet.create({
  bar: {
    borderTopWidth: 0,
    elevation: 0,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  mapBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  mapBtnActive: {
    backgroundColor: '#09506a',
    shadowOpacity: 0.4,
  },
});
