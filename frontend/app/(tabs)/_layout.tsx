import { Tabs } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

import { HapticTab } from '@/components/haptic-tab';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#0B617E',
        tabBarInactiveTintColor: '#94a3b8',
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarStyle: {
          borderTopWidth: 0,
          elevation: 0,
          backgroundColor: 'rgba(255,255,255,0.96)',
          shadowColor: '#16140F',
          shadowOffset: { width: 0, height: -2 },
          shadowOpacity: 0.05,
          shadowRadius: 10,
        },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
      }}>
      <Tabs.Screen
        name="myGroups"
        options={{
          title: 'Groups',
          tabBarIcon: ({ color, focused }) => (
            <MaterialCommunityIcons
              name="account-group-outline"
              size={24}
              color={color}
              style={{ opacity: focused ? 1 : 0.95 }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="account-outline" size={24} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: '',
          tabBarIcon: ({ focused }) => (
            <View
              style={shadows.primaryGlow}
              className={cn(
                'w-[56px] h-[56px] rounded-[28px] items-center justify-center mb-6 border-[4px] border-canvas',
                focused ? 'bg-primary-dark' : 'bg-primary'
              )}
            >
              <MaterialCommunityIcons name="map-outline" size={26} color="#fff" />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'Calendar',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="calendar-today" size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => (
            <MaterialIcons name="settings" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
