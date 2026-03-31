import React, { useMemo, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { router } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

type Friend = {
  id: string;
  name: string;
  subtitle: string;
};

const ADDED_ME_MOCK: Friend[] = [
  { id: 'a1', name: 'Maya Patel', subtitle: 'Biology - Freshman' },
  { id: 'a2', name: 'Jordan Lee', subtitle: 'Computer Science' },
  { id: 'a3', name: 'Sofia Nguyen', subtitle: 'Architecture - Junior' },
];

const FIND_FRIENDS_MOCK: Friend[] = [
  { id: 'f1', name: 'Ethan Kim', subtitle: 'Math - Freshman' },
  { id: 'f2', name: 'Ava Johnson', subtitle: 'Economics - Sophomore' },
  { id: 'f3', name: 'Noah Smith', subtitle: 'ECE - Junior' },
  { id: 'f4', name: 'Liam Brown', subtitle: 'Journalism - Senior' },
  { id: 'f5', name: 'Chloe Garcia', subtitle: 'Business - Freshman' },
];

const MY_FRIENDS_MOCK: Friend[] = [
  { id: 'm1', name: 'Olivia Chen', subtitle: 'Design - Sophomore' },
  { id: 'm2', name: 'Daniel Cruz', subtitle: 'ECE - Freshman' },
  { id: 'm3', name: 'Priya Raman', subtitle: 'Public Health - Junior' },
];

type FriendsTab = 'my_friends' | 'added_me' | 'find_friends';

export default function FriendsScreen() {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FriendsTab>('my_friends');
  const [addedMe, setAddedMe] = useState(ADDED_ME_MOCK);
  const [myFriends] = useState(MY_FRIENDS_MOCK);
  const [findFriends, setFindFriends] = useState(FIND_FRIENDS_MOCK);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  const normalizedSearch = search.trim().toLowerCase();
  const filteredAddedMe = useMemo(
    () =>
      addedMe.filter(
        (f) =>
          f.name.toLowerCase().includes(normalizedSearch) ||
          f.subtitle.toLowerCase().includes(normalizedSearch)
      ),
    [addedMe, normalizedSearch]
  );
  const filteredFindFriends = useMemo(
    () =>
      findFriends.filter(
        (f) =>
          f.name.toLowerCase().includes(normalizedSearch) ||
          f.subtitle.toLowerCase().includes(normalizedSearch)
      ),
    [findFriends, normalizedSearch]
  );
  const filteredMyFriends = useMemo(
    () =>
      myFriends.filter(
        (f) =>
          f.name.toLowerCase().includes(normalizedSearch) ||
          f.subtitle.toLowerCase().includes(normalizedSearch)
      ),
    [myFriends, normalizedSearch]
  );

  function initials(name: string) {
    const parts = name.split(' ').filter(Boolean);
    if (!parts.length) return 'U';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }

  function handleAccept(id: string) {
    setAddedMe((prev) => prev.filter((friend) => friend.id !== id));
  }

  function handleDismiss(id: string) {
    setAddedMe((prev) => prev.filter((friend) => friend.id !== id));
  }

  function handleAddFriend(id: string) {
    setAddedIds((prev) => new Set([...Array.from(prev), id]));
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Friends</Text>
          <TouchableOpacity style={styles.backButton} onPress={() => router.push('/(tabs)/myGroups' as never)}>
            <MaterialIcons name="chevron-right" size={26} color="#007C6E" />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <MaterialIcons name="search" size={20} color="#9ca3af" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search friends..."
            placeholderTextColor="#9ca3af"
            style={styles.searchInput}
          />
        </View>

        <View style={styles.inviteBanner}>
          <MaterialIcons name="mail-outline" size={20} color="#007C6E" />
          <Text style={styles.inviteBannerText}>Invite your friends!</Text>
          <TouchableOpacity style={styles.inviteButton}>
            <Text style={styles.inviteButtonText}>Invite</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.tabsWrap}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'my_friends' && styles.tabButtonActive]}
            onPress={() => setActiveTab('my_friends')}
          >
            <Text style={[styles.tabButtonText, activeTab === 'my_friends' && styles.tabButtonTextActive]}>
              My Friends
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'added_me' && styles.tabButtonActive]}
            onPress={() => setActiveTab('added_me')}
          >
            <Text style={[styles.tabButtonText, activeTab === 'added_me' && styles.tabButtonTextActive]}>
              Added me
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'find_friends' && styles.tabButtonActive]}
            onPress={() => setActiveTab('find_friends')}
          >
            <Text style={[styles.tabButtonText, activeTab === 'find_friends' && styles.tabButtonTextActive]}>
              Find friends
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'my_friends' && (
          <>
            <Text style={styles.sectionTitle}>MY FRIENDS</Text>
            {filteredMyFriends.map((friend) => (
              <View key={friend.id} style={styles.friendCard}>
                <View style={styles.friendLeft}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(friend.name)}</Text>
                  </View>
                  <View>
                    <Text style={styles.friendName}>{friend.name}</Text>
                    <Text style={styles.friendSubtitle}>{friend.subtitle}</Text>
                  </View>
                </View>
              </View>
            ))}
            {filteredMyFriends.length === 0 && <Text style={styles.emptyText}>No matching friends found.</Text>}
          </>
        )}

        {activeTab === 'added_me' && (
          <>
            <Text style={styles.sectionTitle}>ADDED ME</Text>
            {filteredAddedMe.map((friend) => (
              <View key={friend.id} style={styles.friendCard}>
                <View style={styles.friendLeft}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(friend.name)}</Text>
                  </View>
                  <View>
                    <Text style={styles.friendName}>{friend.name}</Text>
                    <Text style={styles.friendSubtitle}>{friend.subtitle}</Text>
                  </View>
                </View>
                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.acceptButton} onPress={() => handleAccept(friend.id)}>
                    <Text style={styles.acceptText}>Accept</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.dismissButton} onPress={() => handleDismiss(friend.id)}>
                    <MaterialIcons name="close" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {filteredAddedMe.length === 0 && <Text style={styles.emptyText}>No pending requests.</Text>}
          </>
        )}

        {activeTab === 'find_friends' && (
          <>
            <Text style={styles.sectionTitle}>FIND FRIENDS</Text>
            {filteredFindFriends.map((friend) => {
              const isAdded = addedIds.has(friend.id);
              return (
                <View key={friend.id} style={styles.friendCard}>
                  <View style={styles.friendLeft}>
                    <View style={styles.avatarMuted}>
                      <Text style={styles.avatarMutedText}>{initials(friend.name)}</Text>
                    </View>
                    <View>
                      <Text style={styles.friendName}>{friend.name}</Text>
                      <Text style={styles.friendSubtitle}>{friend.subtitle}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={[styles.addButton, isAdded && styles.addedButton]}
                    onPress={() => handleAddFriend(friend.id)}
                    disabled={isAdded}
                  >
                    <Text style={[styles.addButtonText, isAdded && styles.addedButtonText]}>
                      {isAdded ? 'Added' : 'Add'}
                    </Text>
                  </TouchableOpacity>
                </View>
              );
            })}
            {filteredFindFriends.length === 0 && <Text style={styles.emptyText}>No matching friends found.</Text>}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 14,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f3f4f6',
  },
  headerTitle: { fontSize: 34, fontWeight: '700', color: '#007C6E' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    backgroundColor: '#f9fafb',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 12,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, color: '#111827' },
  inviteBanner: {
    backgroundColor: '#e6f2f0',
    borderWidth: 1,
    borderColor: '#c7e3de',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
  },
  inviteBannerText: { marginLeft: 8, flex: 1, fontSize: 16, fontWeight: '600', color: '#065f57' },
  inviteButton: {
    backgroundColor: '#007C6E',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  inviteButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  tabsWrap: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 10,
    padding: 2,
    marginBottom: 14,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
  },
  tabButtonText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },
  tabButtonTextActive: {
    color: '#007C6E',
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#111111',
    marginBottom: 8,
    marginTop: 2,
  },
  friendCard: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
  },
  friendLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#007C6E',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  avatarMuted: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarMutedText: { color: '#374151', fontWeight: '700', fontSize: 14 },
  friendName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  friendSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 1 },
  actionsRow: { flexDirection: 'row', alignItems: 'center' },
  acceptButton: {
    backgroundColor: '#007C6E',
    borderRadius: 8,
    width: 68,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  acceptText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  dismissButton: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    width: 76,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: { color: '#007C6E', fontWeight: '600', fontSize: 13 },
  addedButton: { backgroundColor: '#f3f4f6' },
  addedButtonText: { color: '#9ca3af' },
  emptyText: { color: '#9ca3af', fontSize: 14, marginBottom: 14, fontStyle: 'italic' },
});
