import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import {
  Chip,
  IconButton,
  PageShell,
  SearchInput,
  SegmentedTabs,
  initialsFromName,
  type SegmentedOption,
} from '@/components/ui';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

const PRIMARY = '#0B617E';

type GroupType = 'friends' | 'campus_org';
type PanelType = 'my_groups' | 'discover';

type Group = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  type: GroupType;
  is_private: boolean;
  has_join_password: boolean;
  member_count?: number;
};

type DetailMember = {
  user_id: string;
  role: string;
  profiles: { full_name: string | null; avatar_url: string | null } | null;
};

// ---------------------------------------------------------------------------
// GroupCard
// ---------------------------------------------------------------------------

function GroupCard({
  group,
  subtitle,
  onJoin,
  joinLabel,
  joinLoading,
  canEdit,
  onEdit,
  onPress,
  onLeave,
  leaving,
  isPending,
  onCancelRequest,
  cancellingRequest,
}: {
  group: Group;
  subtitle: string;
  onJoin?: () => void;
  joinLabel?: string;
  joinLoading?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
  onPress?: () => void;
  onLeave?: () => void;
  leaving?: boolean;
  isPending?: boolean;
  onCancelRequest?: () => void;
  cancellingRequest?: boolean;
}) {
  const typeLabel = group.type === 'campus_org' ? 'Campus' : 'Friends';
  const privateLabel = group.is_private ? ' · Private' : '';
  const metaLine = `${typeLabel}${privateLabel} · ${subtitle}`;
  const effectiveJoinLabel = joinLabel ?? 'Join';

  const showJoinBtn = !!onJoin && !isPending;
  const showPendingState = isPending;
  const hasActions = (canEdit && onEdit) || onLeave || showJoinBtn || showPendingState;

  const mainContent = (
    <>
      {group.image_url ? (
        <Image source={{ uri: group.image_url }} className="w-[50px] h-[50px] rounded-[15px] mr-3.5 bg-surface-raised" />
      ) : (
        <View className="w-[50px] h-[50px] rounded-[15px] mr-3.5 bg-primary/[0.07] items-center justify-center">
          <MaterialIcons name="groups" size={22} color="#94a3b8" />
        </View>
      )}
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center mb-[3px]">
          <Text className="text-base font-semibold text-ink leading-[22px] shrink" numberOfLines={1}>
            {group.name}
          </Text>
          {group.is_private && (
            <MaterialIcons name="lock" size={13} color="#94a3b8" style={{ marginLeft: 5, marginTop: 1 }} />
          )}
          {!group.is_private && group.has_join_password && (
            <MaterialIcons name="key" size={13} color="#94a3b8" style={{ marginLeft: 5, marginTop: 1 }} />
          )}
        </View>
        <Text className="text-[13px] text-ink-subtle font-medium" numberOfLines={1}>
          {metaLine}
        </Text>
      </View>
    </>
  );

  return (
    <View style={shadows.brand} className="bg-white rounded-[18px] mb-3">
      <View className="px-4 py-3.5">
        <View className="flex-row items-center">
          {onPress ? (
            <TouchableOpacity
              className="flex-1 flex-row items-center min-w-0 mr-2"
              onPress={onPress}
              activeOpacity={0.72}
            >
              {mainContent}
            </TouchableOpacity>
          ) : (
            <View className="flex-1 flex-row items-center min-w-0 mr-2">{mainContent}</View>
          )}

          {hasActions && (
            <View className="flex-row items-center shrink-0 self-center gap-1.5">
              {canEdit && onEdit && (
                <TouchableOpacity
                  onPress={onEdit}
                  activeOpacity={0.7}
                  className="flex-row items-center py-1.5 px-3 rounded-[10px] bg-primary/[0.07]"
                >
                  <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
                  <Text className="text-primary text-[13px] font-semibold">Edit</Text>
                </TouchableOpacity>
              )}
              {onLeave && (
                <TouchableOpacity
                  onPress={onLeave}
                  disabled={leaving}
                  activeOpacity={0.7}
                  className="flex-row items-center py-1.5 px-3 rounded-[10px] bg-danger-bgSoft"
                >
                  {leaving ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <MaterialIcons name="logout" size={14} color="#b91c1c" style={{ marginRight: 3 }} />
                      <Text className="text-danger text-[13px] font-semibold">Leave</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {showJoinBtn && (
                <TouchableOpacity
                  onPress={onJoin}
                  disabled={joinLoading}
                  activeOpacity={0.85}
                  className={cn(
                    'flex-row items-center py-1.5 px-3.5 rounded-[10px] bg-primary',
                    joinLoading && 'opacity-[0.65]'
                  )}
                >
                  {joinLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons
                        name={effectiveJoinLabel === 'Request' ? 'send' : 'group-add'}
                        size={14}
                        color="#fff"
                        style={{ marginRight: 4 }}
                      />
                      <Text className="text-white text-[13px] font-bold">{effectiveJoinLabel}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {showPendingState && (
                <View className="flex-row items-center gap-[5px]">
                  <View className="flex-row items-center py-1.5 px-2.5 rounded-[10px] bg-warn-bg">
                    <MaterialIcons name="schedule" size={13} color="#92400e" style={{ marginRight: 3 }} />
                    <Text className="text-warn-text text-xs font-bold">Pending</Text>
                  </View>
                  {onCancelRequest && (
                    <TouchableOpacity
                      onPress={onCancelRequest}
                      disabled={cancellingRequest}
                      className="py-[5px] px-2 rounded-lg bg-surface-raised"
                    >
                      {cancellingRequest ? (
                        <ActivityIndicator size="small" color="#64748b" />
                      ) : (
                        <Text className="text-ink-subtle text-[11px] font-semibold">Cancel</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// InputModal — centered dialog with icon + OTP-style or text input
// ---------------------------------------------------------------------------

function InputModal({
  visible,
  title,
  subtitle,
  placeholder,
  value,
  onChangeText,
  onConfirm,
  confirmLabel,
  confirming,
  onCancel,
  secureText,
  icon,
  otpLength,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  onConfirm: () => void;
  confirmLabel: string;
  confirming: boolean;
  onCancel: () => void;
  secureText?: boolean;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  otpLength?: number;
}) {
  const hiddenRef = useRef<TextInput>(null);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <Pressable className="flex-1 bg-[rgba(15,23,42,0.55)]" onPress={onCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1 justify-center items-center p-6"
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={shadows.dialog}
            className="w-full bg-white rounded-3xl px-6 pt-7 pb-6"
          >
            {icon && (
              <View className="w-16 h-16 rounded-[18px] bg-primary/[0.08] items-center justify-center mb-4 self-center">
                <MaterialIcons name={icon} size={28} color={PRIMARY} />
              </View>
            )}
            <Text className="text-[21px] font-bold text-ink text-center mb-2 tracking-[-0.3px]">
              {title}
            </Text>
            {subtitle && (
              <Text className="text-sm text-ink-subtle text-center leading-[21px] mb-5 px-1">
                {subtitle}
              </Text>
            )}

            {otpLength ? (
              <TouchableOpacity
                activeOpacity={1}
                className="w-full mb-5"
                onPress={() => hiddenRef.current?.focus()}
              >
                <View className="flex-row gap-2">
                  {Array.from({ length: otpLength }).map((_, i) => {
                    const char = value[i];
                    const isCursor = i === value.length;
                    return (
                      <View
                        key={i}
                        className={cn(
                          'flex-1 h-12 border-[1.5px] rounded-xl items-center justify-center bg-surface-subtle',
                          char ? 'bg-primary/[0.06] border-primary' : 'border-line-neutral',
                          isCursor && 'border-primary border-2'
                        )}
                      >
                        <Text className="text-lg font-extrabold text-ink">{char ?? ''}</Text>
                      </View>
                    );
                  })}
                </View>
                <TextInput
                  ref={hiddenRef}
                  style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
                  value={value}
                  onChangeText={(t) =>
                    onChangeText(t.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, otpLength))
                  }
                  autoCapitalize="characters"
                  maxLength={otpLength}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={onConfirm}
                  caretHidden
                />
              </TouchableOpacity>
            ) : (
              <TextInput
                className="border-[1.5px] border-line-neutral rounded-[14px] px-4 py-[15px] text-lg text-ink bg-surface-subtle text-center tracking-[3px] mb-5 font-bold"
                placeholder={placeholder}
                placeholderTextColor="#94a3b8"
                value={value}
                onChangeText={onChangeText}
                secureTextEntry={secureText}
                autoCapitalize={secureText ? 'none' : 'characters'}
                returnKeyType="done"
                onSubmitEditing={onConfirm}
                autoFocus
              />
            )}

            <TouchableOpacity
              onPress={onConfirm}
              disabled={confirming}
              className={cn(
                'bg-primary rounded-[14px] py-4 items-center mb-2.5',
                confirming && 'opacity-70'
              )}
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-base font-bold">{confirmLabel}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onCancel}
              className="bg-surface-raised rounded-[14px] py-[15px] items-center"
            >
              <Text className="text-ink-subtle text-[15px] font-semibold">Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MyGroupsScreen() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<PanelType>('my_groups');

  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<Group[]>([]);
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());
  const [editorGroupIds, setEditorGroupIds] = useState<Set<string>>(new Set());
  const [pendingRequestIds, setPendingRequestIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [detailMembers, setDetailMembers] = useState<DetailMember[]>([]);
  const [detailMembersLoading, setDetailMembersLoading] = useState(false);

  const [discoverSearch, setDiscoverSearch] = useState('');

  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);

  const [passwordGroup, setPasswordGroup] = useState<Group | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [joiningWithPassword, setJoiningWithPassword] = useState(false);

  const [collapsedMyGroups, setCollapsedMyGroups] = useState<Set<'friends' | 'campus'>>(new Set());

  const [discoverFilter, setDiscoverFilter] = useState<'all' | 'friends' | 'campus'>('all');

  const isMemberOfSelected = useMemo(() => {
    if (!selectedGroup) return false;
    return myGroups.some((g) => g.id === selectedGroup.id);
  }, [selectedGroup, myGroups]);

  useEffect(() => {
    if (!selectedGroup || !isMemberOfSelected) {
      setDetailMembers([]);
      setDetailMembersLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setDetailMembersLoading(true);
      const { data: rows, error: e1 } = await supabase
        .from('group_members')
        .select('user_id, role')
        .eq('group_id', selectedGroup.id);
      if (cancelled) return;
      if (e1 || !rows?.length) {
        setDetailMembersLoading(false);
        setDetailMembers([]);
        return;
      }
      const ids = rows.map((r) => r.user_id);
      const { data: profs } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url')
        .in('id', ids);
      if (cancelled) return;
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      const merged: DetailMember[] = rows.map((r) => {
        const p = byId.get(r.user_id);
        return {
          user_id: r.user_id,
          role: r.role,
          profiles: p ? { full_name: p.full_name, avatar_url: p.avatar_url } : null,
        };
      });
      const order: Record<string, number> = { admin: 0, editor: 1, member: 2 };
      merged.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
      setDetailMembersLoading(false);
      setDetailMembers(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGroup, isMemberOfSelected]);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const [memberRes, groupsRes, countRes, requestsRes] = await Promise.all([
      supabase.from('group_members').select('group_id, role').eq('user_id', user.id),
      supabase.from('groups').select('id, name, description, image_url, type, is_private, has_join_password'),
      supabase.rpc('get_group_member_counts'),
      supabase.rpc('get_my_join_requests'),
    ]);

    const memberRows = memberRes.data ?? [];
    const allGroups = groupsRes.data ?? [];

    const myGroupIds = new Set(memberRows.map((r) => r.group_id));
    const adminIds = new Set(memberRows.filter((r) => r.role === 'admin').map((r) => r.group_id));
    const editorIds = new Set(memberRows.filter((r) => r.role === 'editor').map((r) => r.group_id));
    const pendingIds = new Set<string>(
      (requestsRes.data ?? [])
        .filter((r: { group_id: string; status: string }) => r.status === 'pending')
        .map((r: { group_id: string; status: string }) => r.group_id)
    );

    setAdminGroupIds(adminIds);
    setEditorGroupIds(editorIds);
    setPendingRequestIds(pendingIds);

    let countByGroup: Record<string, number> = {};
    if (!countRes.error && countRes.data) {
      countByGroup = countRes.data.reduce(
        (acc: Record<string, number>, row: { group_id: string; member_count: unknown }) => {
          acc[row.group_id] = Number(row.member_count ?? 0);
          return acc;
        },
        {}
      );
    }

    const withCounts = allGroups.map((g) => ({ ...g, member_count: countByGroup[g.id] ?? 0 }));
    setMyGroups(withCounts.filter((g) => myGroupIds.has(g.id)) as Group[]);
    setDiscoverGroups(withCounts.filter((g) => !myGroupIds.has(g.id)) as Group[]);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      fetchGroups();
    }, [fetchGroups])
  );

  function handleJoinPress(group: Group) {
    if (joiningId || requestingId) return;
    if (group.type === 'campus_org') {
      handleRequestJoin(group.id);
    } else if (group.has_join_password) {
      setPasswordGroup(group);
      setPasswordInput('');
    } else {
      handleDirectFriendJoin(group.id);
    }
  }

  async function handleDirectFriendJoin(groupId: string) {
    setJoiningId(groupId);
    const { data, error } = await supabase.rpc('join_friend_group', {
      p_group_id: groupId,
      p_password: null,
    });
    setJoiningId(null);
    if (error || data?.error) {
      Alert.alert('Error', error?.message ?? data?.error ?? 'Could not join group.');
    } else {
      fetchGroups();
    }
  }

  async function handleJoinWithPassword() {
    if (!passwordGroup) return;
    setJoiningWithPassword(true);
    const { data, error } = await supabase.rpc('join_friend_group', {
      p_group_id: passwordGroup.id,
      p_password: passwordInput.trim(),
    });
    setJoiningWithPassword(false);
    if (error || data?.error) {
      if (data?.error === 'incorrect_password') {
        Alert.alert('Wrong password', 'The password you entered is incorrect. Try again.');
      } else {
        Alert.alert('Error', error?.message ?? data?.error ?? 'Could not join group.');
      }
      return;
    }
    setPasswordGroup(null);
    setPasswordInput('');
    fetchGroups();
  }

  async function handleRequestJoin(groupId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setRequestingId(groupId);
    const { error } = await supabase.from('group_join_requests').insert({
      group_id: groupId,
      user_id: user.id,
    });
    setRequestingId(null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      fetchGroups();
    }
  }

  async function handleCancelRequest(groupId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCancellingRequestId(groupId);
    const { error } = await supabase
      .from('group_join_requests')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);
    setCancellingRequestId(null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      fetchGroups();
    }
  }

  async function handleJoinByCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setJoiningByCode(true);
    const { data, error } = await supabase.rpc('join_group_by_code', { p_code: code });
    setJoiningByCode(false);
    if (error || data?.error) {
      if (data?.error === 'invalid_code') {
        Alert.alert('Invalid code', 'No private group found with that code. Double-check and try again.');
      } else if (data?.error === 'already_member') {
        Alert.alert('Already a member', `You're already in ${data?.group_name ?? 'that group'}.`);
        setShowCodeModal(false);
        setCodeInput('');
      } else {
        Alert.alert('Error', error?.message ?? data?.error ?? 'Something went wrong.');
      }
      return;
    }
    setShowCodeModal(false);
    setCodeInput('');
    Alert.alert('Joined!', `You've joined ${data?.group_name ?? 'the group'}.`);
    fetchGroups();
  }

  async function handleLeave(groupId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setLeavingId(groupId);
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', user.id);
    setLeavingId(null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSelectedGroup(null);
      fetchGroups();
    }
  }

  const myFriendGroups = useMemo(() => myGroups.filter((g) => g.type === 'friends'), [myGroups]);
  const myCampusGroups = useMemo(() => myGroups.filter((g) => g.type === 'campus_org'), [myGroups]);

  const searchedDiscover = useMemo(() => {
    const q = discoverSearch.trim().toLowerCase();
    if (!q) return discoverGroups;
    return discoverGroups.filter((g) => g.name.toLowerCase().startsWith(q));
  }, [discoverGroups, discoverSearch]);

  const discoverFriendGroups = useMemo(
    () => searchedDiscover.filter((g) => g.type === 'friends'),
    [searchedDiscover]
  );
  const discoverCampusGroups = useMemo(
    () => searchedDiscover.filter((g) => g.type === 'campus_org'),
    [searchedDiscover]
  );

  const hasDiscoverSearch = discoverSearch.trim().length > 0;
  const noSearchResults =
    hasDiscoverSearch &&
    (discoverFilter === 'friends'
      ? discoverFriendGroups.length === 0
      : discoverFilter === 'campus'
      ? discoverCampusGroups.length === 0
      : discoverFriendGroups.length === 0 && discoverCampusGroups.length === 0);

  const panelOptions: SegmentedOption<PanelType>[] = [
    { value: 'my_groups', label: 'Your Groups' },
    { value: 'discover', label: 'Discover' },
  ];

  return (
    <PageShell
      title="Groups"
      right={
        <IconButton
          tone="surface"
          onPress={() => router.push('/create-group' as never)}
          accessibilityLabel="Create group"
        >
          <MaterialIcons name="add" size={22} color={PRIMARY} />
        </IconButton>
      }
    >
      <InputModal
        visible={showCodeModal}
        title="Join with Code"
        subtitle="Enter the private group's unique code to join."
        placeholder="e.g. A3BF19CD"
        value={codeInput}
        onChangeText={setCodeInput}
        onConfirm={handleJoinByCode}
        confirmLabel="Join Group"
        confirming={joiningByCode}
        onCancel={() => {
          setShowCodeModal(false);
          setCodeInput('');
        }}
        icon="key"
        otpLength={6}
      />

      <InputModal
        visible={!!passwordGroup}
        title="Password Required"
        subtitle={`Enter the password to join "${passwordGroup?.name ?? ''}".`}
        placeholder="Group password"
        value={passwordInput}
        onChangeText={setPasswordInput}
        onConfirm={handleJoinWithPassword}
        confirmLabel="Join"
        confirming={joiningWithPassword}
        onCancel={() => {
          setPasswordGroup(null);
          setPasswordInput('');
        }}
        secureText
        icon="lock"
      />

      <GroupDetailModal
        group={selectedGroup}
        isMemberOfSelected={isMemberOfSelected}
        detailMembers={detailMembers}
        detailMembersLoading={detailMembersLoading}
        onClose={() => setSelectedGroup(null)}
        onNavigateToEvents={(g) => {
          setSelectedGroup(null);
          if (__DEV__) {
            console.log('[MyGroups] Navigating to calendar with groupId:', g.id);
          }
          router.push({
            pathname: '/(tabs)/calendar',
            params: { groupId: String(g.id), groupName: g.name },
          });
        }}
      />

      <View className="px-5 pt-4 pb-1">
        <SegmentedTabs<PanelType>
          value={activePanel}
          onChange={setActivePanel}
          options={panelOptions}
        />
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName="px-5 pt-2 pb-12"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchGroups} tintColor={PRIMARY} />}
      >
        {activePanel === 'my_groups' && (
          <>
            {loading && myGroups.length === 0 ? (
              <View className="py-12 items-center">
                <ActivityIndicator color={PRIMARY} size="large" />
              </View>
            ) : (
              <>
                <SectionHeader
                  title="Friend Groups"
                  count={myFriendGroups.length}
                  collapsed={collapsedMyGroups.has('friends')}
                  onToggle={() =>
                    setCollapsedMyGroups((prev) => {
                      const n = new Set(prev);
                      if (n.has('friends')) n.delete('friends'); else n.add('friends');
                      return n;
                    })
                  }
                />
                {!collapsedMyGroups.has('friends') &&
                  (myFriendGroups.length === 0 ? (
                    <EmptyCard
                      icon="people"
                      title="No friend groups yet"
                      subtitle="Create one with the + button or join one in Discover."
                    />
                  ) : (
                    myFriendGroups.map((group) => (
                      <GroupCard
                        key={group.id}
                        group={group}
                        subtitle={`${group.member_count ?? 0} members`}
                        canEdit={adminGroupIds.has(group.id) || editorGroupIds.has(group.id)}
                        onEdit={() => router.push(`/edit-group/${group.id}` as never)}
                        onPress={() => setSelectedGroup(group)}
                        onLeave={
                          !adminGroupIds.has(group.id) ? () => !leavingId && handleLeave(group.id) : undefined
                        }
                        leaving={leavingId === group.id}
                      />
                    ))
                  ))}

                <SectionHeader
                  title="Campus Groups"
                  count={myCampusGroups.length}
                  topSpacing
                  collapsed={collapsedMyGroups.has('campus')}
                  onToggle={() =>
                    setCollapsedMyGroups((prev) => {
                      const n = new Set(prev);
                      if (n.has('campus')) n.delete('campus'); else n.add('campus');
                      return n;
                    })
                  }
                />
                {!collapsedMyGroups.has('campus') &&
                  (myCampusGroups.length === 0 ? (
                    <EmptyCard
                      icon="school"
                      title="No campus groups yet"
                      subtitle="Request to join a campus org in Discover."
                    />
                  ) : (
                    myCampusGroups.map((group) => (
                      <GroupCard
                        key={group.id}
                        group={group}
                        subtitle={`${group.member_count ?? 0} members`}
                        canEdit={adminGroupIds.has(group.id) || editorGroupIds.has(group.id)}
                        onEdit={() => router.push(`/edit-group/${group.id}` as never)}
                        onPress={() => setSelectedGroup(group)}
                        onLeave={
                          !adminGroupIds.has(group.id) ? () => !leavingId && handleLeave(group.id) : undefined
                        }
                        leaving={leavingId === group.id}
                      />
                    ))
                  ))}
              </>
            )}
          </>
        )}

        {activePanel === 'discover' && (
          <>
            <View className="flex-row items-center mt-4 mb-1 gap-2.5">
              <View className="flex-1">
                <SearchInput
                  placeholder="Search groups…"
                  value={discoverSearch}
                  onChangeText={setDiscoverSearch}
                  onClear={() => setDiscoverSearch('')}
                  returnKeyType="search"
                />
              </View>
              <TouchableOpacity
                onPress={() => {
                  setCodeInput('');
                  setShowCodeModal(true);
                }}
                activeOpacity={0.8}
                accessibilityLabel="Join with code"
                className="w-[46px] h-[46px] rounded-xl bg-primary/10 items-center justify-center"
              >
                <MaterialIcons name="key" size={20} color={PRIMARY} />
              </TouchableOpacity>
            </View>

            <View className="flex-row mt-3 mb-4 gap-2">
              {(['all', 'friends', 'campus'] as const).map((f) => {
                const label = f === 'all' ? 'All' : f === 'friends' ? 'Friend Groups' : 'Campus Groups';
                return (
                  <Chip
                    key={f}
                    label={label}
                    active={discoverFilter === f}
                    onPress={() => setDiscoverFilter(f)}
                  />
                );
              })}
            </View>

            {loading && discoverGroups.length === 0 ? (
              <View className="py-12 items-center">
                <ActivityIndicator color={PRIMARY} size="large" />
              </View>
            ) : noSearchResults ? (
              <EmptyCard
                icon="search-off"
                title={`No results for "${discoverSearch.trim()}"`}
                subtitle="Try a different search term."
              />
            ) : discoverFilter === 'friends' ? (
              discoverFriendGroups.length === 0 ? (
                <EmptyCard
                  icon="people-outline"
                  title="No friend groups to join"
                  subtitle="All available friend groups will appear here."
                />
              ) : (
                discoverFriendGroups.map((group) => (
                  <GroupCard
                    key={group.id}
                    group={group}
                    subtitle={`${group.member_count ?? 0} members`}
                    onJoin={() => handleJoinPress(group)}
                    joinLabel="Join"
                    joinLoading={joiningId === group.id}
                    onPress={() => setSelectedGroup(group)}
                  />
                ))
              )
            ) : discoverFilter === 'campus' ? (
              discoverCampusGroups.length === 0 ? (
                <EmptyCard
                  icon="school"
                  title="No campus orgs to join"
                  subtitle="Available campus organizations will appear here."
                />
              ) : (
                discoverCampusGroups.map((group) => {
                  const isPending = pendingRequestIds.has(group.id);
                  return (
                    <GroupCard
                      key={group.id}
                      group={group}
                      subtitle={`${group.member_count ?? 0} members`}
                      onJoin={!isPending ? () => handleJoinPress(group) : undefined}
                      joinLabel="Request"
                      joinLoading={requestingId === group.id}
                      isPending={isPending}
                      onCancelRequest={isPending ? () => handleCancelRequest(group.id) : undefined}
                      cancellingRequest={cancellingRequestId === group.id}
                      onPress={() => setSelectedGroup(group)}
                    />
                  );
                })
              )
            ) : (
              <>
                {(!hasDiscoverSearch || discoverFriendGroups.length > 0) && (
                  <>
                    <SectionHeader title="Friend Groups" count={discoverFriendGroups.length} />
                    {discoverFriendGroups.length === 0 ? (
                      <EmptyCard
                        icon="people-outline"
                        title="No friend groups to join"
                        subtitle="All available friend groups will appear here."
                      />
                    ) : (
                      discoverFriendGroups.map((group) => (
                        <GroupCard
                          key={group.id}
                          group={group}
                          subtitle={`${group.member_count ?? 0} members`}
                          onJoin={() => handleJoinPress(group)}
                          joinLabel="Join"
                          joinLoading={joiningId === group.id}
                          onPress={() => setSelectedGroup(group)}
                        />
                      ))
                    )}
                  </>
                )}

                {(!hasDiscoverSearch || discoverCampusGroups.length > 0) && (
                  <>
                    <SectionHeader
                      title="Campus Groups"
                      count={discoverCampusGroups.length}
                      topSpacing={!hasDiscoverSearch || discoverFriendGroups.length > 0}
                    />
                    {discoverCampusGroups.length === 0 ? (
                      <EmptyCard
                        icon="school"
                        title="No campus orgs to join"
                        subtitle="Available campus organizations will appear here."
                      />
                    ) : (
                      discoverCampusGroups.map((group) => {
                        const isPending = pendingRequestIds.has(group.id);
                        return (
                          <GroupCard
                            key={group.id}
                            group={group}
                            subtitle={`${group.member_count ?? 0} members`}
                            onJoin={!isPending ? () => handleJoinPress(group) : undefined}
                            joinLabel="Request"
                            joinLoading={requestingId === group.id}
                            isPending={isPending}
                            onCancelRequest={isPending ? () => handleCancelRequest(group.id) : undefined}
                            cancellingRequest={cancellingRequestId === group.id}
                            onPress={() => setSelectedGroup(group)}
                          />
                        );
                      })
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </ScrollView>
    </PageShell>
  );
}

function GroupDetailModal({
  group,
  isMemberOfSelected,
  detailMembers,
  detailMembersLoading,
  onClose,
  onNavigateToEvents,
}: {
  group: Group | null;
  isMemberOfSelected: boolean;
  detailMembers: DetailMember[];
  detailMembersLoading: boolean;
  onClose: () => void;
  onNavigateToEvents: (g: Group) => void;
}) {
  return (
    <Modal visible={!!group} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-[rgba(15,23,42,0.5)] justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={shadows.sheet}
          className="bg-white rounded-t-[28px] w-full max-h-[85%] overflow-hidden"
        >
          {group && (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerClassName="pb-9"
            >
              <View className="self-center w-10 h-[5px] rounded-[3px] bg-[#d4d8de] mt-3 mb-2" />
              <View className="items-center px-6 pb-5 pt-2">
                {group.image_url ? (
                  <Image
                    source={{ uri: group.image_url }}
                    className="w-[100px] h-[100px] rounded-3xl mb-4 bg-surface-raised"
                  />
                ) : (
                  <View className="w-[100px] h-[100px] rounded-3xl bg-primary/[0.08] mb-4 items-center justify-center">
                    <MaterialIcons name="groups" size={40} color="#94a3b8" />
                  </View>
                )}
                <Text className="text-[24px] font-bold text-ink text-center mb-3 tracking-[-0.3px]">
                  {group.name}
                </Text>
                <View className="flex-row items-center flex-wrap justify-center">
                  <View
                    className={cn(
                      'flex-row items-center px-3.5 py-1.5 rounded-[20px] mr-2 mb-1',
                      group.type === 'campus_org' ? 'bg-primary/[0.12]' : 'bg-surface-raised'
                    )}
                  >
                    <Text
                      className={cn(
                        'text-[13px] font-semibold',
                        group.type === 'campus_org' ? 'text-primary' : 'text-ink-subtle'
                      )}
                    >
                      {group.type === 'campus_org' ? 'Campus org' : 'Friend group'}
                    </Text>
                  </View>
                  {group.is_private && (
                    <View className="flex-row items-center px-3.5 py-1.5 rounded-[20px] mr-2 mb-1 bg-surface-raised">
                      <MaterialIcons name="lock" size={12} color="#64748b" style={{ marginRight: 4 }} />
                      <Text className="text-[13px] font-semibold text-ink-subtle">Private</Text>
                    </View>
                  )}
                  <Text className="text-sm text-ink-subtle font-medium mb-1">
                    {group.member_count ?? 0} members
                  </Text>
                </View>
              </View>

              <View className="mx-5 mb-4 bg-surface-soft rounded-2xl p-4">
                <Text className="text-xs font-bold text-ink-dim uppercase tracking-[0.8px] mb-2.5">
                  About
                </Text>
                {group.description ? (
                  <Text className="text-[15px] text-ink-body leading-[23px]">{group.description}</Text>
                ) : (
                  <Text className="text-sm text-ink-dim italic">No description yet.</Text>
                )}
              </View>

              <View className="mx-5 mb-4 bg-surface-soft rounded-2xl p-4">
                <Text className="text-xs font-bold text-ink-dim uppercase tracking-[0.8px] mb-2.5">
                  Members
                </Text>
                {!isMemberOfSelected ? (
                  <View className="flex-row items-center">
                    <MaterialIcons name="lock-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
                    <Text className="flex-1 text-sm text-ink-subtle leading-5">
                      Join this group to see who is in it.
                    </Text>
                  </View>
                ) : detailMembersLoading ? (
                  <View className="py-4 items-center">
                    <ActivityIndicator color={PRIMARY} />
                  </View>
                ) : detailMembers.length === 0 ? (
                  <Text className="text-sm text-ink-dim italic">No members loaded.</Text>
                ) : (
                  <View>
                    {detailMembers.map((m, index) => (
                      <View
                        key={m.user_id}
                        className={cn(
                          'flex-row items-center py-2.5 border-b border-line-soft',
                          index === detailMembers.length - 1 && 'border-b-0'
                        )}
                      >
                        {m.profiles?.avatar_url ? (
                          <Image
                            source={{ uri: m.profiles.avatar_url }}
                            className="w-10 h-10 rounded-[14px] mr-3 bg-line-neutral"
                          />
                        ) : (
                          <View className="w-10 h-10 rounded-[14px] mr-3 bg-primary/10 items-center justify-center">
                            <Text className="text-sm font-bold text-primary">
                              {initialsFromName(m.profiles?.full_name)}
                            </Text>
                          </View>
                        )}
                        <Text className="flex-1 text-[15px] font-medium text-ink" numberOfLines={1}>
                          {m.profiles?.full_name ?? 'Member'}
                        </Text>
                        <View className="px-2.5 py-1 rounded-lg bg-primary/[0.06]">
                          <Text className="text-[11px] font-semibold text-primary capitalize">
                            {m.role}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity
                onPress={() => onNavigateToEvents(group)}
                activeOpacity={0.88}
                style={shadows.primaryBtn}
                className="flex-row items-center justify-center bg-primary mx-5 py-4 rounded-2xl mb-2.5"
              >
                <MaterialIcons name="event" size={22} color="#fff" style={{ marginRight: 8 }} />
                <Text className="text-white text-base font-bold">View group events</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onClose}
                activeOpacity={0.7}
                className="mx-5 py-3.5 items-center bg-surface-raised rounded-[14px]"
              >
                <Text className="text-base font-semibold text-ink-subtle">Close</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SectionHeader({
  title,
  count,
  topSpacing,
  collapsed,
  onToggle,
}: {
  title: string;
  count: number;
  topSpacing?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  const inner = (
    <>
      <View className="flex-row items-center flex-1">
        <Text className="text-[13px] font-bold text-ink-dim tracking-[0.8px] uppercase">{title}</Text>
        {count > 0 && (
          <View className="ml-2 bg-primary/10 px-[9px] py-[3px] rounded-[10px]">
            <Text className="text-xs font-bold text-primary">{count}</Text>
          </View>
        )}
      </View>
      {onToggle && (
        <MaterialIcons
          name={collapsed ? 'keyboard-arrow-down' : 'keyboard-arrow-up'}
          size={20}
          color="#b0bec5"
        />
      )}
    </>
  );

  if (onToggle) {
    return (
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.7}
        className={cn('flex-row items-center mb-3 mt-5', topSpacing && 'mt-2')}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return (
    <View className={cn('flex-row items-center mb-3 mt-5', topSpacing && 'mt-2')}>{inner}</View>
  );
}

function EmptyCard({
  icon,
  title,
  subtitle,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
}) {
  return (
    <View style={shadows.card} className="bg-white rounded-[20px] py-7 px-5 items-center mb-2">
      <View className="w-16 h-16 rounded-[20px] bg-primary/[0.06] items-center justify-center mb-3">
        <MaterialIcons name={icon} size={30} color="#85b0bf" />
      </View>
      <Text className="text-base font-semibold text-ink-body mb-1.5">{title}</Text>
      <Text className="text-[13px] text-ink-dim text-center leading-[19px] max-w-[240px]">
        {subtitle}
      </Text>
    </View>
  );
}
