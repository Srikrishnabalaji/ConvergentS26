import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, Modal, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { parseLocationString, UT_BUILDINGS } from '@/lib/data/utBuildings';
import { supabase } from '../../lib/supabase';
import { geocodeSearch } from '@/lib/services/geocoding';
import { DEFAULT_USER_LOCATION } from '@/constants/map';
import { searchRooms } from '@/lib/services/indoor-navigation';
import gdcGraphData from '@/assets/gdc_graph.json';
import type { BuildingGraph } from '@/lib/services/indoor-navigation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Friend = {
  id: string;
  name: string;
  location_building?: string;
  location_room?: string;
};

type FriendsTab = 'my_friends' | 'added_me' | 'find_friends';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function initials(name: string) {
  const parts = (name || '').split(' ').filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}



// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function FriendsScreen() {
  const [search, setSearch]           = useState('');
  const [activeTab, setActiveTab]     = useState<FriendsTab>('my_friends');
  const [loading, setLoading]         = useState(true);

  const [myFriends, setMyFriends]     = useState<Friend[]>([]);
  const [addedMe, setAddedMe]         = useState<Friend[]>([]);
  const [findFriends, setFindFriends] = useState<Friend[]>([]);
  const [addedIds, setAddedIds]       = useState<Set<string>>(new Set());
  // Tracks existing friends/pending so find-friends search can exclude them
  const [knownIds, setKnownIds]       = useState<Set<string>>(new Set());
  const [findLoading, setFindLoading] = useState(false);

  // IDs of friends I am currently sharing MY pin with
  const [sharedWithIds, setSharedWithIds] = useState<Set<string>>(new Set());
  // IDs of friends whose pins I am allowed to see (they shared with me)
  const [canSeeIds, setCanSeeIds]     = useState<Set<string>>(new Set());

  // Navigate to map tab — mirrors the calendar deep-link pattern exactly
  function routeToFriend(friend: Friend) {
    if (!friend.location_building) return;
    const locationString = friend.location_room
      ? `${friend.location_building} - ${friend.location_room}`
      : friend.location_building;
    const { building, room } = parseLocationString(locationString);
    router.push({
      pathname: '/(tabs)/map',
      params: {
        searchQuery: building || friend.location_building,
        ...(room ? { roomQuery: room } : {}),
        calNav: String(Date.now()),
      },
    });
  }

  // Pin-drop modal
  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinBuilding, setPinBuilding] = useState('');
  const [pinRoom, setPinRoom]         = useState('');
  const [pinSaving, setPinSaving]     = useState(false);
  // Which friends are toggled on in the pin-drop modal
  const [pinSelectedIds, setPinSelectedIds] = useState<Set<string>>(new Set());

  const [pinBuildingSuggestions, setPinBuildingSuggestions] = useState<any[]>([]);
  const [pinBuildingSearching, setPinBuildingSearching] = useState(false);
  const [pinRoomSuggestions, setPinRoomSuggestions] = useState<any[]>([]);
  const pinBuildingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // -------------------------------------------------------------------------
  // Fetch everything
  // -------------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    try {
      // -- Accepted friends (both directions) --------------------------------
      const { data: sentAccepted } = await supabase
        .from('friends')
        .select('friend_id, profiles!friend_id(id, full_name, location_building, location_room)')
        .eq('user_id', user.id)
        .eq('status', 'accepted');

      const { data: receivedAccepted } = await supabase
        .from('friends')
        .select('user_id, profiles!user_id(id, full_name, location_building, location_room)')
        .eq('friend_id', user.id)
        .eq('status', 'accepted');

      const toFriend = (p: any): Friend => ({
        id: p.id,
        name: p.full_name ?? 'Unknown',
        location_building: p.location_building,
        location_room: p.location_room,
      });

      const allFriends: Friend[] = [
        ...(sentAccepted ?? []).map((r: any) => toFriend(r.profiles)),
        ...(receivedAccepted ?? []).map((r: any) => toFriend(r.profiles)),
      ];
      setMyFriends(allFriends);

      // -- Who I'm currently sharing MY pin with -----------------------------
      const { data: myShares } = await supabase
        .from('location_shares')
        .select('viewer_id')
        .eq('owner_id', user.id);

      const sharedSet = new Set<string>((myShares ?? []).map((r: any) => r.viewer_id));
      setSharedWithIds(sharedSet);
      setPinSelectedIds(new Set(sharedSet)); // pre-fill modal to current state

      // -- Whose pins I can see (they shared with me) ------------------------
      const { data: visibleToMe } = await supabase
        .from('location_shares')
        .select('owner_id')
        .eq('viewer_id', user.id);

      setCanSeeIds(new Set<string>((visibleToMe ?? []).map((r: any) => r.owner_id)));

      // -- Pending requests sent TO me ---------------------------------------
      const { data: pendingToMe } = await supabase
        .from('friends')
        .select('user_id, profiles!user_id(id, full_name)')
        .eq('friend_id', user.id)
        .eq('status', 'pending');

      setAddedMe((pendingToMe ?? []).map((item: any) => ({
        id: item.profiles.id,
        name: item.profiles.full_name ?? 'Unknown',
      })));

      // -- Find friends: just build the knownIds set here; actual search is query-driven --
      const knownIds = new Set<string>([
        ...(sentAccepted ?? []).map((f: any) => f.profiles.id),
        ...(receivedAccepted ?? []).map((f: any) => f.profiles.id),
        ...(pendingToMe ?? []).map((f: any) => f.profiles.id),
      ]);

      const { data: pendingSent } = await supabase
        .from('friends')
        .select('friend_id')
        .eq('user_id', user.id)
        .eq('status', 'pending');

      (pendingSent ?? []).forEach((r: any) => knownIds.add(r.friend_id));
      
      setKnownIds(knownIds);
      knownIdsRef.current = knownIds;
      setAddedIds(new Set((pendingSent ?? []).map((r: any) => r.friend_id)));
      // Clear stale find-friends results whenever relationships change
      //setFindFriends([]);

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // -------------------------------------------------------------------------
  // Live search for find-friends tab — queries Supabase on every keystroke
  // -------------------------------------------------------------------------
  const findDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (activeTab !== 'find_friends') return;

    const trimmed = search.trim();

    // Show nothing until the user starts typing
    if (!trimmed) {
      setFindFriends([]);
      setFindLoading(false);
      return;
    }

    setFindLoading(true);
    if (findDebounceRef.current) clearTimeout(findDebounceRef.current);

    findDebounceRef.current = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setFindLoading(false); return; }

      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .neq('id', user.id)
        .ilike('full_name', `%${trimmed}%`)
        .limit(30);

      setFindFriends(
        (data ?? [])
          //.filter((u: any) => !knownIds.has(u.id))
          .filter((u: any) => !knownIdsRef.current.has(u.id))
          .map((u: any) => ({ id: u.id, name: u.full_name ?? 'Unknown' }))
      );
      setFindLoading(false);
    }, 400);

    return () => {
      if (findDebounceRef.current) clearTimeout(findDebounceRef.current);
    };
  }, [search, activeTab]);

  // -------------------------------------------------------------------------
  // Search filtering
  // -------------------------------------------------------------------------
  const q = search.trim().toLowerCase();
  const filteredMyFriends = useMemo(() => myFriends.filter(f => f.name.toLowerCase().includes(q)), [myFriends, q]);
  const filteredAddedMe   = useMemo(() => addedMe.filter(f   => f.name.toLowerCase().includes(q)), [addedMe, q]);
  // findFriends is already filtered server-side by the live search effect

  // -------------------------------------------------------------------------
  // Friend request actions
  // -------------------------------------------------------------------------
  async function handleAccept(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const accepted = addedMe.find(f => f.id === id);
    setAddedMe(prev => prev.filter(f => f.id !== id));
    if (accepted) setMyFriends(prev => [...prev, accepted]);
    const { error } = await supabase.from('friends').update({ status: 'accepted' }).match({ user_id: id, friend_id: user.id });
    if (error) Alert.alert('Error', 'Could not accept request.');
  }

  async function handleDismiss(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setAddedMe(prev => prev.filter(f => f.id !== id));
    const { error } = await supabase.from('friends').delete().match({ user_id: id, friend_id: user.id });
    if (error) Alert.alert('Error', 'Could not decline request.');
  }

  async function handleAddFriend(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setAddedIds(prev => new Set([...prev, id]));
    const { error } = await supabase.from('friends').insert({ user_id: user.id, friend_id: id, status: 'pending' });
    if (error) {
      setAddedIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      Alert.alert('Error', 'Could not send friend request.');
    }
  }


  function handlePinBuildingChange(text: string) {
    setPinBuilding(text);
    setPinRoom('');
    setPinRoomSuggestions([]);

    if (!text.trim()) {
      setPinBuildingSuggestions([]);
      setPinBuildingSearching(false);
      return;
    }

    const q = text.trim().toLowerCase();
    const utMatches = UT_BUILDINGS.filter(b =>
      b.code.toLowerCase().startsWith(q) ||
      b.displayName.toLowerCase().includes(q) ||
      b.fullName.toLowerCase().includes(q) ||
      (b.aliases ?? []).some(a => a.startsWith(q))
    ).slice(0, 6);

    if (utMatches.length > 0) {
      setPinBuildingSuggestions(
        utMatches.map(b => ({ id: b.code, name: b.code, address: b.displayName }))
      );
      setPinBuildingSearching(false);
    } else {
      setPinBuildingSuggestions([]);
      setPinBuildingSearching(true);
      if (pinBuildingDebounceRef.current) clearTimeout(pinBuildingDebounceRef.current);
      pinBuildingDebounceRef.current = setTimeout(async () => {
        try {
          const results = await geocodeSearch(text, DEFAULT_USER_LOCATION);
          setPinBuildingSuggestions(results);
        } catch {
          setPinBuildingSuggestions([]);
        } finally {
          setPinBuildingSearching(false);
        }
      }, 400);
    }
  }

  function handlePinRoomChange(text: string) {
    setPinRoom(text);
    setPinRoomSuggestions([]);
    if (!text.trim()) return;
    const results = searchRooms(gdcGraphData as BuildingGraph, text);
    setPinRoomSuggestions(results.slice(0, 5));
  }

  // -------------------------------------------------------------------------
  // Pin drop
  // -------------------------------------------------------------------------
  function openPinModal() {
    // Always reset selection to match current sharing state
    setPinSelectedIds(new Set(sharedWithIds));
    setPinModalVisible(true);
  }

  function togglePinSelection(id: string) {
    setPinSelectedIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function savePin() {
    if (!pinBuilding.trim()) {
      Alert.alert('Missing', 'Please enter a building name.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setPinSaving(true);

    try {
      // 1. Save pin to my profile
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ location_building: pinBuilding.trim(), location_room: pinRoom.trim() })
        .eq('id', user.id);
      if (profileErr) throw profileErr;

      // 2. Replace all my location_shares with the new selection
      await supabase.from('location_shares').delete().eq('owner_id', user.id);

      if (pinSelectedIds.size > 0) {
        const rows = Array.from(pinSelectedIds).map(viewer_id => ({ owner_id: user.id, viewer_id }));
        const { error: shareErr } = await supabase.from('location_shares').insert(rows);
        if (shareErr) throw shareErr;
      }

      setSharedWithIds(new Set(pinSelectedIds));
      setPinModalVisible(false);
      fetchAll();
    } catch (err) {
      Alert.alert('Error', 'Could not save pin.');
      console.error(err);
    } finally {
      setPinSaving(false);
    }
  }

  async function clearPin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('profiles').update({ location_building: null, location_room: null }).eq('id', user.id);
    await supabase.from('location_shares').delete().eq('owner_id', user.id);
    setSharedWithIds(new Set());
    setPinSelectedIds(new Set());
    setPinBuilding('');
    setPinRoom('');
    setPinModalVisible(false);
    fetchAll();
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>


      {/* ── Pin-drop modal ──────────────────────────────────────────── */}
      <Modal visible={pinModalVisible} animationType="slide" transparent onRequestClose={() => setPinModalVisible(false)}>
        <View style={styles.pinOverlay}>
          <View style={styles.pinSheet}>
            <Text style={styles.pinSheetTitle}>Drop Your Pin</Text>
            <Text style={styles.pinSheetSub}>Set your location and choose who can see it.</Text>

            <Text style={styles.pinLabel}>Building</Text>
            <TextInput
              style={styles.pinInput}
              placeholder="e.g. GDC, PCL, ECJ..."
              placeholderTextColor="#9ca3af"
              value={pinBuilding}
              onChangeText={handlePinBuildingChange}
            />
            {pinBuildingSearching && (
              <Text style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>Searching...</Text>
            )}
            {pinBuildingSuggestions.length > 0 && (
              <View style={styles.pinSuggestionList}>
                {pinBuildingSuggestions.map((item: any) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.pinSuggestionRow}
                    onPress={() => {
                      if (pinBuildingDebounceRef.current) clearTimeout(pinBuildingDebounceRef.current);
                      setPinBuilding(item.name);
                      setPinBuildingSuggestions([]);
                      setPinBuildingSearching(false);
                    }}
                  >
                    <MaterialIcons name="location-on" size={14} color="#0B617E" style={{ marginRight: 6 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pinSuggestionText} numberOfLines={1}>{item.name}</Text>
                      {item.address ? (
                        <Text style={{ fontSize: 11, color: '#6b7280' }} numberOfLines={1}>{item.address}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={styles.pinLabel}>Room</Text>
            <TextInput
              style={[styles.pinInput, !pinBuilding.trim() && { opacity: 0.5 }]}
              placeholder="e.g. 2.216, 0132..."
              placeholderTextColor="#9ca3af"
              value={pinRoom}
              onChangeText={handlePinRoomChange}
              editable={!!pinBuilding.trim()}
            />
            {pinRoomSuggestions.length > 0 && (
              <View style={styles.pinSuggestionList}>
                {pinBuildingSuggestions.map((item: any) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.pinSuggestionRow}
                    onPress={() => {
                      if (pinBuildingDebounceRef.current) clearTimeout(pinBuildingDebounceRef.current);
                      setPinBuilding(item.name);
                      setPinBuildingSuggestions([]);
                      setPinBuildingSearching(false);
                    }}
                  >
                    <MaterialIcons name="location-on" size={16} color="#0B617E" style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.pinSuggestionText} numberOfLines={1}>{item.name}</Text>
                      {item.address ? (
                        <Text style={styles.pinSuggestionAddress} numberOfLines={1}>{item.address}</Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* ── Friend selector ── */}
            <Text style={styles.pinLabel}>Share with</Text>
            {myFriends.length === 0 ? (
              <Text style={styles.pinNoFriendsText}>You have no friends to share with yet.</Text>
            ) : (
              <ScrollView style={styles.pinFriendList} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {myFriends.map(friend => {
                  const selected = pinSelectedIds.has(friend.id);
                  return (
                    <TouchableOpacity
                      key={friend.id}
                      style={[styles.pinFriendRow, selected && styles.pinFriendRowSelected]}
                      onPress={() => togglePinSelection(friend.id)}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.pinAvatar, selected && styles.pinAvatarSelected]}>
                        <Text style={styles.pinAvatarText}>{initials(friend.name)}</Text>
                      </View>
                      <Text style={[styles.pinFriendName, selected && styles.pinFriendNameSelected]}>
                        {friend.name}
                      </Text>
                      <MaterialIcons
                        name={selected ? 'check-circle' : 'radio-button-unchecked'}
                        size={22}
                        color={selected ? '#0B617E' : '#d1d5db'}
                      />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.pinSaveBtn} onPress={savePin} disabled={pinSaving}>
              {pinSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.pinSaveBtnText}>
                  {pinSelectedIds.size > 0
                    ? `Save · share with ${pinSelectedIds.size} friend${pinSelectedIds.size > 1 ? 's' : ''}`
                    : 'Save · only visible to you'}
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.pinClearBtn} onPress={clearPin}>
              <Text style={styles.pinClearBtnText}>Clear My Location</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setPinModalVisible(false)} style={styles.pinCancelBtn}>
              <Text style={styles.pinCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <View style={styles.banner}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Friends</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.iconBtn} onPress={openPinModal}>
              <MaterialIcons name="add-location" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.contentContainer}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
          <MaterialIcons name="mail-outline" size={20} color="#0B617E" />
          <Text style={styles.inviteBannerText}>Invite your friends!</Text>
          <TouchableOpacity style={styles.inviteButton}>
            <Text style={styles.inviteButtonText}>Invite</Text>
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabsWrap}>
          {(['my_friends', 'added_me', 'find_friends'] as FriendsTab[]).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, activeTab === tab && styles.tabButtonActive]}
              //onPress={() => setActiveTab(tab)}
              onPress={() => {
                if (tab !== 'find_friends') setFindFriends([]);
                setActiveTab(tab);
              }}
            >
              <Text style={[styles.tabButtonText, activeTab === tab && styles.tabButtonTextActive]}>
                {tab === 'my_friends' ? 'My Friends' : tab === 'added_me' ? 'Added me' : 'Find friends'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading && <ActivityIndicator color="#0B617E" style={{ marginTop: 24 }} />}

        {/* ── MY FRIENDS ── */}
        {!loading && activeTab === 'my_friends' && (
          <>
            <Text style={styles.sectionTitle}>MY FRIENDS</Text>
            {filteredMyFriends.map(friend => {
              const canSee = canSeeIds.has(friend.id) && !!friend.location_building;
              const iSharedWithThem = sharedWithIds.has(friend.id);

              return (
                <View key={friend.id} style={styles.friendCard}>
                  <View style={styles.friendLeft}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials(friend.name)}</Text>
                    </View>
                    <View style={styles.friendDetails}>
                      <Text style={styles.friendName}>{friend.name}</Text>

                      {/* Their location — tapping routes via the map tab */}
                      {canSee ? (
                        <TouchableOpacity
                          style={styles.locationBadge}
                          onPress={() => routeToFriend(friend)}
                          activeOpacity={0.7}
                        >
                          <MaterialIcons name="location-pin" size={14} color="#059669" />
                          <Text style={styles.locationText}>
                            {friend.location_building}{friend.location_room ? ` - ${friend.location_room}` : ''}
                          </Text>
                          <MaterialIcons name="chevron-right" size={13} color="#059669" />
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.friendSubtitle}>No location shared</Text>
                      )}

                      {/* Indicator that I'm sharing my pin with them */}
                      {iSharedWithThem && (
                        <View style={styles.sharingBadge}>
                          <MaterialIcons name="my-location" size={11} color="#0B617E" />
                          <Text style={styles.sharingBadgeText}>You're sharing your pin</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
            {filteredMyFriends.length === 0 && (
              <Text style={styles.emptyText}>No friends yet. Find some below!</Text>
            )}
          </>
        )}

        {/* ── ADDED ME ── */}
        {!loading && activeTab === 'added_me' && (
          <>
            <Text style={styles.sectionTitle}>ADDED ME</Text>
            {filteredAddedMe.map(friend => (
              <View key={friend.id} style={styles.friendCard}>
                <View style={styles.friendLeft}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(friend.name)}</Text>
                  </View>
                  <View>
                    <Text style={styles.friendName}>{friend.name}</Text>
                    <Text style={styles.friendSubtitle}>Wants to be your friend</Text>
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

        {/* ── FIND FRIENDS ── */}
        {!loading && activeTab === 'find_friends' && (
          <>
            <Text style={styles.sectionTitle}>FIND FRIENDS</Text>
            {findLoading ? (
              <ActivityIndicator color="#0B617E" style={{ marginTop: 16 }} />
            ) : !search.trim() ? (
              <Text style={styles.emptyText}>Type a name above to search all users.</Text>
            ) : findFriends.length === 0 ? (
              <Text style={styles.emptyText}>No users found for "{search.trim()}".</Text>
            ) : (
              findFriends.map(friend => {
                const isAdded = addedIds.has(friend.id);
                return (
                  <View key={friend.id} style={styles.friendCard}>
                    <View style={styles.friendLeft}>
                      <View style={styles.avatarMuted}>
                        <Text style={styles.avatarMutedText}>{initials(friend.name)}</Text>
                      </View>
                      <View>
                        <Text style={styles.friendName}>{friend.name}</Text>
                        <Text style={styles.friendSubtitle}>App user</Text>
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
              })
            )}
          </>
        )}
      </ScrollView>
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B617E' },
  banner: { backgroundColor: '#0B617E', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 10, shadowColor: '#04303f', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 8, zIndex: 1 },
  contentContainer: { flex: 1, backgroundColor: '#f5f7f9' },
  scrollContent: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 40 },

  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerTitle: { fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, backgroundColor: '#f9fafb', paddingHorizontal: 12, height: 48, marginBottom: 12 },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 16, color: '#111827' },

  inviteBanner: { backgroundColor: '#CEDFE5', borderWidth: 1, borderColor: '#c7e3de', borderRadius: 12, padding: 12, flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  inviteBannerText: { marginLeft: 8, flex: 1, fontSize: 16, fontWeight: '600', color: '#065f57' },
  inviteButton: { backgroundColor: '#0B617E', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  inviteButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },

  tabsWrap: { flexDirection: 'row', backgroundColor: '#e5e7eb', borderRadius: 10, padding: 2, marginBottom: 14 },
  tabButton: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabButtonActive: { backgroundColor: '#ffffff' },
  tabButtonText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  tabButtonTextActive: { color: '#0B617E', fontWeight: '700' },

  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.8, color: '#111111', marginBottom: 8, marginTop: 2 },

  friendCard: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff' },
  friendLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  friendDetails: { flex: 1, paddingRight: 4 },

  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#0B617E', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  avatarMuted: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarMutedText: { color: '#374151', fontWeight: '700', fontSize: 14 },

  friendName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  friendSubtitle: { fontSize: 13, color: '#9ca3af', marginTop: 1 },

  locationBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ecfdf5', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 6, marginTop: 4, alignSelf: 'flex-start' },
  locationText: { fontSize: 12, color: '#059669', marginLeft: 2, fontWeight: '500' },

  sharingBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 3 },
  sharingBadgeText: { fontSize: 11, color: '#0B617E', fontWeight: '500' },

  actionsRow: { flexDirection: 'row', alignItems: 'center' },
  acceptButton: { backgroundColor: '#0B617E', borderRadius: 8, width: 68, height: 34, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  acceptText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  dismissButton: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 8, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  addButton: { borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#ffffff', borderRadius: 8, width: 76, height: 36, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#0B617E', fontWeight: '600', fontSize: 13 },
  addedButton: { backgroundColor: '#f3f4f6' },
  addedButtonText: { color: '#9ca3af' },

  emptyText: { color: '#9ca3af', fontSize: 14, marginBottom: 14, fontStyle: 'italic' },


  // Pin-drop modal
  pinOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pinSheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36, maxHeight: '85%' },
  pinSheetTitle: { fontSize: 20, fontWeight: '700', color: '#0B617E', marginBottom: 4 },
  pinSheetSub: { fontSize: 13, color: '#6b7280', marginBottom: 20 },
  pinLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 4 },
  pinInput: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#111827', backgroundColor: '#f9fafb', marginBottom: 14 },

  pinFriendList: { maxHeight: 180, marginBottom: 16 },
  pinFriendRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, marginBottom: 4, backgroundColor: '#f9fafb' },
  pinFriendRowSelected: { backgroundColor: '#EBF4F8' },
  pinAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  pinAvatarSelected: { backgroundColor: '#0B617E' },
  pinAvatarText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  pinFriendName: { flex: 1, fontSize: 15, color: '#374151', fontWeight: '500' },
  pinFriendNameSelected: { color: '#0B617E', fontWeight: '600' },
  pinNoFriendsText: { fontSize: 13, color: '#9ca3af', fontStyle: 'italic', marginBottom: 16 },

  pinSaveBtn: { backgroundColor: '#0B617E', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  pinSaveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  pinClearBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 6 },
  pinClearBtnText: { color: '#6b7280', fontWeight: '600', fontSize: 14 },
  pinCancelBtn: { marginTop: 8, alignItems: 'center' },
  pinCancelText: { color: '#6b7280', fontSize: 14 },

  pinSuggestionList: { marginTop: -10, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12, backgroundColor: '#fff', marginBottom: 14, overflow: 'hidden' },
  pinSuggestionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#d1d5db' },
  pinSuggestionText: { fontSize: 14, color: '#111827', fontWeight: '600' },
  pinSuggestionAddress: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
});