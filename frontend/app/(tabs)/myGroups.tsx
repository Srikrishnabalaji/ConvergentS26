import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

type GroupType = 'friends' | 'campus_org';
type TabType = 'my_groups' | 'friends' | 'campus_org';

type Group = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  type: GroupType;
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

function GroupCard({
  group,
  subtitle,
  showActiveDot,
  onJoin,
  isJoinable,
  joining,
  canEdit,
  onEdit,
  onPress,
  onLeave,
  leaving,
}: {
  group: Group;
  subtitle: string;
  showActiveDot?: boolean;
  onJoin?: () => void;
  isJoinable?: boolean;
  joining?: boolean;
  canEdit?: boolean;
  onEdit?: () => void;
  onPress?: () => void;
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const typeLabel = group.type === 'campus_org' ? 'Campus' : 'Friends';
  const metaLine = `${typeLabel} · ${subtitle}`;

  const hasActions =
    (canEdit && onEdit) || onLeave || (isJoinable && onJoin);

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
        <Text style={cardStyles.cardTitle} numberOfLines={2}>
          {group.name}
        </Text>
        <View style={cardStyles.metaRow}>
          {showActiveDot && <View style={cardStyles.activeDot} />}
          <Text style={cardStyles.cardMeta}>{metaLine}</Text>
        </View>
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

          {hasActions ? (
            <View style={cardStyles.actionsInline}>
              {canEdit && onEdit && (
                <TouchableOpacity
                  style={cardStyles.btnCompact}
                  onPress={onEdit}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Edit group"
                >
                  <MaterialIcons name="edit" size={15} color={PRIMARY} style={{ marginRight: 3 }} />
                  <Text style={cardStyles.btnCompactText}>Edit</Text>
                </TouchableOpacity>
              )}
              {onLeave && (
                <TouchableOpacity
                  style={[
                    cardStyles.btnCompact,
                    cardStyles.btnCompactLeave,
                    canEdit && onEdit && { marginLeft: 6 },
                  ]}
                  onPress={onLeave}
                  disabled={leaving}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Leave group"
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
              {isJoinable && onJoin && (
                <TouchableOpacity
                  style={[
                    cardStyles.btnCompactJoin,
                    ((canEdit && onEdit) || onLeave) && { marginLeft: 6 },
                    joining && { opacity: 0.65 },
                  ]}
                  onPress={onJoin}
                  disabled={joining}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Join group"
                >
                  {joining ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <MaterialIcons name="group-add" size={15} color="#fff" style={{ marginRight: 4 }} />
                      <Text style={cardStyles.btnCompactJoinText}>Join</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const cardStyles = StyleSheet.create({
  cardWrap: {
    backgroundColor: '#fff',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e8eef2',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
    overflow: 'hidden',
  },
  cardMain: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  cardMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTouchableLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    marginRight: 8,
  },
  cardTextCol: {
    flex: 1,
    minWidth: 0,
  },
  actionsInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    alignSelf: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: PRIMARY,
    marginBottom: 4,
    lineHeight: 21,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  activeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: PRIMARY,
    marginRight: 6,
  },
  cardMeta: {
    fontSize: 12,
    color: '#94a3b8',
    flex: 1,
  },
  avatarImg: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: '#f1f5f9',
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#eef2f6',
  },
  btnCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  btnCompactText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: '600',
  },
  btnCompactLeave: {
    borderColor: '#fecaca',
    backgroundColor: '#fffafa',
  },
  btnCompactLeaveText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
  },
  btnCompactJoin: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: PRIMARY,
  },
  btnCompactJoinText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default function MyGroupsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('my_groups');
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<Group[]>([]);
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());
  const [editorGroupIds, setEditorGroupIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [detailMembers, setDetailMembers] = useState<DetailMember[]>([]);
  const [detailMembersLoading, setDetailMembersLoading] = useState(false);

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
      setDetailMembersLoading(false);
      const byId = new Map((profs ?? []).map((p) => [p.id, p]));
      const merged: DetailMember[] = rows.map((r) => {
        const p = byId.get(r.user_id);
        return {
          user_id: r.user_id,
          role: r.role,
          profiles: p
            ? { full_name: p.full_name, avatar_url: p.avatar_url }
            : null,
        };
      });
      const order: Record<string, number> = { admin: 0, editor: 1, member: 2 };
      merged.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
      setDetailMembers(merged);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedGroup, isMemberOfSelected]);

  const fetchGroups = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: memberRows } = await supabase
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', user.id);
    const myGroupIds = new Set((memberRows ?? []).map((r) => r.group_id));
    const adminIds = new Set(
      (memberRows ?? []).filter((r) => r.role === 'admin').map((r) => r.group_id)
    );
    const editorIds = new Set(
      (memberRows ?? []).filter((r) => r.role === 'editor').map((r) => r.group_id)
    );
    setAdminGroupIds(adminIds);
    setEditorGroupIds(editorIds);

    const { data: allGroups } = await supabase
      .from('groups')
      .select('id, name, description, image_url, type');

    if (!allGroups) {
      setMyGroups([]);
      setDiscoverGroups([]);
      setLoading(false);
      return;
    }

    let countByGroup: Record<string, number> = {};
    const { data: countRows, error: countError } = await supabase.rpc('get_group_member_counts');
    if (!countError && countRows) {
      countByGroup = countRows.reduce(
        (acc: Record<string, number>, row: { group_id: string; member_count: unknown }) => {
          acc[row.group_id] = Number(row.member_count ?? 0);
          return acc;
        },
        {}
      );
    } else {
      const { data: memberCounts } = await supabase.from('group_members').select('group_id');
      countByGroup = (memberCounts ?? []).reduce(
        (acc: Record<string, number>, row: { group_id: string }) => {
          acc[row.group_id] = (acc[row.group_id] ?? 0) + 1;
          return acc;
        },
        {}
      );
    }

    const withCounts = allGroups.map((g) => ({
      ...g,
      member_count: countByGroup[g.id] ?? 0,
    }));

    const mine = withCounts.filter((g) => myGroupIds.has(g.id));
    const discover = withCounts.filter((g) => !myGroupIds.has(g.id));

    setMyGroups(mine);
    setDiscoverGroups(discover);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchGroups();
    }, [fetchGroups])
  );

  async function handleJoin(groupId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setJoiningId(groupId);
    const { error } = await supabase.from('group_members').insert({
      group_id: groupId,
      user_id: user.id,
      role: 'member',
    });
    setJoiningId(null);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      fetchGroups();
    }
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

  const filteredMyGroups =
    activeTab === 'my_groups'
      ? myGroups
      : myGroups.filter((g) => g.type === activeTab);
  const filteredDiscover =
    activeTab === 'my_groups'
      ? discoverGroups
      : discoverGroups.filter((g) => g.type === activeTab);

  return (
    <SafeAreaView style={styles.safeArea}>
      <Modal
        visible={!!selectedGroup}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedGroup(null)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setSelectedGroup(null)}
        >
          <Pressable
            style={styles.modalSheet}
            onPress={(e) => e.stopPropagation()}
          >
            {selectedGroup && (
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                <View style={styles.modalHandle} />
                <View style={styles.modalHero}>
                  {selectedGroup.image_url ? (
                    <Image
                      source={{ uri: selectedGroup.image_url }}
                      style={styles.modalHeroImage}
                    />
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
                        { marginRight: 10, marginBottom: 4 },
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
                      <Text style={styles.modalHintText}>
                        Join this group to see who is in it.
                      </Text>
                    </View>
                  ) : detailMembersLoading ? (
                    <View style={styles.modalLoading}>
                      <ActivityIndicator color={PRIMARY} />
                    </View>
                  ) : detailMembers.length === 0 ? (
                    <Text style={styles.modalPlaceholder}>No members loaded.</Text>
                  ) : (
                    <View style={styles.memberList}>
                      {detailMembers.map((m, index) => (
                        <View
                          key={m.user_id}
                          style={[
                            styles.memberRow,
                            index === detailMembers.length - 1 && { borderBottomWidth: 0 },
                          ]}
                        >
                          {m.profiles?.avatar_url ? (
                            <Image
                              source={{ uri: m.profiles.avatar_url }}
                              style={styles.memberAvatarImg}
                            />
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
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchGroups} tintColor={PRIMARY} />
        }
      >
        <View style={styles.headerBlock}>
          <View>
            <Text style={styles.pageTitle}>Groups</Text>
            <Text style={styles.pageSubtitle}>Communities you&apos;re in and discover</Text>
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerIconBtn}
              onPress={() => router.push('/(tabs)/friends' as never)}
              accessibilityRole="button"
              accessibilityLabel="Friends"
              accessibilityHint="Opens your friends list"
            >
              <MaterialIcons name="groups" size={22} color={PRIMARY} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIconBtnPrimary}
              onPress={() => router.push('/create-group' as never)}
              accessibilityRole="button"
              accessibilityLabel="Create group"
              accessibilityHint="Starts creating a new group"
            >
              <MaterialIcons name="add" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.segmentWrap}>
          {(['my_groups', 'friends', 'campus_org'] as const).map((tab) => {
            const labels = {
              my_groups: 'All',
              friends: 'Friends',
              campus_org: 'Campus',
            };
            const active = activeTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.segmentItem, active && styles.segmentItemActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.85}
              >
                <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>
                  {labels[tab]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Your groups</Text>
          {!loading && filteredMyGroups.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{filteredMyGroups.length}</Text>
            </View>
          ) : null}
        </View>
        {loading && myGroups.length === 0 ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color={PRIMARY} size="large" />
          </View>
        ) : filteredMyGroups.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="groups" size={32} color="#cbd5e1" />
            </View>
            <Text style={styles.emptyTitle}>No groups yet</Text>
            <Text style={styles.emptySubtitle}>
              Create a group with the + button or browse invites below.
            </Text>
          </View>
        ) : (
          filteredMyGroups.map((group) => (
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
        )}

        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>Discover</Text>
          {!loading && filteredDiscover.length > 0 ? (
            <View style={styles.countPill}>
              <Text style={styles.countPillText}>{filteredDiscover.length}</Text>
            </View>
          ) : null}
        </View>
        {filteredDiscover.length === 0 ? (
          <View style={styles.emptyCard}>
            <View style={styles.emptyIconCircle}>
              <MaterialIcons name="explore" size={30} color="#cbd5e1" />
            </View>
            <Text style={styles.emptyTitle}>Nothing to join</Text>
            <Text style={styles.emptySubtitle}>
              When new groups are available, they will show up here.
            </Text>
          </View>
        ) : (
          filteredDiscover.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              subtitle={`${group.member_count ?? 0} members`}
              isJoinable
              onJoin={() => !joiningId && handleJoin(group.id)}
              joining={joiningId === group.id}
              onPress={() => setSelectedGroup(group)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#f4f7f9',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
  },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
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
    maxWidth: 220,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  headerIconBtnPrimary: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  segmentWrap: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 14,
    padding: 4,
    marginBottom: 24,
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
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  segmentLabelActive: {
    color: PRIMARY,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  countPill: {
    marginLeft: 8,
    backgroundColor: 'rgba(11, 97, 126, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countPillText: {
    fontSize: 12,
    fontWeight: '700',
    color: PRIMARY,
  },
  loadingBlock: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e8eef2',
    borderStyle: 'dashed',
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 260,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderRadius: 20,
    width: '100%',
    maxWidth: 360,
    maxHeight: '88%',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 12,
  },
  modalScrollContent: {
    paddingBottom: 28,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#e2e8f0',
    marginTop: 10,
    marginBottom: 6,
  },
  modalHero: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  modalHeroImage: {
    width: 112,
    height: 112,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    marginBottom: 14,
  },
  modalHeroPlaceholder: {
    width: 112,
    height: 112,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    marginBottom: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: PRIMARY,
    textAlign: 'center',
    marginBottom: 10,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  modalBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  modalBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modalMetaMuted: {
    fontSize: 14,
    color: '#64748b',
  },
  modalSection: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  modalSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  modalBodyText: {
    fontSize: 15,
    color: '#334155',
    lineHeight: 22,
  },
  modalPlaceholder: {
    fontSize: 14,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  modalHintBox: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  modalHintText: {
    flex: 1,
    fontSize: 14,
    color: '#64748b',
    lineHeight: 20,
  },
  modalLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  memberList: {},
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e8f0',
  },
  memberAvatarImg: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: '#e2e8f0',
  },
  memberAvatarFallback: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: 'rgba(11, 97, 126, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarInitials: {
    fontSize: 13,
    fontWeight: '700',
    color: PRIMARY,
  },
  memberName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: '#0f172a',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'capitalize',
  },
  modalPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PRIMARY,
    marginHorizontal: 16,
    paddingVertical: 15,
    borderRadius: 14,
    marginBottom: 10,
  },
  modalPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  modalCloseBtn: {
    marginHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#64748b',
  },
});
