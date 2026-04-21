import React, { useState, useEffect, useCallback } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { Button, TextField, SectionLabel, Avatar, initialsFromName } from '@/components/ui';

const PRIMARY_HEX = '#0B617E';

type MemberRole = 'admin' | 'editor' | 'member';

type MemberRow = {
  user_id: string;
  role: MemberRole;
  profiles: { full_name: string | null } | null;
};

type JoinRequest = {
  id: string;
  user_id: string;
  full_name: string | null;
  created_at: string;
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
  /** True if group already had a join password when the screen loaded (value is not fetched for security). */
  const [hadJoinPasswordOnLoad, setHadJoinPasswordOnLoad] = useState(false);

  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [regeneratingCode, setRegeneratingCode] = useState(false);

  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [handlingRequestId, setHandlingRequestId] = useState<string | null>(null);

  const isEditorOnly = myRole === 'editor';
  const isAdmin = myRole === 'admin';
  const showPasswordOption = isAdmin && !isPrivate && !isCampusOrg;
  const showJoinCode = isAdmin && isPrivate;
  const showJoinRequests = isAdmin && isCampusOrg;

  const loadMembers = useCallback(async (groupId: string) => {
    setLoadingMembers(true);
    const { data: rows, error: e1 } = await supabase
      .from('group_members')
      .select('user_id, role')
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
          groupRow.type === 'campus_org' ? loadJoinRequests(id) : Promise.resolve(),
        ]);
      }

      setLoadingGroup(false);
    })();
  }, [id, loadMembers, loadJoinRequests, router]);

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

            <SectionLabel className="mt-6 mb-1">MEMBERS</SectionLabel>
            <Text className="text-xs text-ink-muted mb-2 leading-[17px]">
              Editors can update the group description. Admins have full control.
            </Text>
            {loadingMembers ? (
              <View className="py-4 items-center">
                <ActivityIndicator color={PRIMARY_HEX} />
              </View>
            ) : (
              <View className="border border-line-neutral rounded-2xl overflow-hidden mb-2">
                {members.map((m) => (
                  <View
                    key={m.user_id}
                    className="flex-row items-center justify-between px-3.5 py-3 border-b border-line-muted/40 bg-white"
                  >
                    <View className="flex-1 mr-2">
                      <Text className="text-[15px] text-ink-strong font-medium" numberOfLines={1}>
                        {m.profiles?.full_name ?? 'Member'}
                      </Text>
                      <Text className="text-xs text-ink-muted mt-0.5 capitalize">{m.role}</Text>
                    </View>
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'member' && (
                      <TouchableOpacity
                        className="px-3 py-1.5 rounded-lg bg-primary/10"
                        onPress={() => setMemberRole(m.user_id, 'editor')}
                      >
                        <Text className="text-xs font-semibold text-primary">Make editor</Text>
                      </TouchableOpacity>
                    )}
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'editor' && (
                      <TouchableOpacity
                        className="px-3 py-1.5 rounded-lg bg-surface-alt"
                        onPress={() => setMemberRole(m.user_id, 'member')}
                      >
                        <Text className="text-xs font-semibold text-ink-muted">Remove editor</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
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
          className="mt-7 mb-3"
        />

        {!isEditorOnly && (
          <TouchableOpacity
            className="border-[1.5px] border-danger rounded-2xl py-[15px] items-center"
            style={deleting ? { opacity: 0.7 } : undefined}
            onPress={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text className="text-danger text-[15px] font-semibold">Delete Group</Text>
            )}
          </TouchableOpacity>
        )}

        <View className="h-8" />
      </ScrollView>
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
    <View className="flex-row items-center justify-between py-3.5 border-b border-line-muted/40">
      <View className="flex-1 mr-3">
        <Text className="text-[15px] font-medium text-ink-strong">{title}</Text>
        <Text className="text-xs text-ink-muted mt-0.5 leading-[17px]">{subtitle}</Text>
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
