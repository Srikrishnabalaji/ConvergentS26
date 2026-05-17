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
  PageShell,
  SearchInput,
  SegmentedTabs,
  type SegmentedOption,
} from '@/components/ui';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

const PRIMARY = '#0B617E';
const SECONDARY = '#C08A5E';
const SECONDARY_DEEP = '#9F6E45';
const SECONDARY_SOFT = 'rgba(192, 138, 94, 0.10)';
const SECONDARY_RING = 'rgba(192, 138, 94, 0.22)';
const CLAY = '#B85A38';
const OLIVE = '#7A8740';
const OLIVE_DEEP = '#5C6A2E';
const OLIVE_SOFT = 'rgba(122, 135, 64, 0.12)';

const ACCENT_TILES = [
  '#0B617E', '#2A8AA5', '#C08A5E', '#D89E3A',
  '#D26A4A', '#C95F76', '#8B5470', '#7A8740',
];
function accentForId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return ACCENT_TILES[Math.abs(hash) % ACCENT_TILES.length];
}

function initialsFromName(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

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
  const [pinShareSearch, setPinShareSearch] = useState('');

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

      // Routed through a SECURITY DEFINER RPC instead of a direct profiles
      // select so the frontend doesn't depend on broad profile SELECT policies.
      const { data } = await supabase.rpc('search_profiles', { p_query: trimmed });

      const raw = (data ?? []) as { id: string; full_name: string | null }[];
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
    setPinShareSearch('');
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
    <PageShell hideBanner safeAreaClassName="bg-canvas" contentClassName="bg-canvas">
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
          <View className="mb-4">
            {pinSelectedIds.size > 0 && (
              <View className="flex-row flex-wrap gap-1.5 mb-2">
                {myFriends
                  .filter((f) => pinSelectedIds.has(f.id))
                  .map((friend) => (
                    <TouchableOpacity
                      key={friend.id}
                      onPress={() => togglePinSelection(friend.id)}
                      className="flex-row items-center bg-primary-soft rounded-full pl-2.5 pr-2 py-1 gap-1"
                      activeOpacity={0.7}
                    >
                      <Text className="text-[13px] font-semibold text-primary">{friend.name}</Text>
                      <MaterialIcons name="close" size={14} color="#0B617E" />
                    </TouchableOpacity>
                  ))}
              </View>
            )}

            <TextInput
              className="border border-line-muted rounded-[10px] px-3.5 py-2.5 text-[14px] text-ink-strong bg-surface-alt"
              placeholder="Search friends to share with…"
              placeholderTextColor="#9ca3af"
              value={pinShareSearch}
              onChangeText={setPinShareSearch}
            />

            {pinShareSearch.trim().length > 0 && (
              <View className="mt-1.5 border border-line-muted rounded-xl bg-white overflow-hidden">
                {myFriends
                  .filter(
                    (f) =>
                      !pinSelectedIds.has(f.id) &&
                      f.name.toLowerCase().includes(pinShareSearch.trim().toLowerCase())
                  )
                  .slice(0, 6)
                  .map((friend) => (
                    <TouchableOpacity
                      key={friend.id}
                      className="flex-row items-center py-2.5 px-3.5 border-b border-line-muted"
                      onPress={() => {
                        togglePinSelection(friend.id);
                        setPinShareSearch('');
                      }}
                      activeOpacity={0.7}
                    >
                      <Avatar name={friend.name} size="sm" tone="neutral" className="mr-2.5" />
                      <Text className="flex-1 text-[14px] font-medium text-ink-strong">
                        {friend.name}
                      </Text>
                      <MaterialIcons name="add-circle-outline" size={20} color="#0B617E" />
                    </TouchableOpacity>
                  ))}
                {myFriends.filter(
                  (f) =>
                    !pinSelectedIds.has(f.id) &&
                    f.name.toLowerCase().includes(pinShareSearch.trim().toLowerCase())
                ).length === 0 && (
                  <Text className="text-[13px] italic text-ink-faint px-3.5 py-2.5">
                    No matching friends.
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        <TouchableOpacity
          onPress={clearPin}
          className="flex-row items-center justify-center bg-danger-bgAlt py-3.5 rounded-xl mt-2 mb-2 border border-danger-borderAlt"
        >
          <Text className="text-base font-semibold text-danger">Clear Pin</Text>
        </TouchableOpacity>

        <View
          className="flex-row pt-3 border-t border-line-faint"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <TouchableOpacity
            onPress={() => setPinModalVisible(false)}
            className="flex-1 py-3.5 rounded-xl bg-surface-raised items-center mr-2"
          >
            <Text className="text-base font-semibold text-ink-subtle">Cancel</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={savePin}
            disabled={pinSaving}
            className="flex-1 py-3.5 rounded-xl bg-primary items-center ml-2"
          >
            <Text className="text-base font-bold text-white">Save</Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      <ScrollView
        contentContainerClassName="px-4 pt-6 pb-32"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Flat header */}
        <View className="px-1 mb-5 flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-[36px] font-bold text-ink-strong tracking-[-1.2px] leading-[36px] mb-2">
              Friends
            </Text>
            <Text className="text-[13.5px] font-medium text-ink-subtle" numberOfLines={1}>
              {myFriends.length} friends ·{' '}
              {addedMe.length > 0 ? (
                <Text style={{ color: SECONDARY, fontWeight: '600' }}>
                  {addedMe.length} new request{addedMe.length === 1 ? '' : 's'}
                </Text>
              ) : (
                'no new requests'
              )}
            </Text>
          </View>
          <TouchableOpacity
            onPress={openPinModal}
            activeOpacity={0.85}
            accessibilityLabel="Drop pin"
            style={[shadows.primaryGlow, { backgroundColor: PRIMARY }]}
            className="flex-row items-center rounded-[12px] px-3.5 py-2.5 gap-1.5 mt-1"
          >
            <MaterialIcons name="add-location-alt" size={16} color="#fff" />
            <Text className="text-white text-[13px] font-semibold">Drop pin</Text>
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
          containerClassName="mb-2"
        />

        {/* Sand invite banner — only on My Friends tab */}
        {activeTab === 'my_friends' && (
          <View
            style={{ backgroundColor: SECONDARY_SOFT, borderColor: SECONDARY_RING }}
            className="flex-row items-center gap-3 rounded-2xl p-3 mt-3 mb-1 border"
          >
            <View
              style={{ backgroundColor: SECONDARY }}
              className="w-[38px] h-[38px] rounded-[10px] items-center justify-center"
            >
              <MaterialIcons name="mail-outline" size={18} color="#fff" />
            </View>
            <View className="flex-1 min-w-0">
              <Text className="text-[14px] font-semibold text-ink-strong" numberOfLines={1}>
                Bring your people over
              </Text>
              <Text className="text-[12px] font-medium text-ink-subtle" numberOfLines={1}>
                Send an invite link
              </Text>
            </View>
            <TouchableOpacity
              style={{ borderColor: SECONDARY_RING }}
              className="bg-white border rounded-[10px] px-3 py-1.5"
              activeOpacity={0.8}
            >
              <Text style={{ color: SECONDARY_DEEP }} className="text-[12.5px] font-semibold">
                Invite
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {loading && <ActivityIndicator color="#0B617E" className="mt-6" />}

        {!loading && activeTab === 'my_friends' && (
          <>
            {(() => {
              const onCampus = filteredMyFriends.filter(
                (f) => canSeeIds.has(f.id) && !!f.location_building
              );
              const others = filteredMyFriends.filter(
                (f) => !(canSeeIds.has(f.id) && !!f.location_building)
              );
              return (
                <>
                  <SectionHeading count={onCampus.length}>On campus now</SectionHeading>
                  {onCampus.length === 0 ? (
                    <EmptyLine text="No friends have shared their pin yet." />
                  ) : (
                    onCampus.map((friend) => {
                      const iSharedWithThem = sharedWithIds.has(friend.id);
                      return (
                        <FriendRow
                          key={friend.id}
                          id={friend.id}
                          name={friend.name}
                          details={
                            <>
                              <TouchableOpacity
                                onPress={() => routeToFriend(friend)}
                                activeOpacity={0.7}
                                style={{ backgroundColor: OLIVE_SOFT }}
                                className="flex-row items-center self-start gap-1 px-2 py-[3px] rounded-lg mt-1"
                              >
                                <MaterialIcons name="place" size={11} color={OLIVE_DEEP} />
                                <Text style={{ color: OLIVE_DEEP }} className="text-[11.5px] font-semibold">
                                  {friend.location_building}
                                  {friend.location_room ? ` · ${friend.location_room}` : ''}
                                </Text>
                                <MaterialIcons name="chevron-right" size={11} color={OLIVE_DEEP} />
                              </TouchableOpacity>
                              {iSharedWithThem && (
                                <View className="flex-row items-center gap-1 mt-1">
                                  <MaterialIcons name="my-location" size={10} color={PRIMARY} />
                                  <Text style={{ color: PRIMARY }} className="text-[11px] font-semibold">
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
                              style={{
                                backgroundColor: 'rgba(220, 90, 60, 0.08)',
                                borderColor: 'rgba(220, 90, 60, 0.18)',
                              }}
                              className="w-9 h-9 rounded-[10px] border items-center justify-center ml-1"
                            >
                              <MaterialIcons name="delete-outline" size={16} color={CLAY} />
                            </TouchableOpacity>
                          }
                        />
                      );
                    })
                  )}

                  <SectionHeading count={others.length}>Other friends</SectionHeading>
                  {others.length === 0 ? (
                    <EmptyLine
                      text={
                        search.trim()
                          ? `No friends matching "${search.trim()}".`
                          : 'No friends yet. Open Find Friends to search for people.'
                      }
                    />
                  ) : (
                    others.map((friend) => {
                      const iSharedWithThem = sharedWithIds.has(friend.id);
                      return (
                        <FriendRow
                          key={friend.id}
                          id={friend.id}
                          name={friend.name}
                          subtitle="No location shared"
                          details={
                            iSharedWithThem ? (
                              <View className="flex-row items-center gap-1 mt-1">
                                <MaterialIcons name="my-location" size={10} color={PRIMARY} />
                                <Text style={{ color: PRIMARY }} className="text-[11px] font-semibold">
                                  {"You're sharing your pin"}
                                </Text>
                              </View>
                            ) : null
                          }
                          right={
                            <TouchableOpacity
                              onPress={() => confirmRemoveFriend(friend)}
                              accessibilityLabel={`Remove ${friend.name} from friends`}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              style={{
                                backgroundColor: 'rgba(220, 90, 60, 0.08)',
                                borderColor: 'rgba(220, 90, 60, 0.18)',
                              }}
                              className="w-9 h-9 rounded-[10px] border items-center justify-center ml-1"
                            >
                              <MaterialIcons name="delete-outline" size={16} color={CLAY} />
                            </TouchableOpacity>
                          }
                        />
                      );
                    })
                  )}
                </>
              );
            })()}
          </>
        )}

        {!loading && activeTab === 'added_me' && (
          <>
            <SectionHeading count={filteredAddedMe.length} sub="People who want to be friends">
              Incoming
            </SectionHeading>
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
                  id={friend.id}
                  name={friend.name}
                  subtitle="Wants to be your friend"
                  right={
                    <View className="flex-row items-center gap-1.5">
                      <TouchableOpacity
                        onPress={() => handleDismiss(friend.id)}
                        className="bg-canvas-soft rounded-[10px] w-9 h-9 items-center justify-center"
                      >
                        <MaterialIcons name="close" size={15} color="#6B6660" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleAccept(friend.id)}
                        style={{ backgroundColor: PRIMARY }}
                        className="flex-row items-center rounded-[10px] px-3 h-9 gap-1"
                      >
                        <MaterialIcons name="check" size={13} color="#fff" />
                        <Text className="text-white font-semibold text-[13px]">Accept</Text>
                      </TouchableOpacity>
                    </View>
                  }
                />
              ))
            )}

            <SectionHeading count={filteredPendingOutgoing.length} sub="Waiting for them to accept">
              Outgoing
            </SectionHeading>
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
                  id={friend.id}
                  name={friend.name}
                  subtitle="Request pending"
                  right={
                    <TouchableOpacity
                      onPress={() => handleCancelOutgoingRequest(friend)}
                      className="bg-canvas-soft rounded-[10px] px-3 py-2"
                    >
                      <Text className="text-ink-subtle font-semibold text-[12.5px]">Cancel</Text>
                    </TouchableOpacity>
                  }
                />
              ))
            )}
          </>
        )}

        {!loading && activeTab === 'find_friends' && (
          <>
            {findLoading ? (
              <ActivityIndicator color={PRIMARY} className="mt-6" />
            ) : !search.trim() ? (
              <View className="bg-white rounded-[18px] py-8 px-5 mt-4 items-center" style={shadows.card}>
                <View
                  style={{ backgroundColor: 'rgba(11, 97, 126, 0.08)' }}
                  className="w-14 h-14 rounded-[16px] items-center justify-center mb-3"
                >
                  <MaterialIcons name="search" size={22} color={PRIMARY} />
                </View>
                <Text className="text-[15px] font-semibold text-ink-strong mb-1">
                  Find people you know
                </Text>
                <Text className="text-[13px] text-ink-subtle text-center leading-[19px] max-w-[240px]">
                  Type a name above to search for friends to add.
                </Text>
              </View>
            ) : findFriends.length === 0 ? (
              findSearchRawCount > 0 ? (
                <EmptyLine
                  text={`Everyone matching "${search.trim()}" is already a friend or has a pending request.`}
                />
              ) : (
                <EmptyLine text={`No users found for "${search.trim()}".`} />
              )
            ) : (
              <>
                <SectionHeading count={findFriends.length}>
                  {`Results for "${search.trim()}"`}
                </SectionHeading>
                {findFriends.map((friend) => {
                  const isAdded = addedIds.has(friend.id);
                  return (
                    <FriendRow
                      key={friend.id}
                      id={friend.id}
                      name={friend.name}
                      subtitle="Wavepoint user"
                      right={
                        isAdded ? (
                          <View className="bg-canvas-soft rounded-[10px] px-3 py-2">
                            <Text className="text-ink-subtle font-semibold text-[12.5px]">
                              Requested
                            </Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() => handleAddFriend(friend.id)}
                            style={{
                              backgroundColor: 'rgba(11, 97, 126, 0.08)',
                              borderColor: 'rgba(11, 97, 126, 0.20)',
                            }}
                            className="flex-row items-center gap-1 border rounded-[10px] px-3 py-2"
                          >
                            <MaterialIcons name="person-add-alt" size={13} color={PRIMARY} />
                            <Text style={{ color: PRIMARY }} className="font-semibold text-[12.5px]">
                              Add
                            </Text>
                          </TouchableOpacity>
                        )
                      }
                  />
                );
              })}
              </>
            )}
          </>
        )}
      </ScrollView>
    </PageShell>
  );
}

