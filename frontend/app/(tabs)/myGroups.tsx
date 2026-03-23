import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

type GroupType = 'friends' | 'campus_org';
type TabType = 'my_groups' | 'friends' | 'campus_org';

type Group = {
  id: string;
  name: string;
  image_url: string | null;
  type: GroupType;
  member_count?: number;
};

function GroupCard({
  group,
  subtitle,
  showActiveDot,
  onJoin,
  isJoinable,
  joining,
  isAdmin,
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
  isAdmin?: boolean;
  onEdit?: () => void;
  onPress?: () => void;
  onLeave?: () => void;
  leaving?: boolean;
}) {
  const content = (
    <>
      {group.image_url ? (
        <Image source={{ uri: group.image_url }} className="w-[52px] h-[52px] rounded-lg mr-3.5" />
      ) : (
        <View className="w-[52px] h-[52px] rounded-lg bg-gray-300 mr-3.5" />
      )}
      <View className="flex-1">
        <Text className="text-[17px] font-semibold text-black mb-0.5">{group.name}</Text>
        <View className="flex-row items-center">
          {showActiveDot && <View className="w-2 h-2 rounded-full bg-green-500 mr-1.5" />}
          <Text className="text-[13px] text-gray-500">{subtitle}</Text>
        </View>
      </View>
    </>
  );

  return (
    <View className="flex-row items-center border border-gray-200 rounded-xl p-3.5 mb-2.5">
      {onPress ? (
        <TouchableOpacity className="flex-1 flex-row items-center" onPress={onPress} activeOpacity={0.7}>
          {content}
        </TouchableOpacity>
      ) : (
        <View className="flex-1 flex-row items-center">{content}</View>
      )}
      {isAdmin && onEdit && (
        <TouchableOpacity
          className="border border-gray-300 px-4 py-2 rounded-lg mr-2"
          onPress={onEdit}
        >
          <Text className="text-black text-sm font-semibold">Edit</Text>
        </TouchableOpacity>
      )}
      {onLeave && (
        <TouchableOpacity
          className="px-4 py-2 mr-2"
          onPress={onLeave}
          disabled={leaving}
          style={leaving ? { opacity: 0.7 } : undefined}
        >
          {leaving ? (
            <ActivityIndicator size="small" color="#666" />
          ) : (
            <Text className="text-gray-500 text-sm">Leave</Text>
          )}
        </TouchableOpacity>
      )}
      {isJoinable && onJoin && (
        <TouchableOpacity
          className="bg-black px-4 py-2 rounded-lg"
          style={joining ? { opacity: 0.7 } : undefined}
          onPress={onJoin}
          disabled={joining}
        >
          {joining ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text className="text-white text-sm font-semibold">Join</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function MyGroupsScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabType>('my_groups');
  const [myGroups, setMyGroups] = useState<Group[]>([]);
  const [discoverGroups, setDiscoverGroups] = useState<Group[]>([]);
  const [adminGroupIds, setAdminGroupIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [leavingId, setLeavingId] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

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
    setAdminGroupIds(adminIds);

    const { data: allGroups } = await supabase
      .from('groups')
      .select('id, name, image_url, type');

    if (!allGroups) {
      setMyGroups([]);
      setDiscoverGroups([]);
      setLoading(false);
      return;
    }

    let countByGroup: Record<string, number> = {};
    const { data: countRows, error: countError } = await supabase.rpc('get_group_member_counts');
    if (!countError && countRows) {
      countByGroup = countRows.reduce<Record<string, number>>((acc, row) => {
        acc[row.group_id] = Number(row.member_count ?? 0);
        return acc;
      }, {});
    } else {
      const { data: memberCounts } = await supabase.from('group_members').select('group_id');
      countByGroup = (memberCounts ?? []).reduce<Record<string, number>>((acc, row) => {
        acc[row.group_id] = (acc[row.group_id] ?? 0) + 1;
        return acc;
      }, {});
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
          className="flex-1 bg-black/50 justify-center items-center px-6"
          onPress={() => setSelectedGroup(null)}
        >
          <Pressable
            className="bg-white rounded-2xl p-6 items-center w-full max-w-[320px]"
            onPress={(e) => e.stopPropagation()}
          >
            {selectedGroup && (
              <>
                {selectedGroup.image_url ? (
                  <Image
                    source={{ uri: selectedGroup.image_url }}
                    className="w-[120px] h-[120px] rounded-xl mb-4"
                  />
                ) : (
                  <View className="w-[120px] h-[120px] rounded-xl bg-gray-300 mb-4" />
                )}
                <Text className="text-xl font-bold text-black text-center mb-1">
                  {selectedGroup.name}
                </Text>
                <Text className="text-sm text-gray-500 mb-4">
                  {selectedGroup.member_count ?? 0} Members
                </Text>
                <TouchableOpacity
                  className="bg-black px-6 py-3 rounded-xl"
                  onPress={() => setSelectedGroup(null)}
                >
                  <Text className="text-white font-semibold">Close</Text>
                </TouchableOpacity>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
      <ScrollView
        className="flex-1 bg-white"
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={fetchGroups} />
        }
      >
        <View className="flex-row items-center justify-between mt-4 mb-4">
          <Text className="text-[34px] font-bold text-black">Groups</Text>
          <TouchableOpacity
            className="w-11 h-11 rounded-full bg-gray-200 items-center justify-center"
            onPress={() => router.push('/create-group' as never)}
          >
            <MaterialIcons name="add" size={28} color="#000" />
          </TouchableOpacity>
        </View>

        <View className="flex-row bg-gray-200 rounded-[10px] p-0.5 mb-6">
          <TouchableOpacity
            className={`flex-1 py-2 items-center rounded-lg ${activeTab === 'my_groups' ? 'bg-white' : ''}`}
            style={activeTab === 'my_groups' ? tabActiveStyle : undefined}
            onPress={() => setActiveTab('my_groups')}
          >
            <Text className={`text-sm font-medium ${activeTab === 'my_groups' ? 'text-black font-semibold' : 'text-gray-500'}`}>
              My Groups
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 py-2 items-center rounded-lg ${activeTab === 'friends' ? 'bg-white' : ''}`}
            style={activeTab === 'friends' ? tabActiveStyle : undefined}
            onPress={() => setActiveTab('friends')}
          >
            <Text className={`text-sm font-medium ${activeTab === 'friends' ? 'text-black font-semibold' : 'text-gray-500'}`}>
              Friends
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className={`flex-1 py-2 items-center rounded-lg ${activeTab === 'campus_org' ? 'bg-white' : ''}`}
            style={activeTab === 'campus_org' ? tabActiveStyle : undefined}
            onPress={() => setActiveTab('campus_org')}
          >
            <Text className={`text-sm font-medium ${activeTab === 'campus_org' ? 'text-black font-semibold' : 'text-gray-500'}`}>
              Campus Orgs
            </Text>
          </TouchableOpacity>
        </View>

        <Text className="text-[13px] font-semibold text-gray-500 tracking-wide mb-3">YOUR GROUPS</Text>
        {loading && myGroups.length === 0 ? (
          <ActivityIndicator className="my-6" color="#000" />
        ) : filteredMyGroups.length === 0 ? (
          <Text className="text-sm text-gray-400 mb-4">No groups yet</Text>
        ) : (
          filteredMyGroups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              subtitle={`${group.member_count ?? 0} Members`}
              isAdmin={adminGroupIds.has(group.id)}
              onEdit={() => router.push(`/edit-group/${group.id}` as never)}
              onPress={() => setSelectedGroup(group)}
              onLeave={!adminGroupIds.has(group.id) ? () => !leavingId && handleLeave(group.id) : undefined}
              leaving={leavingId === group.id}
            />
          ))
        )}

        <Text className="text-[13px] font-semibold text-gray-500 tracking-wide mb-3">INVITES</Text>
        {filteredDiscover.length === 0 ? (
          <Text className="text-sm text-gray-400 mb-4">No groups to join</Text>
        ) : (
          filteredDiscover.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              subtitle={`${group.member_count ?? 0} Members`}
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

const tabActiveStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.1,
  shadowRadius: 2,
  elevation: 2,
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
});
