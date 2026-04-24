import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
  ScrollView,
  Clipboard,
  StyleSheet,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { Button, TextField, SectionLabel, Avatar, initialsFromName } from '@/components/ui';
import { shadows } from '@/constants/shadows';

const PRIMARY_HEX = '#0B617E';

type MemberRole = 'admin' | 'editor' | 'member';

type MemberRow = {
  user_id: string;
  role: MemberRole;
  joined_at: string | null;
  profiles: { full_name: string | null } | null;
};

type JoinRequest = {
  id: string;
  user_id: string;
  full_name: string | null;
  created_at: string;
};

type SentInvite = {
  invite_id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

type SearchedUser = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  const [enablePassword, setEnablePassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');
  const [hadJoinPasswordOnLoad, setHadJoinPasswordOnLoad] = useState(false);

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [regeneratingCode, setRegeneratingCode] = useState(false);

  const [loading, setLoading] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  
  // Member Management Modal State
  const [showMembersModal, setShowMembersModal] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [handlingRequestId, setHandlingRequestId] = useState<string | null>(null);

  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);
  const [loadingSentInvites, setLoadingSentInvites] = useState(false);
  const [revokingInviteId, setRevokingInviteId] = useState<string | null>(null);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteSearchResults, setInviteSearchResults] = useState<SearchedUser[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [invitingUserId, setInvitingUserId] = useState<string | null>(null);

  const isEditorOnly = myRole === 'editor';
  const isAdmin = myRole === 'admin';

  const originalAdminId = useMemo(() => {
    const admins = members
      .filter((m) => m.role === 'admin' && m.joined_at != null)
      .sort((a, b) => (a.joined_at! < b.joined_at! ? -1 : 1));
    return admins[0]?.user_id ?? null;
  }, [members]);

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) =>
      (m.profiles?.full_name ?? 'Member').toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const showPasswordOption = isAdmin && !isPrivate && !isCampusOrg;
  const showJoinCode = isAdmin && isPrivate;
  const showJoinRequests = isAdmin && isCampusOrg;

  const loadMembers = useCallback(async (groupId: string) => {
    setLoadingMembers(true);
    const { data: rows, error: e1 } = await supabase
      .from('group_members')
      .select('user_id, role, joined_at')
      .eq('group_id', groupId);
    if (e1 || !rows?.length) {
      setLoadingMembers(false);
      setMembers([]);
      return;
    }
    const ids = rows.map((r) => r.user_id);
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', ids);
    setLoadingMembers(false);
    const byId = new Map((profs ?? []).map((p) => [p.id, p]));
    const merged: MemberRow[] = rows.map((r) => ({
      user_id: r.user_id,
      role: r.role as MemberRole,
      joined_at: r.joined_at ?? null,
      profiles: byId.get(r.user_id) ? { full_name: byId.get(r.user_id)!.full_name } : null,
    }));
    const order = { admin: 0, editor: 1, member: 2 };
    merged.sort((a, b) => (order[a.role] ?? 3) - (order[b.role] ?? 3));
    setMembers(merged);
  }, []);

  const loadJoinRequests = useCallback(async (groupId: string) => {
    setLoadingRequests(true);
    const { data } = await supabase.rpc('get_group_join_requests', { p_group_id: groupId });
    setLoadingRequests(false);
    setJoinRequests(
      (data ?? []).map((r: { id: string; user_id: string; full_name: string | null; created_at: string }) => ({
        id: r.id,
        user_id: r.user_id,
        full_name: r.full_name,
        created_at: r.created_at,
      })),
    );
  }, []);

  const loadSentInvites = useCallback(async (groupId: string) => {
    setLoadingSentInvites(true);
    const { data } = await supabase.rpc('get_group_invites', { p_group_id: groupId });
    setLoadingSentInvites(false);
    setSentInvites(
      (data ?? []).map((r: SentInvite) => ({
        invite_id: r.invite_id,
        user_id: r.user_id,
        full_name: r.full_name,
        avatar_url: r.avatar_url,
        created_at: r.created_at,
      })),
    );
  }, []);

  useEffect(() => {
    if (!id) { router.back(); return; }
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyUserId(user?.id ?? null);

      const { data: groupRow, error: gErr } = await supabase
        .from('groups')
        .select('id, name, description, image_url, type, is_private, has_join_password, join_code')
        .eq('id', id)
        .single();

      if (gErr || !groupRow) {
        setLoadingGroup(false);
        Alert.alert('Error', 'Could not load group.');
        router.back();
        return;
      }

      const { data: roleRow } = await supabase
        .from('group_members')
        .select('role')
        .eq('group_id', id)
        .eq('user_id', user?.id ?? '')
        .maybeSingle();

      const role = (roleRow?.role as MemberRole | undefined) ?? null;
      setMyRole(role);

      if (role !== 'admin' && role !== 'editor') {
        setLoadingGroup(false);
        Alert.alert('Access denied', 'Only group admins and editors can edit this group.');
        router.back();
        return;
      }

      setName(groupRow.name);
      setDescription(groupRow.description ?? '');
      setIsCampusOrg(groupRow.type === 'campus_org');
      setIsPrivate(groupRow.is_private ?? false);
      const hadPwd = groupRow.has_join_password ?? false;
      setHadJoinPasswordOnLoad(hadPwd);
      setEnablePassword(hadPwd);
      setPasswordValue('');
      setJoinCode(groupRow.join_code ?? null);
      if (groupRow.image_url) setImageUri(groupRow.image_url);

      if (role === 'admin') {
        await Promise.all([
          loadMembers(id),
          loadSentInvites(id),
          groupRow.type === 'campus_org' ? loadJoinRequests(id) : Promise.resolve(),
        ]);
      }

      setLoadingGroup(false);
    })();
  }, [id, loadMembers, loadJoinRequests, loadSentInvites, router]);

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Allow access to your photos to add a group image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
      base64: true,
    });
    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
      setImageBase64(result.assets[0].base64 ?? null);
    }
  }

  async function setMemberRole(targetUserId: string, role: MemberRole) {
    if (!id) return;
    const { error } = await supabase
      .from('group_members')
      .update({ role })
      .eq('group_id', id)
      .eq('user_id', targetUserId);
    if (error) {
      Alert.alert('Could not update role', error.message);
      return;
    }
    loadMembers(id);
  }

  async function removeMember(targetUserId: string) {
    if (!id) return;
    Alert.alert(
      'Remove Member',
      'Are you sure you want to remove this member from the group?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase
              .from('group_members')
              .delete()
              .eq('group_id', id)
              .eq('user_id', targetUserId);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              loadMembers(id);
            }
          },
        },
      ]
    );
  }

  useEffect(() => {
    if (!showInviteModal || !id) {
      setInviteSearchResults([]);
      return;
    }
    const q = inviteSearch.trim();
    if (!q) {
      setInviteSearchResults([]);
      setInviteSearching(false);
      return;
    }
    setInviteSearching(true);
    let cancelled = false;
    const handle = setTimeout(async () => {
      const { data } = await supabase.rpc('search_users_for_invite', {
        p_group_id: id,
        p_query: q,
      });
      if (cancelled) return;
      setInviteSearching(false);
      setInviteSearchResults((data ?? []) as SearchedUser[]);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [inviteSearch, showInviteModal, id]);

  async function handleSendInvite(targetUserId: string) {
    if (!id) return;
    setInvitingUserId(targetUserId);
    const { data, error } = await supabase.rpc('invite_user_to_group', {
      p_group_id: id,
      p_user_id: targetUserId,
    });
    setInvitingUserId(null);
    if (error || data?.error) {
      const msg =
        data?.error === 'already_member' ? 'That user is already a member.' :
        data?.error === 'already_invited' ? 'That user already has a pending invite.' :
        data?.error === 'cannot_invite_self' ? 'You cannot invite yourself.' :
        data?.error === 'not_authorized' ? 'Only admins can invite members.' :
        error?.message ?? 'Could not send invite.';
      Alert.alert('Error', msg);
      return;
    }
    setInviteSearchResults((prev) => prev.filter((u) => u.user_id !== targetUserId));
    loadSentInvites(id);
  }

  async function handleRevokeInvite(inviteId: string) {
    if (!id) return;
    setRevokingInviteId(inviteId);
    const { data, error } = await supabase.rpc('revoke_group_invite', {
      p_invite_id: inviteId,
    });
    setRevokingInviteId(null);
    if (error || data?.error) {
      Alert.alert('Error', error?.message ?? data?.error ?? 'Could not revoke invite.');
      return;
    }
    setSentInvites((prev) => prev.filter((i) => i.invite_id !== inviteId));
  }

  async function handleJoinRequest(requestId: string, action: 'approve' | 'decline') {
    setHandlingRequestId(requestId);
    const { data, error } = await supabase.rpc('handle_join_request', {
      p_request_id: requestId,
      p_action: action,
    });
    setHandlingRequestId(null);
    if (error || data?.error) {
      Alert.alert('Error', error?.message ?? data?.error ?? 'Could not process request.');
    } else {
      loadJoinRequests(id!);
      if (action === 'approve') loadMembers(id!);
    }
  }

  async function handleRegenerateCode() {
    Alert.alert(
      'Regenerate Code',
      'This will invalidate the current code. Anyone who had it can no longer use it to join. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          onPress: async () => {
            setRegeneratingCode(true);
            const { data, error } = await supabase.rpc('regenerate_group_join_code', { p_group_id: id });
            setRegeneratingCode(false);
            if (error || data?.error) {
              Alert.alert('Error', error?.message ?? data?.error ?? 'Could not regenerate code.');
            } else {
              setJoinCode(data.join_code);
            }
          },
        },
      ],
    );
  }

  async function handleSave() {
    if (!id || !name.trim()) {
      Alert.alert('Error', 'Please enter a group name.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Error', 'You must be signed in to edit a group.');
      return;
    }

    if (isEditorOnly) {
      setLoading(true);
      const { error } = await supabase
        .from('groups')
        .update({ description: description.trim() || null })
        .eq('id', id);
      setLoading(false);
      if (error) { Alert.alert('Failed to save', error.message); return; }
      router.back();
      return;
    }

    if (showPasswordOption && enablePassword && !passwordValue.trim() && !hadJoinPasswordOnLoad) {
      Alert.alert('Error', 'Please enter a join password or disable the password option.');
      return;
    }

    setLoading(true);
    let imageUrl: string | null = null;

    try {
      if (imageUri && imageBase64) {
        const ext = 'jpg';
        const path = `${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('group-images')
          .upload(path, decode(imageBase64), { contentType: `image/${ext}`, upsert: false });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('group-images').getPublicUrl(path);
          imageUrl = urlData.publicUrl;
        }
      }

      const type = isCampusOrg ? 'campus_org' : 'friends';
      const friendsUnlocked = !isPrivate && type === 'friends';
      let joinPasswordUpdate: string | null | undefined;
      if (!friendsUnlocked || !enablePassword) {
        joinPasswordUpdate = null;
      } else if (passwordValue.trim()) {
        joinPasswordUpdate = passwordValue.trim();
      } else {
        joinPasswordUpdate = undefined;
      }

      const updatePayload: Record<string, unknown> = {
        name: name.trim(),
        type,
        description: description.trim() || null,
        is_private: isPrivate,
      };
      if (joinPasswordUpdate !== undefined) {
        updatePayload.join_password = joinPasswordUpdate;
      }
      if (imageUrl !== null) updatePayload.image_url = imageUrl;

      const { error: updateError } = await supabase.from('groups').update(updatePayload).eq('id', id);

      if (updateError) {
        Alert.alert('Failed to update group', updateError.message);
        setLoading(false);
        return;
      }

      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLeave() {
    if (!id || !myUserId) return;

    if (isAdmin) {
      const { data: adminMembers } = await supabase
        .from('group_members')
        .select('user_id')
        .eq('group_id', id)
        .eq('role', 'admin');

      if ((adminMembers?.length ?? 0) <= 1) {
        Alert.alert(
          'Assign an admin first',
          'You are the only admin. Please assign another member as admin before leaving.',
        );
        return;
      }
    }

    Alert.alert('Leave Group', 'Are you sure you want to leave this group?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          setLeaving(true);
          const { error } = await supabase
            .from('group_members')
            .delete()
            .eq('group_id', id)
            .eq('user_id', myUserId);
          setLeaving(false);
          if (error) Alert.alert('Error', error.message);
          else router.back();
        },
      },
    ]);
  }

  async function handleDelete() {
    if (!id) return;
    Alert.alert(
      'Delete Group',
      'Are you sure you want to delete this group? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            const { error } = await supabase.from('groups').delete().eq('id', id);
            setDeleting(false);
            if (error) Alert.alert('Error', error.message);
            else router.back();
          },
        },
      ],
    );
  }

  const openMemberOptions = (m: MemberRow) => {
    const isMe = m.user_id === myUserId;
    const canMakeAdmin = myRole === 'admin' && !isMe && m.role === 'member';
    const canRemoveAdmin = myRole === 'admin' && myUserId === originalAdminId && !isMe && (m.role === 'admin' || m.role === 'editor');
    const canRemoveMember = myRole === 'admin' && !isMe;

    if (!canMakeAdmin && !canRemoveAdmin && !canRemoveMember) return;

    const options: any[] = [];

    if (canMakeAdmin) {
      options.push({ text: 'Make admin', onPress: () => setMemberRole(m.user_id, 'admin') });
    }
    if (canRemoveAdmin) {
      options.push({ text: 'Revoke admin', onPress: () => setMemberRole(m.user_id, 'member') });
    }
    if (canRemoveMember) {
      options.push({ text: 'Remove from group', style: 'destructive', onPress: () => removeMember(m.user_id) });
    }
    
    options.push({ text: 'Cancel', style: 'cancel' });

    Alert.alert(
      m.profiles?.full_name ?? 'Member',
      'Manage group member',
      options
    );
  };

  if (loadingGroup) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={PRIMARY_HEX} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        className="flex-1"
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View className="flex-row items-center justify-between mb-5">
          <TouchableOpacity onPress={() => router.back()} className="p-1 -ml-1">
            <MaterialIcons name="close" size={28} color={PRIMARY_HEX} />
          </TouchableOpacity>
          <Text className="text-xl font-semibold text-primary">
            {isEditorOnly ? 'Edit description' : 'Edit Group'}
          </Text>
          <View className="w-9" />
        </View>

        {!isEditorOnly && (
          <>
            <TouchableOpacity
              className="w-[100px] h-[100px] rounded-[20px] bg-surface-alt items-center justify-center self-center mb-5 overflow-hidden"
              onPress={pickImage}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} className="w-full h-full" />
              ) : (
                <>
                  <MaterialIcons name="add-a-photo" size={32} color="#94a3b8" />
                  <Text className="text-[11px] text-ink-muted mt-1 font-medium">Change photo</Text>
                </>
              )}
            </TouchableOpacity>

            <TextField
              label="Group name"
              placeholder="e.g. Calc Study Group"
              value={name}
              onChangeText={setName}
              containerClassName="mb-4"
            />
          </>
        )}

        <View className="mb-4 gap-1.5">
          <Text className="text-sm font-semibold text-ink-body">Description</Text>
          {isEditorOnly && (
            <Text className="text-xs text-ink-muted leading-[17px]">
              Editors can update the group description.
            </Text>
          )}
          <TextField
            placeholder="What is this group about?"
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
            inputClassName="min-h-[110px] pt-3"
          />
        </View>

        {!isEditorOnly && (
          <>
            <SectionLabel className="mb-1 mt-2">GROUP SETTINGS</SectionLabel>

            <ToggleRow
              title="Campus organization"
              subtitle="New members must be approved by an admin"
              value={isCampusOrg}
              onValueChange={(val) => {
                setIsCampusOrg(val);
                if (val) { setEnablePassword(false); setPasswordValue(''); }
              }}
            />

            <ToggleRow
              title="Private group"
              subtitle="Hidden from Discover — members join with a code"
              value={isPrivate}
              onValueChange={(val) => {
                setIsPrivate(val);
                if (val) { setEnablePassword(false); setPasswordValue(''); }
              }}
            />

            {showJoinCode && (
              <View className="bg-primary/10 rounded-2xl p-4 mt-3 mb-1">
                <View className="flex-row items-center mb-1">
                  <MaterialIcons name="key" size={17} color={PRIMARY_HEX} style={{ marginRight: 7 }} />
                  <Text className="text-sm font-bold text-primary">Join Code</Text>
                </View>
                <Text className="text-[13px] text-ink-muted leading-[18px] mb-3.5">
                  Share this code with people you want to invite. Only the code-holder can join.
                </Text>
                <View className="flex-row items-center justify-between bg-white rounded-[10px] px-3.5 py-2.5">
                  <Text className="text-[22px] font-extrabold text-primary tracking-[4px]" selectable>
                    {joinCode ?? '—'}
                  </Text>
                  <View className="flex-row gap-2">
                    {joinCode && (
                      <TouchableOpacity
                        className="w-[34px] h-[34px] rounded-[9px] bg-primary/10 items-center justify-center"
                        onPress={() => {
                          Clipboard.setString(joinCode);
                          Alert.alert('Copied', 'Join code copied to clipboard.');
                        }}
                      >
                        <MaterialIcons name="content-copy" size={16} color={PRIMARY_HEX} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      className="w-[34px] h-[34px] rounded-[9px] bg-primary/10 items-center justify-center"
                      style={regeneratingCode ? { opacity: 0.6 } : undefined}
                      onPress={handleRegenerateCode}
                      disabled={regeneratingCode}
                    >
                      {regeneratingCode ? (
                        <ActivityIndicator size="small" color={PRIMARY_HEX} />
                      ) : (
                        <MaterialIcons name="refresh" size={16} color={PRIMARY_HEX} />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
                {!joinCode && (
                  <Text className="text-xs text-ink-muted mt-2.5 italic">
                    Save the group to generate a code (toggle Private on and save).
                  </Text>
                )}
              </View>
            )}

            {showPasswordOption && (
              <>
                <ToggleRow
                  title="Require a password to join"
                  subtitle="Members must enter a password you set"
                  value={enablePassword}
                  onValueChange={(val) => {
                    setEnablePassword(val);
                    if (!val) setPasswordValue('');
                  }}
                />
                {enablePassword && (
                  <TextField
                    label="Join password"
                    placeholder={
                      hadJoinPasswordOnLoad
                        ? 'Enter a new password to change it (leave blank to keep current)'
                        : 'Password members must enter to join'
                    }
                    value={passwordValue}
                    onChangeText={setPasswordValue}
                    autoCapitalize="none"
                    containerClassName="mt-1"
                  />
                )}
              </>
            )}

            {showJoinRequests && (
              <>
                <SectionLabel className="mt-6 mb-1">
                  {`JOIN REQUESTS${joinRequests.length > 0 ? ` (${joinRequests.length})` : ''}`}
                </SectionLabel>
                {loadingRequests ? (
                  <View className="py-4 items-center">
                    <ActivityIndicator color={PRIMARY_HEX} />
                  </View>
                ) : joinRequests.length === 0 ? (
                  <View className="bg-surface-subtle rounded-xl py-5 items-center mb-2">
                    <MaterialIcons name="check-circle-outline" size={24} color="#94a3b8" style={{ marginBottom: 6 }} />
                    <Text className="text-sm text-ink-muted font-medium">No pending requests</Text>
                  </View>
                ) : (
                  <View className="border border-line-neutral rounded-2xl overflow-hidden mb-2">
                    {joinRequests.map((req) => (
                      <View key={req.id} className="flex-row items-center px-3.5 py-3 border-b border-line-muted/40 bg-white">
                        <Avatar name={req.full_name} size="md" className="mr-3" />
                        <Text className="flex-1 text-[15px] font-medium text-ink-strong" numberOfLines={1}>
                          {req.full_name ?? 'Unknown user'}
                        </Text>
                        <View className="flex-row gap-2">
                          <TouchableOpacity
                            className="w-[34px] h-[34px] rounded-[10px] items-center justify-center bg-danger/10"
                            onPress={() => handleJoinRequest(req.id, 'decline')}
                            disabled={handlingRequestId === req.id}
                          >
                            {handlingRequestId === req.id ? (
                              <ActivityIndicator size="small" color="#dc2626" />
                            ) : (
                              <MaterialIcons name="close" size={16} color="#dc2626" />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            className="w-[34px] h-[34px] rounded-[10px] items-center justify-center bg-primary"
                            onPress={() => handleJoinRequest(req.id, 'approve')}
                            disabled={handlingRequestId === req.id}
                          >
                            {handlingRequestId === req.id ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <MaterialIcons name="check" size={16} color="#fff" />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            <View className="flex-row items-center mt-6 mb-3">
              <SectionLabel className="mb-0">
                {`INVITES${sentInvites.length > 0 ? ` (${sentInvites.length})` : ''}`}
              </SectionLabel>
              <TouchableOpacity
                className="ml-2 mb-1"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => Alert.alert('Invites', "Invite people directly. They'll see the invite in their Groups tab.")}
              >
                <MaterialIcons name="info-outline" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              className="flex-row items-center justify-between px-4 py-3.5 bg-surface-subtle border border-line-neutral rounded-2xl mb-3"
              activeOpacity={0.7}
              onPress={() => {
                setInviteSearch('');
                setInviteSearchResults([]);
                setShowInviteModal(true);
              }}
            >
              <View className="flex-row items-center gap-3">
                <MaterialIcons name="person-add" size={22} color="#475569" />
                <Text className="text-[15px] font-medium text-ink-strong">
                  Invite members
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
            </TouchableOpacity>

            {loadingSentInvites ? (
              <View className="py-4 items-center">
                <ActivityIndicator color={PRIMARY_HEX} />
              </View>
            ) : sentInvites.length === 0 ? (
              <View className="bg-surface-subtle rounded-xl py-5 items-center mb-2">
                <MaterialIcons name="mail-outline" size={24} color="#94a3b8" style={{ marginBottom: 6 }} />
                <Text className="text-sm text-ink-muted font-medium">No pending invites</Text>
              </View>
            ) : (
              <View className="border border-line-neutral rounded-2xl overflow-hidden mb-2">
                {sentInvites.map((inv) => (
                  <View
                    key={inv.invite_id}
                    className="flex-row items-center px-3.5 py-3 border-b border-line-muted/40 bg-white"
                  >
                    <Avatar name={inv.full_name} uri={inv.avatar_url} size="md" className="mr-3" />
                    <Text className="flex-1 text-[15px] font-medium text-ink-strong" numberOfLines={1}>
                      {inv.full_name ?? 'Unknown user'}
                    </Text>
                    <TouchableOpacity
                      className="flex-row items-center py-1.5 px-3 rounded-[10px] bg-danger-bgSoft"
                      activeOpacity={0.7}
                      onPress={() => handleRevokeInvite(inv.invite_id)}
                      disabled={revokingInviteId === inv.invite_id}
                    >
                      {revokingInviteId === inv.invite_id ? (
                        <ActivityIndicator size="small" color="#dc2626" />
                      ) : (
                        <>
                          <MaterialIcons name="close" size={14} color="#dc2626" style={{ marginRight: 3 }} />
                          <Text className="text-danger text-[13px] font-semibold">Cancel</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}

            <View className="flex-row items-center mt-6 mb-3">
              <SectionLabel className="mb-0">
                {`MEMBERS${members.length > 0 ? ` (${members.length})` : ''}`}
              </SectionLabel>
              <TouchableOpacity
                className="ml-2 mb-1"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                onPress={() => Alert.alert('Members', 'Admins have full control of the group.')}
              >
                <MaterialIcons name="info-outline" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>
            
            {loadingMembers ? (
              <View className="py-4 items-center">
                <ActivityIndicator color={PRIMARY_HEX} />
              </View>
            ) : (
              <TouchableOpacity
                className="flex-row items-center justify-between px-4 py-3.5 bg-surface-subtle border border-line-neutral rounded-2xl mb-2"
                activeOpacity={0.7}
                onPress={() => {
                  setMemberSearch('');
                  setShowMembersModal(true);
                }}
              >
                <View className="flex-row items-center gap-3">
                  <MaterialIcons name="people-outline" size={22} color="#475569" />
                  <Text className="text-[15px] font-medium text-ink-strong">
                    Manage members
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={20} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </>
        )}

        <Button
          label="Save"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          block
          size="lg"
          className="mt-7 mb-4"
        />

        <View className={`flex-row gap-3 ${isAdmin ? '' : 'justify-center'}`}>
          <TouchableOpacity
            className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-xl border border-line-neutral bg-surface-subtle"
            style={leaving ? { opacity: 0.6 } : undefined}
            onPress={handleLeave}
            disabled={leaving}
          >
            {leaving ? (
              <ActivityIndicator size="small" color="#64748b" />
            ) : (
              <>
                <MaterialIcons name="logout" size={16} color="#64748b" />
                <Text className="text-ink-subtle text-[14px] font-semibold">Leave</Text>
              </>
            )}
          </TouchableOpacity>

          {isAdmin && (
            <TouchableOpacity
              className="flex-1 flex-row items-center justify-center gap-1.5 py-3 rounded-xl bg-danger-bgAlt border border-danger-borderAlt"
              style={deleting ? { opacity: 0.6 } : undefined}
              onPress={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#dc2626" />
              ) : (
                <>
                  <MaterialIcons name="delete-outline" size={16} color="#dc2626" />
                  <Text className="text-danger text-[14px] font-semibold">Delete</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View className="h-8" />
      </ScrollView>

      {/* Invite Modal */}
      <Modal
        visible={showInviteModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowInviteModal(false)}
      >
        <Pressable
          className="flex-1 bg-[rgba(15,23,42,0.5)] justify-end"
          onPress={() => setShowInviteModal(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={shadows.sheet}
            className="bg-white rounded-t-[28px] w-full h-[85%] overflow-hidden"
          >
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
              <View className="self-center w-10 h-[5px] rounded-[3px] bg-[#d4d8de] mt-3 mb-2" />
              <View className="flex-row items-center justify-between px-5 pt-2 pb-3">
                <Text className="text-[19px] font-bold text-ink-strong">Invite Members</Text>
                <TouchableOpacity onPress={() => setShowInviteModal(false)} className="p-1 -mr-1">
                  <MaterialIcons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>

              <View className="px-5 pb-3">
                <View className="flex-row items-center bg-surface-subtle rounded-xl px-3 py-2.5">
                  <MaterialIcons name="search" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
                  <TextInput
                    className="flex-1 text-[15px] text-ink-strong"
                    placeholder="Search by name…"
                    placeholderTextColor="#94a3b8"
                    value={inviteSearch}
                    onChangeText={setInviteSearch}
                    autoFocus
                    autoCapitalize="words"
                    returnKeyType="search"
                  />
                  {inviteSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setInviteSearch('')} hitSlop={10}>
                      <MaterialIcons name="cancel" size={18} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 32 }}
              >
                {inviteSearch.trim().length === 0 ? (
                  <View className="py-10 items-center">
                    <MaterialIcons name="search" size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />
                    <Text className="text-sm text-ink-muted">Start typing to find people.</Text>
                  </View>
                ) : inviteSearching ? (
                  <View className="py-10 items-center">
                    <ActivityIndicator color={PRIMARY_HEX} />
                  </View>
                ) : inviteSearchResults.length === 0 ? (
                  <View className="py-10 items-center">
                    <MaterialIcons name="person-off" size={32} color="#cbd5e1" style={{ marginBottom: 8 }} />
                    <Text className="text-sm text-ink-muted">No people found.</Text>
                  </View>
                ) : (
                  <View className="border border-line-neutral rounded-2xl overflow-hidden">
                    {inviteSearchResults.map((u) => (
                      <View
                        key={u.user_id}
                        className="flex-row items-center px-3.5 py-3 border-b border-line-muted/40 bg-white"
                      >
                        <Avatar name={u.full_name} uri={u.avatar_url} size="md" className="mr-3" />
                        <Text className="flex-1 text-[15px] font-medium text-ink-strong" numberOfLines={1}>
                          {u.full_name ?? 'Unknown user'}
                        </Text>
                        <TouchableOpacity
                          className="px-3 py-1.5 rounded-lg bg-primary"
                          onPress={() => handleSendInvite(u.user_id)}
                          disabled={invitingUserId === u.user_id}
                        >
                          {invitingUserId === u.user_id ? (
                            <ActivityIndicator size="small" color="#fff" />
                          ) : (
                            <Text className="text-xs font-semibold text-white">Invite</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Manage Members Modal */}
      <Modal
        visible={showMembersModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMembersModal(false)}
      >
        <Pressable
          className="flex-1 bg-[rgba(15,23,42,0.5)] justify-end"
          onPress={() => setShowMembersModal(false)}
        >
          <Pressable
            onPress={(e) => e.stopPropagation()}
            style={shadows.sheet}
            className="bg-white rounded-t-[28px] w-full h-[85%] overflow-hidden"
          >
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
              {/* Handle */}
              <View className="self-center w-12 h-[5px] rounded-full bg-slate-300 mt-3 mb-2" />
              
              {/* Header */}
              <View className="flex-row items-center justify-between px-5 pt-2 pb-4">
                <Text className="text-[20px] font-bold text-ink-strong tracking-tight">Members</Text>
                <TouchableOpacity 
                  onPress={() => setShowMembersModal(false)} 
                  className="w-8 h-8 rounded-full bg-surface-subtle items-center justify-center"
                >
                  <MaterialIcons name="close" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>

              {/* Search */}
              <View className="px-5 pb-4">
                <View className="flex-row items-center bg-surface-subtle border border-line-neutral rounded-xl px-3.5 py-2.5">
                  <MaterialIcons name="search" size={20} color="#94a3b8" style={{ marginRight: 8 }} />
                  <TextInput
                    className="flex-1 text-[15px] text-ink-strong"
                    placeholder="Search people..."
                    placeholderTextColor="#94a3b8"
                    value={memberSearch}
                    onChangeText={setMemberSearch}
                    autoCapitalize="words"
                    returnKeyType="search"
                  />
                  {memberSearch.length > 0 && (
                    <TouchableOpacity onPress={() => setMemberSearch('')} hitSlop={10}>
                      <MaterialIcons name="cancel" size={18} color="#94a3b8" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* List */}
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 40 }}
              >
                {filteredMembers.length === 0 ? (
                  <View className="py-10 items-center">
                    <View className="w-16 h-16 rounded-full bg-surface-subtle items-center justify-center mb-4">
                      <MaterialIcons name="search-off" size={28} color="#94a3b8" />
                    </View>
                    <Text className="text-[15px] font-medium text-ink-strong">No members found</Text>
                    <Text className="text-sm text-ink-muted mt-1">Try a different name.</Text>
                  </View>
                ) : (
                  <View>
                    {filteredMembers.map((m) => {
                      const isMe = m.user_id === myUserId;
                      const canManage = myRole === 'admin' && !isMe && (m.role !== 'admin' || myUserId === originalAdminId);

                      return (
                        <TouchableOpacity
                          key={m.user_id}
                          activeOpacity={canManage ? 0.6 : 1}
                          onPress={() => canManage && openMemberOptions(m)}
                          className="flex-row items-center justify-between px-5 py-3.5 bg-white"
                        >
                          <View className="flex-1 mr-3 flex-row items-center">
                            <Avatar name={m.profiles?.full_name} size="md" className="mr-3" />
                            <View className="flex-1 flex-row items-center pr-2">
                              <Text className="text-[16px] text-ink-strong font-medium" numberOfLines={1}>
                                {m.profiles?.full_name ?? 'Member'}
                              </Text>
                              {isMe && (
                                <Text className="text-[15px] text-ink-muted ml-1.5">(You)</Text>
                              )}
                            </View>
                          </View>
                          
                          <View className="flex-row items-center gap-2">
                            {/* Role Badge */}
                            {m.role === 'admin' && (
                              <View className="bg-primary/10 px-2.5 py-1 rounded-md">
                                <Text className="text-[11px] font-bold text-primary uppercase tracking-wide">Admin</Text>
                              </View>
                            )}
                            {m.role === 'editor' && (
                              <View className="bg-surface-alt px-2.5 py-1 rounded-md border border-line-neutral">
                                <Text className="text-[11px] font-bold text-ink-subtle uppercase tracking-wide">Editor</Text>
                              </View>
                            )}

                            {/* Options Icon */}
                            {canManage && (
                              <MaterialIcons name="more-vert" size={20} color="#94a3b8" style={{ marginLeft: 4 }} />
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </ScrollView>
            </KeyboardAvoidingView>
          </Pressable>
        </Pressable>
      </Modal>

    </SafeAreaView>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View className="flex-row items-center justify-between py-4 border-b border-line-muted/40">
      <View className="flex-1 mr-3 flex-row items-center">
        <Text className="text-[15px] font-medium text-ink-strong">{title}</Text>
        {subtitle ? (
          <TouchableOpacity
            className="ml-2"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            onPress={() => Alert.alert(title, subtitle)}
          >
            <MaterialIcons name="info-outline" size={18} color="#94a3b8" />
          </TouchableOpacity>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={switchTrackColors}
        thumbColor={switchThumbColor(value, PRIMARY_HEX)}
        ios_backgroundColor={switchTrackColors.false}
      />
    </View>
  );
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
});