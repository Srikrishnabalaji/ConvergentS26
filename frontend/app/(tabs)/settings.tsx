import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { Hairline, PageShell } from '@/components/ui';
import { shadows } from '@/constants/shadows';
import { initialsFromName } from '@/lib/utils';

const PRIMARY = '#0B617E';

// Vibrant accent palette (matches Groups Rebrand design)
const ACCENT = {
  teal: '#0B617E',
  aqua: '#2A8AA5',
  sand: '#C08A5E',
  amber: '#D89E3A',
  coral: '#D26A4A',
  rose: '#C95F76',
  plum: '#8B5470',
  olive: '#7A8740',
};

const CLAY = '#B85A38';
const CLAY_RING = 'rgba(184, 90, 56, 0.25)';

type GroupStats = {
  friendGroups: number;
  campusOrgs: number;
  totalGroups: number;
};

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [displayName, setDisplayName] = useState('User');
  const [email, setEmail] = useState<string>('');
  const [groupStats, setGroupStats] = useState<GroupStats>({
    friendGroups: 0,
    campusOrgs: 0,
    totalGroups: 0,
  });
  const [shareLocation, setShareLocation] = useState(true);
  const [eventNotifications, setEventNotifications] = useState(true);
  const [leaveByAlerts, setLeaveByAlerts] = useState(true);

  const loadProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setDisplayName('User');
      setEmail('');
      return;
    }
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle();

    const name =
      (profile?.full_name && profile.full_name.trim()) ||
      (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
      (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
      user.email?.split('@')[0] ||
      'User';
    setDisplayName(name);
    setEmail(user.email ?? '');
  }, []);

  const loadGroupStats = useCallback(async () => {
    setStatsLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setGroupStats({ friendGroups: 0, campusOrgs: 0, totalGroups: 0 });
      setStatsLoading(false);
      return;
    }

    const { data: memberRows, error: memErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id);

    if (memErr || !memberRows?.length) {
      setGroupStats({ friendGroups: 0, campusOrgs: 0, totalGroups: 0 });
      setStatsLoading(false);
      return;
    }

    const ids = memberRows.map((r) => r.group_id);
    const { data: groupRows, error: gErr } = await supabase
      .from('groups')
      .select('id, type')
      .in('id', ids);

    if (gErr || !groupRows) {
      setGroupStats({
        friendGroups: 0,
        campusOrgs: 0,
        totalGroups: memberRows.length,
      });
      setStatsLoading(false);
      return;
    }

    let friendGroups = 0;
    let campusOrgs = 0;
    for (const g of groupRows) {
      if (g.type === 'friends') friendGroups += 1;
      else if (g.type === 'campus_org') campusOrgs += 1;
    }

    setGroupStats({ friendGroups, campusOrgs, totalGroups: memberRows.length });
    setStatsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadProfile();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProfile]);

  useFocusEffect(
    useCallback(() => {
      loadGroupStats();
    }, [loadGroupStats])
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  }

  if (loading) {
    return (
      <PageShell hideBanner safeAreaClassName="bg-canvas" contentClassName="bg-canvas items-center justify-center">
        <ActivityIndicator size="large" color={PRIMARY} />
      </PageShell>
    );
  }

  return (
    <PageShell hideBanner safeAreaClassName="bg-canvas" contentClassName="bg-canvas">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-4 pt-6 pb-32"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Flat header */}
        <View className="px-1 mb-4">
          <Text className="text-[36px] font-bold text-ink-strong tracking-[-1.2px] leading-[36px] mb-2">
            Settings
          </Text>
          <Text className="text-[13.5px] font-medium text-ink-subtle" numberOfLines={1}>
            UT Austin
          </Text>
        </View>

        {/* Profile card */}
        <View className="flex-row items-center p-4 mb-1 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <View
            style={{ backgroundColor: ACCENT.teal }}
            className="w-16 h-16 rounded-[20px] items-center justify-center mr-3.5"
          >
            <Text className="text-white text-[22px] font-bold tracking-[-0.5px]">
              {initialsFromName(displayName)}
            </Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-[20px] font-bold text-ink-strong tracking-[-0.5px] mb-0.5" numberOfLines={2}>
              {displayName}
            </Text>
            {email ? (
              <Text className="text-[13px] font-medium text-ink-subtle" numberOfLines={1}>
                {email}
              </Text>
            ) : null}
          </View>
        </View>

        <SLabel>Your communities</SLabel>
        <View className="flex-row mb-1 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <StatCell
            icon="people"
            iconBg={ACCENT.coral}
            value={groupStats.friendGroups}
            label="Friend groups"
            loading={statsLoading}
            withBorder
          />
          <StatCell
            icon="school"
            iconBg={ACCENT.plum}
            value={groupStats.campusOrgs}
            label="Campus orgs"
            loading={statsLoading}
            withBorder
          />
          <StatCell
            icon="event"
            iconBg={ACCENT.aqua}
            value={groupStats.totalGroups}
            label="All groups"
            loading={statsLoading}
          />
        </View>

        <SLabel>Privacy</SLabel>
        <View className="mb-1 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <RowSwitch
            icon="place"
            iconBg={ACCENT.olive}
            label="Share my location"
            sub="Friends can see your pin when you drop one"
            value={shareLocation}
            onValueChange={setShareLocation}
          />
        </View>

        <SLabel>Notifications</SLabel>
        <View className="mb-1 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <RowSwitch
            icon="notifications"
            iconBg={ACCENT.amber}
            label="Event reminders"
            sub="Push before your scheduled events"
            value={eventNotifications}
            onValueChange={setEventNotifications}
          />
          <Hairline />
          <RowSwitch
            icon="schedule"
            iconBg={ACCENT.coral}
            label="Leave-by alerts"
            sub="When it's time to head out based on walking time"
            value={leaveByAlerts}
            onValueChange={setLeaveByAlerts}
          />
        </View>

        <SLabel>Display</SLabel>
        <View className="mb-1 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <Row icon="map" iconBg={ACCENT.sand} label="Map style" value="Default" />
          <Hairline />
          <Row icon="school" iconBg={ACCENT.teal} label="Campus" value="UT Austin" />
        </View>

        <SLabel>About</SLabel>
        <View className="mb-5 bg-white rounded-[18px] overflow-hidden" style={shadows.card}>
          <Row icon="mail-outline" iconBg={ACCENT.rose} label="Support" />
          <Hairline />
          <Row icon="auto-awesome" iconBg={ACCENT.amber} label="What's new" />
          <Hairline />
          <Row icon="lock-outline" iconBg={ACCENT.olive} label="Privacy policy" />
        </View>

        {/* Sign out */}
        <TouchableOpacity
          onPress={handleSignOut}
          activeOpacity={0.85}
          style={{ borderColor: CLAY_RING }}
          className="flex-row items-center justify-center mt-1 py-3.5 rounded-2xl bg-white border"
        >
          <MaterialIcons name="logout" size={18} color={CLAY} style={{ marginRight: 8 }} />
          <Text style={{ color: CLAY }} className="text-[14.5px] font-semibold">
            Sign out
          </Text>
        </TouchableOpacity>

        <Text className="text-center text-[11.5px] text-ink-dim font-medium mt-3">
          {`Wavepoint · v${Constants.expoConfig?.version ?? '0.0.0'}`}
        </Text>
      </ScrollView>
    </PageShell>
  );
}

function SLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{ color: PRIMARY }}
      className="text-[12px] font-semibold uppercase tracking-[1.2px] mt-5 mb-2.5 px-1"
    >
      {children}
    </Text>
  );
}

function StatCell({
  icon,
  iconBg,
  value,
  label,
  loading,
  withBorder,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  iconBg: string;
  value: number;
  label: string;
  loading: boolean;
  withBorder?: boolean;
}) {
  return (
    <View
      className="flex-1 items-center justify-center py-4 px-2"
      style={withBorder ? { borderRightWidth: 1, borderRightColor: '#F0EDE5' } : undefined}
    >
      <View
        style={{ backgroundColor: iconBg }}
        className="w-8 h-8 rounded-[10px] items-center justify-center mb-2"
      >
        <MaterialIcons name={icon} size={15} color="#fff" />
      </View>
      {loading ? (
        <ActivityIndicator color={PRIMARY} />
      ) : (
        <>
          <Text className="text-[22px] font-bold text-ink-strong tracking-[-0.5px] leading-[22px] mb-1">
            {value}
          </Text>
          <Text className="text-[11px] font-semibold text-ink-subtle text-center" numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </View>
  );
}

function Row({
  icon,
  iconBg,
  label,
  value,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  iconBg: string;
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  const inner = (
    <View className="min-h-[54px] px-3.5 flex-row items-center gap-3">
      <View
        style={{ backgroundColor: iconBg }}
        className="w-[30px] h-[30px] rounded-lg items-center justify-center"
      >
        <MaterialIcons name={icon} size={15} color="#fff" />
      </View>
      <Text className="text-[14.5px] font-medium text-ink-strong flex-1 pr-2" numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text className="text-[13.5px] font-medium text-ink-subtle" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <MaterialIcons name="chevron-right" size={18} color="#C7C1B6" />
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

function RowSwitch({
  icon,
  iconBg,
  label,
  sub,
  value,
  onValueChange,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  iconBg: string;
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="min-h-[54px] px-3.5 py-3 flex-row items-center gap-3">
      <View
        style={{ backgroundColor: iconBg }}
        className="w-[30px] h-[30px] rounded-lg items-center justify-center"
      >
        <MaterialIcons name={icon} size={15} color="#fff" />
      </View>
      <View className="flex-1 min-w-0 pr-2">
        <Text className="text-[14.5px] font-medium text-ink-strong" numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text className="text-[12px] font-medium text-ink-subtle mt-0.5" numberOfLines={2}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={switchTrackColors}
        thumbColor={switchThumbColor(value, PRIMARY)}
        ios_backgroundColor={switchTrackColors.false}
      />
    </View>
  );
}
