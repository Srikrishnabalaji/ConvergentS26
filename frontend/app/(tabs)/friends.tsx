import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { router } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseLocationString, UT_BUILDINGS } from '@/lib/data/utBuildings';
import { supabase } from '@/lib/supabase';
import { geocodeSearch, type SearchItem } from '@/lib/services/geocoding';
import { DEFAULT_USER_LOCATION } from '@/constants/map';
import gdcGraphData from '@/assets/gdc_graph.json';
import {
  searchRooms,
  type BuildingGraph,
  type GraphNode,
} from '@/lib/services/indoor-navigation';
import {
  Avatar,
  BottomSheet,
  Button,
  IconButton,
  PageShell,
  SearchInput,
  SegmentedTabs,
  type SegmentedOption,
} from '@/components/ui';
import { cn } from '@/lib/cn';

type Friend = {
  id: string;
  name: string;
  location_building?: string;
  location_room?: string;
};

type FriendsTab = 'my_friends' | 'added_me' | 'find_friends';

type ProfileSnippet = {
  id: string;
  full_name: string | null;
  location_building?: string | null;
  location_room?: string | null;
};

/** Supabase may type embedded relations as T | T[] depending on client inference. */
function unwrapProfile(p: unknown): ProfileSnippet | null {
  if (p == null) return null;
  const row = Array.isArray(p) ? p[0] : p;
  if (row && typeof row === 'object' && 'id' in row && typeof (row as { id: unknown }).id === 'string') {
    return row as ProfileSnippet;
  }
  return null;
}

/** Building picker in the pin modal — subset of geocoder results (no coordinates required). */
type PinBuildingSuggestion = Pick<SearchItem, 'id' | 'name' | 'address'>;

