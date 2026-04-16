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
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { Avatar, Card, Hairline, PageShell, SectionLabel } from '@/components/ui';

const PRIMARY = '#0B617E';

type GroupStats = {
  friendGroups: number;
  campusOrgs: number;
  totalGroups: number;
};

export default function SettingsScreen() {
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [displayName, setDisplayName] = useState('User');
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
      <PageShell hideBanner contentClassName="bg-surface-muted items-center justify-center">
        <ActivityIndicator size="large" color={PRIMARY} />
      </PageShell>
    );
  }

  return (
    <PageShell title="Settings">
      <ScrollView
        className="flex-1"
        contentContainerClassName="px-5 pt-5 pb-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Card className="flex-row items-center p-3.5 mb-5">
          <Avatar name={displayName} size="xl" className="mr-3.5" />
          <View className="flex-1 min-w-0">
            <Text className="text-xl font-bold text-ink" numberOfLines={2}>
              {displayName}
            </Text>
            <Text className="mt-1 text-[13px] font-medium text-ink-dim">UT Austin</Text>
          </View>
        </Card>

        <SectionLabel>Your communities</SectionLabel>
        <Card className="flex-row mb-5">
          <StatCell value={groupStats.friendGroups} label="Friend groups" loading={statsLoading} withBorder />
          <StatCell value={groupStats.campusOrgs} label="Campus orgs" loading={statsLoading} withBorder />
          <StatCell value={groupStats.totalGroups} label="All groups" loading={statsLoading} />
        </Card>

        <SectionLabel>Notifications</SectionLabel>
        <Card className="mb-4">
          <RowSwitch label="Share my location" value={shareLocation} onValueChange={setShareLocation} />
          <Hairline />
          <RowSwitch label="Event notifications" value={eventNotifications} onValueChange={setEventNotifications} />
          <Hairline />
          <RowSwitch label="Leave-by alerts" value={leaveByAlerts} onValueChange={setLeaveByAlerts} />
        </Card>

        <SectionLabel>Integrations</SectionLabel>
        <Card className="mb-4">
          <Row label="Campus" value="UT Austin" />
        </Card>

        <SectionLabel>Display</SectionLabel>
        <Card className="mb-4">
          <Row label="Appearance" value="Light" />
          <Hairline />
          <Row label="Map style" value="Default" />
        </Card>

        <TouchableOpacity
          onPress={handleSignOut}
          activeOpacity={0.85}
          className="flex-row items-center justify-center self-stretch mt-2 py-3.5 rounded-xl bg-white border border-danger-border"
        >
          <MaterialIcons name="logout" size={20} color="#b91c1c" style={{ marginRight: 8 }} />
          <Text className="text-base font-bold text-danger-strong">Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </PageShell>
  );
}

function StatCell({
  value,
  label,
  loading,
  withBorder,
}: {
  value: number;
  label: string;
  loading: boolean;
  withBorder?: boolean;
}) {
  return (
    <View
      className="flex-1 items-center justify-center py-4 min-h-[88px]"
      style={withBorder ? { borderRightWidth: 0.5, borderRightColor: '#e8eef2' } : undefined}
    >
      {loading ? (
        <ActivityIndicator color={PRIMARY} />
      ) : (
        <>
          <Text className="text-[26px] font-bold text-primary mb-1">{value}</Text>
          <Text className="text-[11px] font-semibold text-ink-subtle text-center px-1">{label}</Text>
        </>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-[54px] px-3.5 flex-row items-center justify-between">
      <Text className="text-base font-semibold text-ink-body flex-1 pr-3">{label}</Text>
      <Text className="text-[15px] font-semibold text-ink-dim">{value}</Text>
    </View>
  );
}

function RowSwitch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="min-h-[54px] px-3.5 flex-row items-center justify-between">
      <Text className="text-base font-semibold text-ink-body flex-1 pr-3">{label}</Text>
      <View className="w-[52px] items-center justify-center">
        <Switch
          value={value}
          onValueChange={onValueChange}
          trackColor={switchTrackColors}
          thumbColor={switchThumbColor(value, PRIMARY)}
          ios_backgroundColor={switchTrackColors.false}
        />
      </View>
    </View>
  );
}
