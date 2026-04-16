import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

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

const PRIMARY = '#0B617E';

function initialsFromName(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

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
        <Image source={{ uri: group.image_url }} style={cardStyles.avatarImg} />
      ) : (
        <View style={cardStyles.avatarPlaceholder}>
          <MaterialIcons name="groups" size={22} color="#94a3b8" />
        </View>
      )}
      <View style={cardStyles.cardTextCol}>
        <View style={cardStyles.nameLockRow}>
          <Text style={cardStyles.cardTitle} numberOfLines={1}>
            {group.name}
          </Text>
          {group.is_private && (
            <MaterialIcons name="lock" size={13} color="#94a3b8" style={{ marginLeft: 5, marginTop: 1 }} />
          )}
          {!group.is_private && group.has_join_password && (
            <MaterialIcons name="key" size={13} color="#94a3b8" style={{ marginLeft: 5, marginTop: 1 }} />
          )}
        </View>
        <Text style={cardStyles.cardMeta} numberOfLines={1}>{metaLine}</Text>
      </View>
    </>
  );

  return (
    <View style={cardStyles.cardWrap}>
      <View style={cardStyles.cardMain}>
        <View style={cardStyles.cardMainRow}>
          {onPress ? (
            <TouchableOpacity
              style={cardStyles.cardTouchableLeft}
              onPress={onPress}
              activeOpacity={0.72}
            >
              {mainContent}
            </TouchableOpacity>
          ) : (
            <View style={cardStyles.cardTouchableLeft}>{mainContent}</View>
          )}

          {hasActions && (
            <View style={cardStyles.actionsInline}>
              {canEdit && onEdit && (
                <TouchableOpacity
                  style={cardStyles.btnCompact}
                  onPress={onEdit}
                  activeOpacity={0.7}
                >
                  <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
                  <Text style={cardStyles.btnCompactText}>Edit</Text>
                </TouchableOpacity>
              )}
              {onLeave && (
                <TouchableOpacity
                  style={[cardStyles.btnCompact, cardStyles.btnCompactLeave]}
                  onPress={onLeave}
                  disabled={leaving}
                  activeOpacity={0.7}
                >
                  {leaving ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <MaterialIcons name="logout" size={14} color="#b91c1c" style={{ marginRight: 3 }} />
                      <Text style={cardStyles.btnCompactLeaveText}>Leave</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {showJoinBtn && (
                <TouchableOpacity
                  style={[
                    cardStyles.btnCompactJoin,
                    effectiveJoinLabel === 'Request' && cardStyles.btnCompactRequest,
                    joinLoading && { opacity: 0.65 },
                  ]}
                  onPress={onJoin}
                  disabled={joinLoading}
                  activeOpacity={0.85}
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
                      <Text style={cardStyles.btnCompactJoinText}>{effectiveJoinLabel}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
              {showPendingState && (
                <View style={cardStyles.pendingWrap}>
                  <View style={cardStyles.btnPending}>
                    <MaterialIcons name="schedule" size={13} color="#92400e" style={{ marginRight: 3 }} />
                    <Text style={cardStyles.btnPendingText}>Pending</Text>
                  </View>
                  {onCancelRequest && (
                    <TouchableOpacity
                      style={cardStyles.btnCancelRequest}
                      onPress={onCancelRequest}
                      disabled={cancellingRequest}
                    >
                      {cancellingRequest ? (
                        <ActivityIndicator size="small" color="#64748b" />
                      ) : (
                        <Text style={cardStyles.btnCancelRequestText}>Cancel</Text>
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

const cardStyles = StyleSheet.create({
  cardWrap: {
    backgroundColor: '#fff',
    borderRadius: 18,
    marginBottom: 12,
    shadowColor: '#0B617E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  cardMain: { paddingHorizontal: 16, paddingVertical: 14 },
  cardMainRow: { flexDirection: 'row', alignItems: 'center' },
  cardTouchableLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  cardTextCol: { flex: 1, minWidth: 0 },
  nameLockRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  actionsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    alignSelf: 'center',
    gap: 6,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0f172a',
    lineHeight: 22,
    flexShrink: 1,
  },
  cardMeta: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  avatarImg: {
    width: 50,
    height: 50,
    borderRadius: 15,
    marginRight: 14,
    backgroundColor: '#f1f5f9',
  },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 15,
    marginRight: 14,
    backgroundColor: 'rgba(11, 97, 126, 0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(11, 97, 126, 0.07)',
  },
  btnCompactText: { color: PRIMARY, fontSize: 13, fontWeight: '600' },
  btnCompactLeave: { backgroundColor: '#fef2f2' },
  btnCompactLeaveText: { color: '#dc2626', fontSize: 13, fontWeight: '600' },
  btnCompactJoin: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: PRIMARY,
  },
  btnCompactRequest: { backgroundColor: PRIMARY },
  btnCompactJoinText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pendingWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  btnPending: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#fef3c7',
  },
  btnPendingText: { color: '#92400e', fontSize: 12, fontWeight: '700' },
  btnCancelRequest: {
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  btnCancelRequestText: { color: '#64748b', fontSize: 11, fontWeight: '600' },
});

// ---------------------------------------------------------------------------
// Small reusable Input Modal (code join + password prompt)
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
      <Pressable style={modalInputStyles.overlay} onPress={onCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={modalInputStyles.kvContainer}
        >
          <Pressable style={modalInputStyles.sheet} onPress={(e) => e.stopPropagation()}>
            {icon && (
              <View style={modalInputStyles.iconCircle}>
                <MaterialIcons name={icon} size={28} color={PRIMARY} />
              </View>
            )}
            <Text style={modalInputStyles.title}>{title}</Text>
            {subtitle && <Text style={modalInputStyles.subtitle}>{subtitle}</Text>}

            {otpLength ? (
              /* OTP box input */
              <TouchableOpacity
                activeOpacity={1}
                style={modalInputStyles.otpWrapper}
                onPress={() => hiddenRef.current?.focus()}
              >
                <View style={modalInputStyles.otpRow}>
                  {Array.from({ length: otpLength }).map((_, i) => {
                    const char = value[i];
                    const isCursor = i === value.length;
                    return (
                      <View
                        key={i}
                        style={[
                          modalInputStyles.otpBox,
                          char ? modalInputStyles.otpBoxFilled : undefined,
                          isCursor ? modalInputStyles.otpBoxCursor : undefined,
                        ]}
                      >
                        <Text style={modalInputStyles.otpChar}>{char ?? ''}</Text>
                      </View>
                    );
                  })}
                </View>
                <TextInput
                  ref={hiddenRef}
                  style={modalInputStyles.otpHidden}
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
              /* Regular text input */
              <TextInput
                style={modalInputStyles.input}
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
              style={[modalInputStyles.confirmBtn, confirming && { opacity: 0.7 }]}
              onPress={onConfirm}
              disabled={confirming}
            >
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={modalInputStyles.confirmBtnText}>{confirmLabel}</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={modalInputStyles.cancelBtn} onPress={onCancel}>
              <Text style={modalInputStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const modalInputStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
  },
  kvContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: 'rgba(11, 97, 126, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    alignSelf: 'center',
  },
  title: {
    fontSize: 21,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 18,
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    textAlign: 'center',
    letterSpacing: 3,
    marginBottom: 20,
    fontWeight: '700',
  },
  confirmBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 10,
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelBtn: {
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  cancelBtnText: { color: '#64748b', fontSize: 15, fontWeight: '600' },
  // OTP boxes
  otpWrapper: { width: '100%', marginBottom: 20 },
  otpRow: { flexDirection: 'row', gap: 8 },
  otpBox: {
    flex: 1,
    height: 48,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  otpBoxFilled: {
    backgroundColor: 'rgba(11, 97, 126, 0.06)',
    borderColor: PRIMARY,
  },
  otpBoxCursor: {
    borderColor: PRIMARY,
    borderWidth: 2,
  },
  otpChar: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  otpHidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function MyGroupsScreen() {
  const router = useRouter();
  const [activePanel, setActivePanel] = useState<PanelType>('my_groups');

  // Groups data
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<Group[]>([]);
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());
  const [editorGroupIds, setEditorGroupIds] = useState<Set<string>>(new Set());
  const [pendingRequestIds, setPendingRequestIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Action loading states
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [cancellingRequestId, setCancellingRequestId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);

  // Group detail modal
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [detailMembers, setDetailMembers] = useState<DetailMember[]>([]);
  const [detailMembersLoading, setDetailMembersLoading] = useState(false);

  // Discover search
  const [discoverSearch, setDiscoverSearch] = useState('');

  // Join-by-code modal
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [codeInput, setCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);

  // Password prompt modal
  const [passwordGroup, setPasswordGroup] = useState<Group | null>(null);
  const [passwordInput, setPasswordInput] = useState('');
  const [joiningWithPassword, setJoiningWithPassword] = useState(false);

  // My-groups section collapse state
  const [collapsedMyGroups, setCollapsedMyGroups] = useState<Set<'friends' | 'campus'>>(new Set());

  // Discover type filter
  const [discoverFilter, setDiscoverFilter] = useState<'all' | 'friends' | 'campus'>('all');

  // -------------------------------------------------------------------------
  // isMemberOfSelected: used to gate the member list in the detail modal
  // -------------------------------------------------------------------------
  const isMemberOfSelected = useMemo(() => {
    if (!selectedGroup) return false;
    return myGroups.some((g) => g.id === selectedGroup.id);
  }, [selectedGroup, myGroups]);

  // -------------------------------------------------------------------------
  // Load members when the detail modal opens (only for own groups)
  // -------------------------------------------------------------------------
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
    return () => { cancelled = true; };
  }, [selectedGroup, isMemberOfSelected]);

  // -------------------------------------------------------------------------
  // fetchGroups
  // -------------------------------------------------------------------------
  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

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

  useFocusEffect(useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    fetchGroups();
  }, [fetchGroups]));

  // -------------------------------------------------------------------------
  // Join routing: decide the right path based on group type + settings
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Derived / filtered data
  // -------------------------------------------------------------------------
  const myFriendGroups = useMemo(() => myGroups.filter((g) => g.type === 'friends'), [myGroups]);
  const myCampusGroups = useMemo(() => myGroups.filter((g) => g.type === 'campus_org'), [myGroups]);

  const searchedDiscover = useMemo(() => {
    const q = discoverSearch.trim().toLowerCase();
    if (!q) return discoverGroups;
    return discoverGroups.filter((g) => g.name.toLowerCase().startsWith(q));
  }, [discoverGroups, discoverSearch]);

  const discoverFriendGroups = useMemo(() => searchedDiscover.filter((g) => g.type === 'friends'), [searchedDiscover]);
  const discoverCampusGroups = useMemo(() => searchedDiscover.filter((g) => g.type === 'campus_org'), [searchedDiscover]);

  const hasDiscoverSearch = discoverSearch.trim().length > 0;
  const noSearchResults = hasDiscoverSearch && (
    discoverFilter === 'friends' ? discoverFriendGroups.length === 0 :
    discoverFilter === 'campus'  ? discoverCampusGroups.length === 0 :
    discoverFriendGroups.length === 0 && discoverCampusGroups.length === 0
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>

      {/* Join-by-code modal */}
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
        onCancel={() => { setShowCodeModal(false); setCodeInput(''); }}
        icon="key"
        otpLength={6}
      />

      {/* Password prompt modal */}
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
        onCancel={() => { setPasswordGroup(null); setPasswordInput(''); }}
        secureText
        icon="lock"
      />

      {/* Group detail modal */}
      <Modal
        visible={!!selectedGroup}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedGroup(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSelectedGroup(null)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            {selectedGroup && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                <View style={styles.modalHandle} />
                <View style={styles.modalHero}>
                  {selectedGroup.image_url ? (
                    <Image source={{ uri: selectedGroup.image_url }} style={styles.modalHeroImage} />
                  ) : (
                    <View style={styles.modalHeroPlaceholder}>
                      <MaterialIcons name="groups" size={40} color="#94a3b8" />
                    </View>
                  )}
                  <Text style={styles.modalTitle}>{selectedGroup.name}</Text>
                  <View style={styles.modalMetaRow}>
                    <View
                      style={[
                        styles.modalBadge,
                        selectedGroup.type === 'campus_org'
                          ? { backgroundColor: 'rgba(11, 97, 126, 0.12)' }
                          : { backgroundColor: '#f1f5f9' },
                        { marginRight: 8, marginBottom: 4 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.modalBadgeText,
                          { color: selectedGroup.type === 'campus_org' ? PRIMARY : '#64748b' },
                        ]}
                      >
                        {selectedGroup.type === 'campus_org' ? 'Campus org' : 'Friend group'}
                      </Text>
                    </View>
                    {selectedGroup.is_private && (
                      <View style={[styles.modalBadge, { backgroundColor: '#f1f5f9', marginRight: 8, marginBottom: 4 }]}>
                        <MaterialIcons name="lock" size={12} color="#64748b" style={{ marginRight: 4 }} />
                        <Text style={[styles.modalBadgeText, { color: '#64748b' }]}>Private</Text>
                      </View>
                    )}
                    <Text style={[styles.modalMetaMuted, { marginBottom: 4 }]}>
                      {selectedGroup.member_count ?? 0} members
                    </Text>
                  </View>
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>About</Text>
                  {selectedGroup.description ? (
                    <Text style={styles.modalBodyText}>{selectedGroup.description}</Text>
                  ) : (
                    <Text style={styles.modalPlaceholder}>No description yet.</Text>
                  )}
                </View>

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionTitle}>Members</Text>
                  {!isMemberOfSelected ? (
                    <View style={styles.modalHintBox}>
                      <MaterialIcons name="lock-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
                      <Text style={styles.modalHintText}>Join this group to see who is in it.</Text>
                    </View>
                  ) : detailMembersLoading ? (
                    <View style={styles.modalLoading}>
                      <ActivityIndicator color={PRIMARY} />
                    </View>
                  ) : detailMembers.length === 0 ? (
                    <Text style={styles.modalPlaceholder}>No members loaded.</Text>
                  ) : (
                    <View>
                      {detailMembers.map((m, index) => (
                        <View
                          key={m.user_id}
                          style={[
                            styles.memberRow,
                            index === detailMembers.length - 1 && { borderBottomWidth: 0 },
                          ]}
                        >
                          {m.profiles?.avatar_url ? (
                            <Image source={{ uri: m.profiles.avatar_url }} style={styles.memberAvatarImg} />
                          ) : (
                            <View style={styles.memberAvatarFallback}>
                              <Text style={styles.memberAvatarInitials}>
                                {initialsFromName(m.profiles?.full_name)}
                              </Text>
                            </View>
                          )}
                          <Text style={styles.memberName} numberOfLines={1}>
                            {m.profiles?.full_name ?? 'Member'}
                          </Text>
                          <View style={styles.roleBadge}>
                            <Text style={styles.roleBadgeText}>{m.role}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => {
                    const g = selectedGroup;
                    setSelectedGroup(null);
                    router.push({
                      pathname: '/(tabs)/calendar',
                      params: { groupId: g.id, groupName: g.name },
                    });
                  }}
                  activeOpacity={0.88}
                >
                  <MaterialIcons name="event" size={22} color="#fff" style={{ marginRight: 8 }} />
                  <Text style={styles.modalPrimaryBtnText}>View group events</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setSelectedGroup(null)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCloseBtnText}>Close</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Header ── */}
      <View style={styles.banner}>
        <View style={styles.headerBlock}>
          <Text style={styles.pageTitle}>Groups</Text>
          <TouchableOpacity
            style={styles.headerIconBtnPrimary}
            onPress={() => router.push('/create-group' as never)}
            accessibilityRole="button"
            accessibilityLabel="Create group"
          >
            <MaterialIcons name="add" size={22} color={PRIMARY} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Main content ── */}
      <View style={styles.contentContainer}>
        {/* 2-tab segment */}
        <View style={styles.segmentWrap}>
          {(['my_groups', 'discover'] as const).map((panel) => {
            const labels: Record<PanelType, string> = {
              my_groups: 'Your Groups',
              discover: 'Discover',
            };
            const active = activePanel === panel;
            return (
              <TouchableOpacity
                key={panel}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setActivePanel(panel)}
                activeOpacity={0.85}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {labels[panel]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={fetchGroups} tintColor={PRIMARY} />
          }
        >
          {/* ═══════════════════════════════════════════════════════════════
              PANEL A — YOUR GROUPS
          ═══════════════════════════════════════════════════════════════ */}
          {activePanel === 'my_groups' && (
            <>
              {loading && myGroups.length === 0 ? (
                <View style={styles.loadingBlock}>
                  <ActivityIndicator color={PRIMARY} size="large" />
                </View>
              ) : (
                <>
                  {/* Friend Groups sub-section */}
                  <SectionHeader
                    title="Friend Groups"
                    count={myFriendGroups.length}
                    collapsed={collapsedMyGroups.has('friends')}
                    onToggle={() => setCollapsedMyGroups(prev => {
                      const n = new Set(prev);
                      n.has('friends') ? n.delete('friends') : n.add('friends');
                      return n;
                    })}
                  />
                  {!collapsedMyGroups.has('friends') && (
                    myFriendGroups.length === 0 ? (
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
                          onLeave={!adminGroupIds.has(group.id) ? () => !leavingId && handleLeave(group.id) : undefined}
                          leaving={leavingId === group.id}
                        />
                      ))
                    )
                  )}

                  {/* Campus Groups sub-section */}
                  <SectionHeader
                    title="Campus Groups"
                    count={myCampusGroups.length}
                    topSpacing
                    collapsed={collapsedMyGroups.has('campus')}
                    onToggle={() => setCollapsedMyGroups(prev => {
                      const n = new Set(prev);
                      n.has('campus') ? n.delete('campus') : n.add('campus');
                      return n;
                    })}
                  />
                  {!collapsedMyGroups.has('campus') && (
                    myCampusGroups.length === 0 ? (
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
                          onLeave={!adminGroupIds.has(group.id) ? () => !leavingId && handleLeave(group.id) : undefined}
                          leaving={leavingId === group.id}
                        />
                      ))
                    )
                  )}
                </>
              )}
            </>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              PANEL B — DISCOVER
          ═══════════════════════════════════════════════════════════════ */}
          {activePanel === 'discover' && (
            <>
              {/* Search bar + join-by-code */}
              <View style={styles.searchRow}>
                <View style={styles.searchInputWrap}>
                  <MaterialIcons name="search" size={20} color="#94a3b8" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search groups…"
                    placeholderTextColor="#94a3b8"
                    value={discoverSearch}
                    onChangeText={setDiscoverSearch}
                    returnKeyType="search"
                    clearButtonMode="while-editing"
                  />
                </View>
                <TouchableOpacity
                  style={styles.codeBtn}
                  onPress={() => { setCodeInput(''); setShowCodeModal(true); }}
                  activeOpacity={0.8}
                  accessibilityLabel="Join with code"
                >
                  <MaterialIcons name="key" size={20} color={PRIMARY} />
                </TouchableOpacity>
              </View>

              {/* Type filter chips */}
              <View style={styles.discoverFilterRow}>
                {(['all', 'friends', 'campus'] as const).map(f => {
                  const label = f === 'all' ? 'All' : f === 'friends' ? 'Friend Groups' : 'Campus Groups';
                  const active = discoverFilter === f;
                  return (
                    <TouchableOpacity
                      key={f}
                      style={[styles.discoverFilterChip, active && styles.discoverFilterChipActive]}
                      onPress={() => setDiscoverFilter(f)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.discoverFilterChipText, active && styles.discoverFilterChipTextActive]}>
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {loading && discoverGroups.length === 0 ? (
                <View style={styles.loadingBlock}>
                  <ActivityIndicator color={PRIMARY} size="large" />
                </View>
              ) : noSearchResults ? (
                <EmptyCard
                  icon="search-off"
                  title={`No results for "${discoverSearch.trim()}"`}
                  subtitle="Try a different search term."
                />
              ) : discoverFilter === 'friends' ? (
                /* ── Friend groups only ── */
                discoverFriendGroups.length === 0 ? (
                  <EmptyCard
                    icon="people-outline"
                    title="No friend groups to join"
                    subtitle="All available friend groups will appear here."
                  />
                ) : (
                  <>{discoverFriendGroups.map((group) => (
                    <GroupCard
                      key={group.id}
                      group={group}
                      subtitle={`${group.member_count ?? 0} members`}
                      onJoin={() => handleJoinPress(group)}
                      joinLabel="Join"
                      joinLoading={joiningId === group.id}
                      onPress={() => setSelectedGroup(group)}
                    />
                  ))}</>
                )
              ) : discoverFilter === 'campus' ? (
                /* ── Campus groups only ── */
                discoverCampusGroups.length === 0 ? (
                  <EmptyCard
                    icon="school"
                    title="No campus orgs to join"
                    subtitle="Available campus organizations will appear here."
                  />
                ) : (
                  <>{discoverCampusGroups.map((group) => {
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
                  })}</>
                )
              ) : (
                /* ── All (both sections) ── */
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
                      <SectionHeader title="Campus Groups" count={discoverCampusGroups.length} topSpacing={!hasDiscoverSearch || discoverFriendGroups.length > 0} />
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
      </View>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function SectionHeader({
  title, count, topSpacing, collapsed, onToggle,
}: {
  title: string; count: number; topSpacing?: boolean; collapsed?: boolean; onToggle?: () => void;
}) {
  const inner = (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {count > 0 && (
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>{count}</Text>
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
        style={[styles.sectionHeader, topSpacing && { marginTop: 8 }]}
        onPress={onToggle}
        activeOpacity={0.7}
      >
        {inner}
      </TouchableOpacity>
    );
  }
  return (
    <View style={[styles.sectionHeader, topSpacing && { marginTop: 8 }]}>
      {inner}
    </View>
  );
}

function EmptyCard({ icon, title, subtitle }: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconCircle}>
        <MaterialIcons name={icon} size={30} color="#85b0bf" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0B617E' },
  banner: {
    backgroundColor: '#0B617E',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 10,
    shadowColor: '#04303f',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 1,
  },
  contentContainer: { flex: 1, backgroundColor: '#f5f7f9' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pageTitle: { fontSize: 40, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  headerIconBtnPrimary: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 3,
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#e8edf0',
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 14,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  segmentItemActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  segmentLabel: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  segmentLabelActive: { color: PRIMARY, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  countPill: {
    marginLeft: 8,
    backgroundColor: 'rgba(11, 97, 126, 0.1)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  countPillText: { fontSize: 12, fontWeight: '700', color: PRIMARY },
  loadingBlock: { paddingVertical: 48, alignItems: 'center' },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
    elevation: 1,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(11, 97, 126, 0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#334155', marginBottom: 5 },
  emptySubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 240,
  },
  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 4,
    gap: 10,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
    shadowColor: '#0B617E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 1,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#0f172a', fontWeight: '500', letterSpacing: 0 },
  codeBtn: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: 'rgba(11, 97, 126, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Detail modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    width: '100%',
    maxHeight: '85%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
  },
  modalScrollContent: { paddingBottom: 36 },
  modalHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#d4d8de',
    marginTop: 12,
    marginBottom: 8,
  },
  modalHero: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 20,
    paddingTop: 8,
  },
  modalHeroImage: {
    width: 100,
    height: 100,
    borderRadius: 24,
    backgroundColor: '#f1f5f9',
    marginBottom: 16,
  },
  modalHeroPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 24,
    backgroundColor: 'rgba(11, 97, 126, 0.08)',
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  modalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
  },
  modalBadgeText: { fontSize: 13, fontWeight: '600' },
  modalMetaMuted: { fontSize: 14, color: '#64748b', fontWeight: '500' },
  modalSection: {
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#f8fafb',
    borderRadius: 16,
    padding: 16,
  },
  modalSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  modalBodyText: { fontSize: 15, color: '#334155', lineHeight: 23 },
  modalPlaceholder: { fontSize: 14, color: '#94a3b8', fontStyle: 'italic' },
  modalHintBox: { flexDirection: 'row', alignItems: 'center' },
  modalHintText: { flex: 1, fontSize: 14, color: '#64748b', lineHeight: 20 },
  modalLoading: { paddingVertical: 16, alignItems: 'center' },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#edf1f5',
  },
  memberAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 12,
    backgroundColor: '#e2e8f0',
  },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 14,
    marginRight: 12,
    backgroundColor: 'rgba(11, 97, 126, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitials: { fontSize: 14, fontWeight: '700', color: PRIMARY },
  memberName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#0f172a' },
  roleBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(11, 97, 126, 0.06)',
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: PRIMARY,
    textTransform: 'capitalize',
  },
  modalPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  modalPrimaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  modalCloseBtn: {
    marginHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 14,
  },
  modalCloseBtnText: { fontSize: 16, fontWeight: '600', color: '#64748b' },

  // Discover filter chips
  discoverFilterRow: {
    flexDirection: 'row',
    marginTop: 12,
    marginBottom: 16,
    gap: 8,
  },
  discoverFilterChip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  discoverFilterChipActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
  },
  discoverFilterChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  discoverFilterChipTextActive: {
    color: '#fff',
  },
});
