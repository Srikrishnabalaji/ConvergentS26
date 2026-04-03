import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';

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

    setGroupStats({
      friendGroups,
      campusOrgs,
      totalGroups: memberRows.length,
    });
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={PRIMARY} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerBlock}>
          <View>
            <Text style={styles.pageTitle}>Settings</Text>
            <Text style={styles.pageSubtitle}>Account and preferences</Text>
          </View>
        </View>

        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={2}>
              {displayName}
            </Text>
            <Text style={styles.profileMeta}>UT Austin</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Your communities</Text>
        <View style={styles.statsRow}>
          <View style={[styles.statCell, styles.statCellBorder]}>
            {statsLoading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <>
                <Text style={styles.statNumber}>{groupStats.friendGroups}</Text>
                <Text style={styles.statCaption}>Friend groups</Text>
              </>
            )}
          </View>
          <View style={[styles.statCell, styles.statCellBorder]}>
            {statsLoading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <>
                <Text style={styles.statNumber}>{groupStats.campusOrgs}</Text>
                <Text style={styles.statCaption}>Campus orgs</Text>
              </>
            )}
          </View>
          <View style={styles.statCell}>
            {statsLoading ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <>
                <Text style={styles.statNumber}>{groupStats.totalGroups}</Text>
                <Text style={styles.statCaption}>All groups</Text>
              </>
            )}
          </View>
        </View>

        <Text style={styles.sectionLabel}>Notifications</Text>
        <View style={styles.card}>
          <RowSwitch
            label="Share my location"
            value={shareLocation}
            onValueChange={setShareLocation}
          />
          <View style={styles.hairline} />
          <RowSwitch
            label="Event notifications"
            value={eventNotifications}
            onValueChange={setEventNotifications}
          />
          <View style={styles.hairline} />
          <RowSwitch
            label="Leave-by alerts"
            value={leaveByAlerts}
            onValueChange={setLeaveByAlerts}
          />
        </View>

        <Text style={styles.sectionLabel}>Integrations</Text>
        <View style={styles.card}>
          <View style={styles.rowStatic}>
            <Text style={styles.rowLabel}>Campus</Text>
            <Text style={styles.rowValue}>UT Austin</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Display</Text>
        <View style={styles.card}>
          <View style={styles.rowStatic}>
            <Text style={styles.rowLabel}>Appearance</Text>
            <Text style={styles.rowValue}>Light</Text>
          </View>
          <View style={styles.hairline} />
          <View style={styles.rowStatic}>
            <Text style={styles.rowLabel}>Map style</Text>
            <Text style={styles.rowValue}>Default</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.85}>
          <MaterialIcons name="logout" size={20} color="#b91c1c" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
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
    <View style={styles.switchRow}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.switchSlot}>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scroll: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7f9',
  },
  headerBlock: {
    marginBottom: 20,
  },
  pageTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: PRIMARY,
    letterSpacing: -0.5,
  },
  pageSubtitle: {
    marginTop: 4,
    fontSize: 14,
    color: '#64748b',
    maxWidth: 280,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    padding: 14,
    marginBottom: 20,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  profileMeta: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: '#94a3b8',
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    marginBottom: 20,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    minHeight: 88,
  },
  statCellBorder: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#e8eef2',
  },
  statNumber: {
    fontSize: 26,
    fontWeight: '700',
    color: PRIMARY,
    marginBottom: 4,
  },
  statCaption: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e8eef2',
    marginBottom: 16,
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#f1f5f9',
    marginLeft: 14,
  },
  switchRow: {
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switchSlot: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowStatic: {
    minHeight: 54,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    flex: 1,
    paddingRight: 12,
  },
  rowValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#94a3b8',
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 8,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#b91c1c',
  },
});
