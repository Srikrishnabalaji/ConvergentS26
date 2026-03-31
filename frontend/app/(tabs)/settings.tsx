import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, SafeAreaView, StyleSheet, Switch, ActivityIndicator, ScrollView } from 'react-native';
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
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007C6E" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <View style={styles.profileTextWrap}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.subtitle}>UT Austin</Text>
          </View>
        </View>

        <View style={styles.statsCard}>
          <View style={[styles.statCell, styles.statDivider]}>
            <Text style={styles.statValue}>12</Text>
            <Text style={styles.statLabel}>Friends</Text>
          </View>
          <View style={[styles.statCell, styles.statDivider]}>
            <Text style={styles.statValue}>3</Text>
            <Text style={styles.statLabel}>Orgs</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statValue}>5</Text>
            <Text style={styles.statLabel}>Groups</Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Share my location</Text>
            <View style={styles.switchWrap}>
              <Switch
                value={shareLocation}
                onValueChange={setShareLocation}
                trackColor={{ false: '#d1d5db', true: '#b8dfd9' }}
                thumbColor={shareLocation ? '#007C6E' : '#f3f4f6'}
              />
            </View>
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Event Notifications</Text>
            <View style={styles.switchWrap}>
              <Switch
                value={eventNotifications}
                onValueChange={setEventNotifications}
                trackColor={{ false: '#d1d5db', true: '#b8dfd9' }}
                thumbColor={eventNotifications ? '#007C6E' : '#f3f4f6'}
              />
            </View>
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Leave-by alerts</Text>
            <View style={styles.switchWrap}>
              <Switch
                value={leaveByAlerts}
                onValueChange={setLeaveByAlerts}
                trackColor={{ false: '#d1d5db', true: '#b8dfd9' }}
                thumbColor={leaveByAlerts ? '#007C6E' : '#f3f4f6'}
              />
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>INTEGRATIONS</Text>
        <View style={styles.card}>
        
          <View style={styles.rowDivider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Campus</Text>
            <Text style={styles.rowValue}>UT Austin</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>DISPLAY</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Appearance</Text>
            <Text style={styles.rowValue}>Light</Text>
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Map Style</Text>
            <Text style={styles.rowValue}>Default</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 40,
  },
  headerTitle: {
    fontSize: 34,
    fontWeight: '700',
    color: '#007C6E',
    marginBottom: 16,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#007C6E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '700',
  },
  profileTextWrap: {
    flex: 1,
  },
  name: {
    fontSize: 34,
    fontWeight: '700',
    color: '#111111',
  },
  subtitle: {
    marginTop: 2,
    color: '#9ca3af',
    fontSize: 15,
    fontWeight: '600',
  },
  statsCard: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    marginBottom: 16,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  statDivider: {
    borderRightWidth: 1,
    borderRightColor: '#d1d5db',
  },
  statValue: {
    fontSize: 34,
    fontWeight: '700',
    color: '#111111',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: '600',
    color: '#9ca3af',
  },
  sectionTitle: {
    fontSize: 14,
    color: '#9ca3af',
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 4,
  },
  card: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#ffffff',
    marginBottom: 16,
  },
  row: {
    minHeight: 58,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowDivider: {
    height: 1,
    backgroundColor: '#e5e7eb',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
    flex: 1,
    paddingRight: 12,
  },
  switchWrap: {
    width: 56,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  rowValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9ca3af',
  },
  connectedText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#66a572',
  },
  logoutButton: {
    alignSelf: 'flex-end',
    backgroundColor: '#eed46a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#d1b956',
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 6,
  },
  logoutText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1f2937',
  },
});
