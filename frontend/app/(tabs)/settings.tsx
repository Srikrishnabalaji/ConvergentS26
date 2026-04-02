import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Switch, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('User');
  const [shareLocation, setShareLocation] = useState(true);
  const [eventNotifications, setEventNotifications] = useState(true);
  const [leaveByAlerts, setLeaveByAlerts] = useState(true);

  useEffect(() => {
    let isMounted = true;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      const name =
        (typeof user?.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
        (typeof user?.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
        user?.email?.split('@')[0] ||
        'User';
      setDisplayName(name);
      setLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const initials = useMemo(() => {
    const parts = displayName.split(' ').filter(Boolean);
    if (parts.length === 0) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }, [displayName]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  }

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white" style={{ flex: 1, backgroundColor: '#ffffff' }}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#0B617E" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white" style={{ flex: 1, backgroundColor: '#ffffff' }}>
      <ScrollView
        className="flex-1 bg-white"
        style={{ backgroundColor: '#ffffff' }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-[34px] font-bold text-primary mb-4">Settings</Text>

        <View className="flex-row items-center mb-4">
          <View className="w-[72px] h-[72px] rounded-full bg-primary items-center justify-center mr-3">
            <Text className="text-white text-[30px] font-bold">{initials}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[34px] font-bold text-[#111111]">{displayName}</Text>
            <Text className="mt-0.5 text-[13px] font-medium text-gray-400">UT Austin</Text>
          </View>
        </View>

        <View className="flex-row rounded-xl border border-gray-300 bg-white mb-4">
          <View className="flex-1 items-center justify-center py-4 border-r border-gray-300">
            <Text className="text-[34px] font-bold text-[#111111]">12</Text>
            <Text className="mt-0.5 text-[13px] font-medium text-gray-400">Friends</Text>
          </View>
          <View className="flex-1 items-center justify-center py-4 border-r border-gray-300">
            <Text className="text-[34px] font-bold text-[#111111]">3</Text>
            <Text className="mt-0.5 text-[13px] font-medium text-gray-400">Orgs</Text>
          </View>
          <View className="flex-1 items-center justify-center py-4">
            <Text className="text-[34px] font-bold text-[#111111]">5</Text>
            <Text className="mt-0.5 text-[13px] font-medium text-gray-400">Groups</Text>
          </View>
        </View>

        <View className="rounded-xl border border-gray-300 bg-white mb-4">
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Share my location</Text>
            <View className="w-14 items-end justify-center">
              <Switch
                value={shareLocation}
                onValueChange={setShareLocation}
                trackColor={{ false: '#d1d5db', true: '#c5dde5' }}
                thumbColor={shareLocation ? '#0B617E' : '#f3f4f6'}
              />
            </View>
          </View>
          <View className="h-px bg-gray-200" />
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Event Notifications</Text>
            <View className="w-14 items-end justify-center">
              <Switch
                value={eventNotifications}
                onValueChange={setEventNotifications}
                trackColor={{ false: '#d1d5db', true: '#c5dde5' }}
                thumbColor={eventNotifications ? '#0B617E' : '#f3f4f6'}
              />
            </View>
          </View>
          <View className="h-px bg-gray-200" />
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Leave-by alerts</Text>
            <View className="w-14 items-end justify-center">
              <Switch
                value={leaveByAlerts}
                onValueChange={setLeaveByAlerts}
                trackColor={{ false: '#d1d5db', true: '#c5dde5' }}
                thumbColor={leaveByAlerts ? '#0B617E' : '#f3f4f6'}
              />
            </View>
          </View>
        </View>

        <Text className="text-[13px] text-gray-400 font-bold mb-2 mt-1" style={{ letterSpacing: 0.8 }}>
          INTEGRATIONS
        </Text>
        <View className="rounded-xl border border-gray-300 bg-white mb-4">
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Campus</Text>
            <Text className="text-[17px] font-semibold text-gray-400">UT Austin</Text>
          </View>
        </View>

        <Text className="text-[13px] text-gray-400 font-bold mb-2 mt-1" style={{ letterSpacing: 0.8 }}>
          DISPLAY
        </Text>
        <View className="rounded-xl border border-gray-300 bg-white mb-4">
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Appearance</Text>
            <Text className="text-[17px] font-semibold text-gray-400">Light</Text>
          </View>
          <View className="h-px bg-gray-200" />
          <View className="min-h-[58px] px-3.5 flex-row items-center justify-between">
            <Text className="text-[17px] font-semibold text-[#111111] flex-1 pr-3">Map Style</Text>
            <Text className="text-[17px] font-semibold text-gray-400">Default</Text>
          </View>
        </View>

        <TouchableOpacity
          className="self-end bg-[#eed46a] rounded-[10px] border border-[#d1b956] px-5 py-2.5 mt-1.5"
          onPress={handleSignOut}
        >
          <Text className="text-base font-semibold text-gray-800">Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