function FriendRow({
  id,
  name,
  subtitle,
  details,
  right,
  avatarTone = 'primary',
}: {
  id?: string;
  name: string;
  subtitle?: string;
  details?: React.ReactNode;
  right?: React.ReactNode;
  avatarTone?: 'primary' | 'neutral';
}) {
  const tileColor = id ? accentForId(id) : (avatarTone === 'neutral' ? '#9A9389' : PRIMARY);
  return (
    <View
      style={shadows.card}
      className="rounded-[18px] px-3.5 py-3 mb-2 flex-row items-center bg-white"
    >
      <View
        style={{ backgroundColor: tileColor }}
        className="w-[46px] h-[46px] rounded-[14px] items-center justify-center mr-3"
      >
        <Text className="text-white text-[15px] font-bold tracking-[-0.5px]">
          {initialsFromName(name)}
        </Text>
      </View>
      <View className="flex-1 min-w-0 pr-2">
        <Text className="text-[15.5px] font-semibold text-ink-strong tracking-[-0.2px]" numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text className="text-[12.5px] text-ink-subtle font-medium mt-0.5" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {details}
      </View>
      {right}
    </View>
  );
}

function SectionHeading({
  children,
  count,
  sub,
  className,
}: {
  children: React.ReactNode;
  count?: number;
  sub?: string;
  className?: string;
}) {
  return (
    <View className={cn('mt-5 mb-2.5', className)}>
      <View className="flex-row items-center gap-2">
        <Text
          style={{ color: PRIMARY }}
          className="text-[12px] font-semibold uppercase tracking-[1.2px]"
        >
          {children}
        </Text>
        {typeof count === 'number' ? (
          <View
            style={{ backgroundColor: 'rgba(11, 97, 126, 0.10)' }}
            className="px-[7px] py-[2px] rounded-lg"
          >
            <Text style={{ color: PRIMARY }} className="text-[11px] font-bold">
              {count}
            </Text>
          </View>
        ) : null}
      </View>
      {sub ? (
        <Text className="text-[12.5px] font-medium text-ink-dim mt-1">{sub}</Text>
      ) : null}
    </View>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <View className="bg-white rounded-2xl py-5 px-4 items-center">
      <Text className="text-ink-subtle text-[13.5px] text-center font-medium">{text}</Text>
    </View>
  );
}