const SEARCH_PLACEHOLDERS: Record<FriendsTab, string> = {
  my_friends: 'Search your friends…',
  added_me: 'Search requests…',
  find_friends: 'Search all users…',
};

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<FriendsTab>('my_friends');
  const [loading, setLoading] = useState(true);

  const [myFriends, setMyFriends] = useState<Friend[]>([]);
  const [addedMe, setAddedMe] = useState<Friend[]>([]);
  const [pendingOutgoing, setPendingOutgoing] = useState<Friend[]>([]);
  const [findFriends, setFindFriends] = useState<Friend[]>([]);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [knownIds, setKnownIds] = useState<Set<string>>(new Set());
  const [findLoading, setFindLoading] = useState(false);
  const [findSearchRawCount, setFindSearchRawCount] = useState(0);

  const [sharedWithIds, setSharedWithIds] = useState<Set<string>>(new Set());
  const [canSeeIds, setCanSeeIds] = useState<Set<string>>(new Set());

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

  const [pinModalVisible, setPinModalVisible] = useState(false);
  const [pinBuilding, setPinBuilding] = useState('');
  const [pinRoom, setPinRoom] = useState('');
  const [pinSaving, setPinSaving] = useState(false);
  const [pinSelectedIds, setPinSelectedIds] = useState<Set<string>>(new Set());
  const [pinBuildingSuggestions, setPinBuildingSuggestions] = useState<PinBuildingSuggestion[]>([]);
  const [pinBuildingSearching, setPinBuildingSearching] = useState(false);
  const [pinRoomSuggestions, setPinRoomSuggestions] = useState<GraphNode[]>([]);
  const pinBuildingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const knownIdsRef = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      if (!silent) setLoading(false);
      return;
    }

    try {
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

      const toFriend = (p: ProfileSnippet): Friend => ({
        id: p.id,
        name: p.full_name ?? 'Unknown',
        location_building: p.location_building ?? undefined,
        location_room: p.location_room ?? undefined,
      });

      const allFriends: Friend[] = [
        ...(sentAccepted ?? [])
          .map((r) => unwrapProfile(r.profiles))
          .filter((p): p is ProfileSnippet => p != null)
          .map(toFriend),
        ...(receivedAccepted ?? [])
          .map((r) => unwrapProfile(r.profiles))
          .filter((p): p is ProfileSnippet => p != null)
          .map(toFriend),
      ];
      setMyFriends(allFriends);

      const { data: myShares } = await supabase
        .from('location_shares')
        .select('viewer_id')
        .eq('owner_id', user.id);

      const sharedSet = new Set<string>((myShares ?? []).map((r) => r.viewer_id));
      setSharedWithIds(sharedSet);
      setPinSelectedIds(new Set(sharedSet));

      const { data: visibleToMe } = await supabase
        .from('location_shares')
        .select('owner_id')
        .eq('viewer_id', user.id);

      setCanSeeIds(new Set<string>((visibleToMe ?? []).map((r) => r.owner_id)));

      const { data: pendingToMe } = await supabase
        .from('friends')
        .select('user_id, profiles!user_id(id, full_name)')
        .eq('friend_id', user.id)
        .eq('status', 'pending');

      setAddedMe(
        (pendingToMe ?? [])
          .map((item) => unwrapProfile(item.profiles))
          .filter((p): p is ProfileSnippet => p != null)
          .map((p) => ({ id: p.id, name: p.full_name ?? 'Unknown' })),
      );

      const known = new Set<string>([
        ...(sentAccepted ?? []).flatMap((f) => {
          const p = unwrapProfile(f.profiles);
          return p?.id ? [p.id] : [];
        }),
        ...(receivedAccepted ?? []).flatMap((f) => {
          const p = unwrapProfile(f.profiles);
          return p?.id ? [p.id] : [];
        }),
        ...(pendingToMe ?? []).flatMap((f) => {
          const p = unwrapProfile(f.profiles);
          return p?.id ? [p.id] : [];
        }),
      ]);

      const { data: pendingSent } = await supabase
        .from('friends')
        .select('friend_id, profiles!friend_id(id, full_name)')
        .eq('user_id', user.id)
        .eq('status', 'pending');

      (pendingSent ?? []).forEach((r) => known.add(r.friend_id));

      setPendingOutgoing(
        (pendingSent ?? []).map((r) => {
          const p = unwrapProfile(r.profiles);
          return {
            id: p?.id ?? r.friend_id,
            name: p?.full_name ?? 'Unknown',
          };
        }),
      );

      setKnownIds(known);
      knownIdsRef.current = known;
      setAddedIds(new Set((pendingSent ?? []).map((r) => r.friend_id)));
    } catch (err) {
      if (__DEV__) console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const findDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeTab !== 'find_friends') return;
    const trimmed = search.trim();
    if (!trimmed) {
      setFindFriends([]);
      setFindSearchRawCount(0);
      setFindLoading(false);
      return;
    }

    setFindLoading(true);
    if (findDebounceRef.current) clearTimeout(findDebounceRef.current);

    findDebounceRef.current = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setFindLoading(false);
        return;
      }

      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .neq('id', user.id)
        .ilike('full_name', `%${trimmed}%`)
        .limit(30);

      const raw = data ?? [];
      setFindSearchRawCount(raw.length);
      setFindFriends(
        raw
          .filter((u) => !knownIdsRef.current.has(u.id))
          .map((u) => ({ id: u.id, name: u.full_name ?? 'Unknown' })),
      );
      setFindLoading(false);
    }, 400);

    return () => {
      if (findDebounceRef.current) clearTimeout(findDebounceRef.current);
    };
  }, [search, activeTab]);

  useEffect(() => {
    if (activeTab !== 'find_friends') return;
    setFindFriends((prev) => prev.filter((u) => !knownIds.has(u.id)));
  }, [knownIds, activeTab]);

  const q = search.trim().toLowerCase();
  const filteredMyFriends = useMemo(
    () => myFriends.filter((f) => f.name.toLowerCase().includes(q)),
    [myFriends, q]
  );
  const filteredAddedMe = useMemo(
    () => addedMe.filter((f) => f.name.toLowerCase().includes(q)),
    [addedMe, q]
  );
  const filteredPendingOutgoing = useMemo(
    () => pendingOutgoing.filter((f) => f.name.toLowerCase().includes(q)),
    [pendingOutgoing, q]
  );

  async function handleAccept(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const accepted = addedMe.find((f) => f.id === id);
    setAddedMe((prev) => prev.filter((f) => f.id !== id));
    if (accepted) setMyFriends((prev) => [...prev, accepted]);
    const { error } = await supabase
      .from('friends')
      .update({ status: 'accepted' })
      .match({ user_id: id, friend_id: user.id });
    if (error) Alert.alert('Error', 'Could not accept request.');
    else void fetchAll({ silent: true });
  }

  async function handleDismiss(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setAddedMe((prev) => prev.filter((f) => f.id !== id));
    const { error } = await supabase
      .from('friends')
      .delete()
      .match({ user_id: id, friend_id: user.id });
    if (error) Alert.alert('Error', 'Could not decline request.');
    else void fetchAll({ silent: true });
  }

  async function handleAddFriend(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setAddedIds((prev) => new Set([...prev, id]));
    const { error } = await supabase
      .from('friends')
      .insert({ user_id: user.id, friend_id: id, status: 'pending' });
    if (error) {
      setAddedIds((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      Alert.alert('Error', 'Could not send friend request.');
      return;
    }
    setFindFriends((prev) => prev.filter((f) => f.id !== id));
    void fetchAll({ silent: true });
  }

  async function handleCancelOutgoingRequest(friend: Friend) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setPendingOutgoing((prev) => prev.filter((f) => f.id !== friend.id));
    setAddedIds((prev) => {
      const n = new Set(prev);
      n.delete(friend.id);
      return n;
    });
    const { error } = await supabase
      .from('friends')
      .delete()
      .match({ user_id: user.id, friend_id: friend.id });
    if (error) Alert.alert('Error', 'Could not cancel request.');
    void fetchAll({ silent: true });
  }

  function confirmRemoveFriend(friend: Friend) {
    Alert.alert(
      'Remove friend',
      `Remove ${friend.name} from your friends? Location sharing with them will stop.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void handleRemoveFriend(friend.id) },
      ]
    );
  }

  async function handleRemoveFriend(friendId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error: errA } = await supabase
      .from('friends')
      .delete()
      .match({ user_id: user.id, friend_id: friendId });
    const { error: errB } = await supabase
      .from('friends')
      .delete()
      .match({ user_id: friendId, friend_id: user.id });

    if (errA && errB) {
      Alert.alert('Error', 'Could not remove friend.');
      return;
    }

    await supabase.from('location_shares').delete().match({ owner_id: user.id, viewer_id: friendId });
    await supabase.from('location_shares').delete().match({ owner_id: friendId, viewer_id: user.id });

    void fetchAll({ silent: true });
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
    const utMatches = UT_BUILDINGS.filter(
      (b) =>
        b.code.toLowerCase().startsWith(q) ||
        b.displayName.toLowerCase().includes(q) ||
        b.fullName.toLowerCase().includes(q) ||
        (b.aliases ?? []).some((a) => a.startsWith(q))
    ).slice(0, 6);

    if (utMatches.length > 0) {
      setPinBuildingSuggestions(
        utMatches.map((b) => ({ id: b.code, name: b.code, address: b.displayName })),
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

  function openPinModal() {
    if (pinBuildingDebounceRef.current) clearTimeout(pinBuildingDebounceRef.current);
    setPinBuilding('');
    setPinRoom('');
    setPinBuildingSuggestions([]);
    setPinRoomSuggestions([]);
    setPinBuildingSearching(false);
    setPinSelectedIds(new Set(sharedWithIds));
    setPinModalVisible(true);
  }

  function togglePinSelection(id: string) {
    setPinSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
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
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ location_building: pinBuilding.trim(), location_room: pinRoom.trim() })
        .eq('id', user.id);
      if (profileErr) throw profileErr;

      await supabase.from('location_shares').delete().eq('owner_id', user.id);

      if (pinSelectedIds.size > 0) {
        const rows = Array.from(pinSelectedIds).map((viewer_id) => ({
          owner_id: user.id,
          viewer_id,
        }));
        const { error: shareErr } = await supabase.from('location_shares').insert(rows);
        if (shareErr) throw shareErr;
      }

      setSharedWithIds(new Set(pinSelectedIds));
      setPinBuilding('');
      setPinRoom('');
      setPinBuildingSuggestions([]);
      setPinRoomSuggestions([]);
      setPinModalVisible(false);
      void fetchAll({ silent: true });
    } catch (err) {
      Alert.alert('Error', 'Could not save pin.');
      if (__DEV__) console.error(err);
    } finally {
      setPinSaving(false);
    }
  }

  async function clearPin() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from('profiles')
      .update({ location_building: null, location_room: null })
      .eq('id', user.id);
    await supabase.from('location_shares').delete().eq('owner_id', user.id);
    setSharedWithIds(new Set());
    setPinSelectedIds(new Set());
    setPinBuilding('');
    setPinRoom('');
    setPinModalVisible(false);
    void fetchAll({ silent: true });
  }

  function switchTab(tab: FriendsTab) {
    if (tab !== 'find_friends') {
      setFindFriends([]);
      setFindSearchRawCount(0);
    }
    setSearch('');
    setActiveTab(tab);
  }

  const tabOptions: SegmentedOption<FriendsTab>[] = [
    { value: 'my_friends', label: 'My Friends' },
    { value: 'added_me', label: 'Requests', badge: addedMe.length },
    { value: 'find_friends', label: 'Find Friends' },
  ];

  return (
    <PageShell
      title="Friends"
      right={
        <IconButton onPress={openPinModal} accessibilityLabel="Drop pin">
          <MaterialIcons name="add-location" size={22} color="#fff" />
        </IconButton>
      }
    >
      <BottomSheet visible={pinModalVisible} onClose={() => setPinModalVisible(false)}>
        <View className="flex-row items-center mb-5">
          <Text className="text-xl font-bold text-primary">Drop Your Pin</Text>
          <TouchableOpacity
            className="ml-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => Alert.alert('Share Location', 'Set your location and choose who can see it.')}
          >
            <MaterialIcons name="info-outline" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        <Text className="text-[13px] font-semibold text-ink-body mb-1">Building</Text>
        <TextInput
          className="border border-line-muted rounded-[10px] px-3.5 py-3 text-[15px] text-ink-strong bg-surface-alt mb-3.5"
          placeholder="e.g. GDC, PCL, ECJ..."
          placeholderTextColor="#9ca3af"
          value={pinBuilding}
          onChangeText={handlePinBuildingChange}
        />
        {pinBuildingSearching && (
          <Text className="text-xs text-ink-faint mb-1">Searching...</Text>
        )}
        {pinBuildingSuggestions.length > 0 && (
          <View className="-mt-2.5 border border-line-muted rounded-xl bg-white mb-3.5 overflow-hidden">
            {pinBuildingSuggestions.map((item) => (
              <TouchableOpacity
                key={item.id}
                className="flex-row items-center py-2.5 px-3.5 border-b border-line-muted"
                onPress={() => {
                  if (pinBuildingDebounceRef.current) clearTimeout(pinBuildingDebounceRef.current);
                  setPinBuilding(item.name);
                  setPinBuildingSuggestions([]);
                  setPinBuildingSearching(false);
                }}
              >
                <MaterialIcons name="location-on" size={14} color="#0B617E" style={{ marginRight: 6 }} />
                <View className="flex-1">
                  <Text className="text-sm font-bold text-ink-strong" numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.address ? (
                    <Text className="text-[11px] text-ink-subtle" numberOfLines={1}>
                      {item.address}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text className="text-[13px] font-semibold text-ink-body mb-1">Room</Text>
        <TextInput
          className={cn(
            'border border-line-muted rounded-[10px] px-3.5 py-3 text-[15px] text-ink-strong bg-surface-alt mb-3.5',
            !pinBuilding.trim() && 'opacity-50'
          )}
          placeholder="e.g. 2.216, 0132..."
          placeholderTextColor="#9ca3af"
          value={pinRoom}
          onChangeText={handlePinRoomChange}
          editable={!!pinBuilding.trim()}
        />
        {pinRoomSuggestions.length > 0 && (
          <View className="-mt-2.5 border border-line-muted rounded-xl bg-white mb-3.5 overflow-hidden">
            {pinRoomSuggestions.map((item) => (
              <TouchableOpacity
                key={item.id}
                className="flex-row items-center py-2.5 px-3.5 border-b border-line-muted"
                onPress={() => {
                  setPinRoom(item.label);
                  setPinRoomSuggestions([]);
                }}
              >
                <MaterialIcons name="meeting-room" size={16} color="#0B617E" style={{ marginRight: 8 }} />
                <Text className="text-sm font-bold text-ink-strong" numberOfLines={1}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text className="text-[13px] font-semibold text-ink-body mb-1">Share with</Text>
        {myFriends.length === 0 ? (
          <Text className="text-[13px] italic text-ink-faint mb-4">
            You have no friends to share with yet.
          </Text>
        ) : (
          <ScrollView
            style={{ maxHeight: 180 }}
            className="mb-4"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
          >
            {myFriends.map((friend) => {
              const selected = pinSelectedIds.has(friend.id);
              return (
                <TouchableOpacity
                  key={friend.id}
                  className={cn(
                    'flex-row items-center py-2.5 px-2.5 rounded-[10px] mb-1',
                    selected ? 'bg-primary-soft' : 'bg-surface-alt'
                  )}
                  onPress={() => togglePinSelection(friend.id)}
                  activeOpacity={0.7}
                >
                  <Avatar
                    name={friend.name}
                    size="sm"
                    tone={selected ? 'primary' : 'neutral'}
                    className="mr-2.5"
                  />
                  <Text
                    className={cn(
                      'flex-1 text-[15px]',
                      selected ? 'text-primary font-semibold' : 'text-ink-body font-medium'
                    )}
                  >
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

        {/* Clean, calendar-style action buttons */}
        <View 
          className="flex-row items-center justify-between pt-4 mt-2 border-t border-line-faint"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => setPinModalVisible(false)}
              className="py-2 pr-4"
            >
              <Text className="text-[15px] font-semibold text-ink-subtle">Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              onPress={clearPin}
              className="py-2 px-4"
            >
              <Text className="text-[15px] font-semibold text-danger">Clear</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity
            onPress={savePin}
            className="bg-primary py-2.5 px-6 rounded-[10px]"
          >
            <Text className="text-[15px] font-bold text-white">Save</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <ScrollView
        contentContainerClassName="px-4 pt-4 pb-10"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center bg-primary-tint border border-primary-tint rounded-xl p-3 mb-3.5">
          <MaterialIcons name="mail-outline" size={20} color="#0B617E" />
          <Text className="ml-2 flex-1 text-[15px] font-semibold text-success-text">
            Invite your friends!
          </Text>
          <TouchableOpacity className="bg-primary rounded-lg px-3 py-1.5">
            <Text className="text-white font-semibold text-[13px]">Invite</Text>
          </TouchableOpacity>
        </View>

        <SegmentedTabs<FriendsTab>
          value={activeTab}
          onChange={switchTab}
          options={tabOptions}
          className="mb-3"
        />

        <SearchInput
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder={SEARCH_PLACEHOLDERS[activeTab]}
          containerClassName="mb-4"
        />

        {loading && <ActivityIndicator color="#0B617E" className="mt-6" />}

        {!loading && activeTab === 'my_friends' && (
          <>
            <SectionHeading>MY FRIENDS</SectionHeading>
            {filteredMyFriends.map((friend) => {
              const canSee = canSeeIds.has(friend.id) && !!friend.location_building;
              const iSharedWithThem = sharedWithIds.has(friend.id);

              return (
                <FriendRow
                  key={friend.id}
                  name={friend.name}
                  avatarTone="primary"
                  details={
                    <>
                      {canSee ? (
                        <TouchableOpacity
                          onPress={() => routeToFriend(friend)}
                          activeOpacity={0.7}
                          className="flex-row items-center bg-success-bg py-[3px] px-1.5 rounded-md mt-1 self-start"
                        >
                          <MaterialIcons name="location-pin" size={14} color="#059669" />
                          <Text className="text-xs text-success ml-0.5 font-medium">
                            {friend.location_building}
                            {friend.location_room ? ` - ${friend.location_room}` : ''}
                          </Text>
                          <MaterialIcons name="chevron-right" size={13} color="#059669" />
                        </TouchableOpacity>
                      ) : (
                        <Text className="text-[13px] text-ink-faint mt-0.5">
                          No location shared
                        </Text>
                      )}
                      {iSharedWithThem && (
                        <View className="flex-row items-center mt-1 gap-[3px]">
                          <MaterialIcons name="my-location" size={11} color="#0B617E" />
                          <Text className="text-[11px] text-primary font-medium">
                            {"You're sharing your pin"}
                          </Text>
                        </View>
                      )}
                    </>
                  }
                  right={
                    <TouchableOpacity
                      onPress={() => confirmRemoveFriend(friend)}
                      accessibilityLabel={`Remove ${friend.name} from friends`}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      className="w-10 h-10 rounded-lg bg-danger-bg border border-danger-border items-center justify-center ml-2"
                    >
                      <MaterialIcons name="person-remove" size={20} color="#ef4444" />
                    </TouchableOpacity>
                  }
                />
              );
            })}
            {filteredMyFriends.length === 0 && (
              <EmptyLine
                text={
                  search.trim()
                    ? `No friends matching "${search.trim()}".`
                    : 'No friends yet. Open the Find Friends tab to search for people by name.'
                }
              />
            )}
          </>
        )}

        {!loading && activeTab === 'added_me' && (
          <>
            <SectionHeading>INCOMING</SectionHeading>
            {filteredAddedMe.length === 0 ? (
              <EmptyLine
                text={
                  search.trim()
                    ? `No incoming requests matching "${search.trim()}".`
                    : 'No incoming requests.'
                }
              />
            ) : (
              filteredAddedMe.map((friend) => (
                <FriendRow
                  key={friend.id}
                  name={friend.name}
                  subtitle="Wants to be your friend"
                  avatarTone="primary"
                  right={
                    <View className="flex-row items-center">
                      <TouchableOpacity
                        onPress={() => handleAccept(friend.id)}
                        className="bg-primary rounded-lg w-[68px] h-[34px] items-center justify-center mr-1.5"
                      >
                        <Text className="text-white font-semibold text-[13px]">Accept</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDismiss(friend.id)}
                        className="bg-danger-bg border border-danger-border rounded-lg w-[34px] h-[34px] items-center justify-center"
                      >
                        <MaterialIcons name="close" size={18} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  }
                />
              ))
            )}

            <SectionHeading className="mt-4">OUTGOING</SectionHeading>
            {filteredPendingOutgoing.length === 0 ? (
              <EmptyLine
                text={
                  search.trim()
                    ? `No outgoing requests matching "${search.trim()}".`
                    : 'No outgoing requests.'
                }
              />
            ) : (
              filteredPendingOutgoing.map((friend) => (
                <FriendRow
                  key={friend.id}
                  name={friend.name}
                  subtitle="Request pending"
                  avatarTone="neutral"
                  right={
                    <TouchableOpacity
                      onPress={() => handleCancelOutgoingRequest(friend)}
                      className="border border-danger-border bg-danger-bgSoft rounded-lg px-3 py-2 ml-2"
                    >
                      <Text className="text-danger-strong font-semibold text-[13px]">Cancel</Text>
                    </TouchableOpacity>
                  }
                />
              ))
            )}
          </>
        )}

        {!loading && activeTab === 'find_friends' && (
          <>
            <SectionHeading>FIND FRIENDS</SectionHeading>
            {findLoading ? (
              <ActivityIndicator color="#0B617E" className="mt-4" />
            ) : !search.trim() ? (
              <EmptyLine text="Type a name in the search bar to find people." />
            ) : findFriends.length === 0 ? (
              findSearchRawCount > 0 ? (
                <Text className="text-sm text-ink-faint italic mb-3.5">
                  {`Everyone matching "${search.trim()}" is already a friend or has a pending request. Check `}
                  <Text className="font-bold text-ink-subtle">My Friends</Text>
                  {' to see people you know.'}
                </Text>
              ) : (
                <EmptyLine text={`No users found for "${search.trim()}".`} />
              )
            ) : (
              findFriends.map((friend) => {
                const isAdded = addedIds.has(friend.id);
                return (
                  <FriendRow
                    key={friend.id}
                    name={friend.name}
                    subtitle="App user"
                    avatarTone="neutral"
                    right={
                      <TouchableOpacity
                        onPress={() => handleAddFriend(friend.id)}
                        disabled={isAdded}
                        className={cn(
                          'border border-line-muted rounded-lg w-[76px] h-9 items-center justify-center',
                          isAdded ? 'bg-surface-raised' : 'bg-white'
                        )}
                      >
                        <Text
                          className={cn(
                            'font-semibold text-[13px]',
                            isAdded ? 'text-ink-faint' : 'text-primary'
                          )}
                        >
                          {isAdded ? 'Requested' : 'Add'}
                        </Text>
                      </TouchableOpacity>
                    }
                  />
                );
              })
            )}
          </>
        )}
      </ScrollView>
    </PageShell>
  );
}

function FriendRow({
  name,
  subtitle,
  details,
  right,
  avatarTone = 'primary',
}: {
  name: string;
  subtitle?: string;
  details?: React.ReactNode;
  right?: React.ReactNode;
  avatarTone?: 'primary' | 'neutral';
}) {
  return (
    <View className="border border-line-divider rounded-xl px-3 py-2.5 mb-2.5 flex-row items-center justify-between bg-white">
      <View className="flex-row items-center flex-1">
        <View className="mr-2.5">
          <Avatar name={name} tone={avatarTone} size="md" className="rounded-full" />
        </View>
        <View className="flex-1 pr-1">
          <Text className="text-[15px] font-semibold text-ink-strong">{name}</Text>
          {subtitle ? <Text className="text-[13px] text-ink-faint mt-0.5">{subtitle}</Text> : null}
          {details}
        </View>
      </View>
      {right}
    </View>
  );
}

function SectionHeading({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Text
      className={cn(
        'text-xs font-bold tracking-[0.8px] text-ink-body mb-2 mt-0.5',
        className
      )}
    >
      {children}
    </Text>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <Text className="text-ink-faint text-sm mb-3.5 italic">{text}</Text>;
}