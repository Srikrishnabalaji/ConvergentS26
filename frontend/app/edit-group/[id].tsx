import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';

const PRIMARY_HEX = '#0B617E';

type MemberRole = 'admin' | 'editor' | 'member';

type MemberRow = {
  user_id: string;
  role: MemberRole;
  profiles: { full_name: string | null } | null;
};

export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

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

  useEffect(() => {
    if (!id) {
      router.back();
      return;
    }
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyUserId(user?.id ?? null);

      const { data: groupRow, error: gErr } = await supabase
        .from('groups')
        .select('id, name, description, image_url, type')
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
      if (groupRow.image_url) setImageUri(groupRow.image_url);

      if (role === 'admin') {
        await loadMembers(id);
      }

      setLoadingGroup(false);
    })();
  }, [id, loadMembers, router]);

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

    if (myRole === 'editor') {
      setLoading(true);
      const { error: updateError } = await supabase
        .from('groups')
        .update({ description: description.trim() || null })
        .eq('id', id);
      setLoading(false);
      if (updateError) {
        Alert.alert('Failed to save', updateError.message);
        return;
      }
      router.back();
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
          .upload(path, decode(imageBase64), {
            contentType: `image/${ext}`,
            upsert: false,
          });
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from('group-images')
            .getPublicUrl(path);
          imageUrl = urlData.publicUrl;
        }
      }

      const type = isCampusOrg ? 'campus_org' : 'friends';
      const updatePayload: {
        name: string;
        type: string;
        description: string | null;
        image_url?: string;
      } = {
        name: name.trim(),
        type,
        description: description.trim() || null,
      };
      if (imageUrl !== null) updatePayload.image_url = imageUrl;

      const { error: updateError } = await supabase
        .from('groups')
        .update(updatePayload)
        .eq('id', id);

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
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              router.back();
            }
          },
        },
      ]
    );
  }

  if (loadingGroup) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View className="flex-1 justify-center items-center">
          <ActivityIndicator size="large" color="#0B617E" />
        </View>
      </SafeAreaView>
    );
  }

  const isEditorOnly = myRole === 'editor';

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView className="flex-1 px-5 pt-2" keyboardShouldPersistTaps="handled">
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <MaterialIcons name="close" size={28} color="#0B617E" />
          </TouchableOpacity>
          <Text className="text-[20px] font-semibold text-primary">
            {isEditorOnly ? 'Edit description' : 'Edit Group'}
          </Text>
          <View className="w-10" />
        </View>

        {!isEditorOnly && (
          <>
            <TouchableOpacity
              className="w-[100px] h-[100px] rounded-xl bg-gray-200 items-center justify-center mb-6 self-center"
              onPress={pickImage}
            >
              {imageUri ? (
                <Image source={{ uri: imageUri }} className="w-full h-full rounded-xl" />
              ) : (
                <MaterialIcons name="add-a-photo" size={36} color="#666" />
              )}
            </TouchableOpacity>

            <View className="gap-1.5 mb-4">
              <Text className="text-sm font-semibold text-gray-700">Group name</Text>
              <TextInput
                className="border border-gray-200 rounded-[10px] px-4 py-3.5 text-base text-black bg-gray-50"
                placeholder="e.g. Calc Study Group"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
              />
            </View>
          </>
        )}

        <View className="gap-1.5 mb-4">
          <Text className="text-sm font-semibold text-gray-700">Description</Text>
          <Text className="text-xs text-gray-500 mb-1">
            {isEditorOnly
              ? 'Editors can update the group description.'
              : 'Shown on the group details screen. Editors can also edit this from their own edit view.'}
          </Text>
          <TextInput
            className="border border-gray-200 rounded-[10px] px-4 py-3.5 text-base text-black bg-gray-50 min-h-[120px]"
            placeholder="What is this group about?"
            placeholderTextColor="#999"
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
        </View>

        {!isEditorOnly && (
          <>
            <View className="flex-row items-center justify-between py-3 border-b border-gray-100 mb-4">
              <Text className="text-base font-medium text-gray-800">This is a campus org</Text>
              <View className="w-[52] items-center justify-center">
                <Switch
                  value={isCampusOrg}
                  onValueChange={setIsCampusOrg}
                  trackColor={switchTrackColors}
                  thumbColor={switchThumbColor(isCampusOrg, PRIMARY_HEX)}
                  ios_backgroundColor={switchTrackColors.false}
                />
              </View>
            </View>

            <Text className="text-sm font-semibold text-gray-700 mb-2">Members and editors</Text>
            <Text className="text-xs text-gray-500 mb-3">
              Editors can update the description. They cannot delete the group or change its name here.
            </Text>
            {loadingMembers ? (
              <View className="mb-4 items-center">
                <ActivityIndicator color="#0B617E" />
              </View>
            ) : (
              <View className="border border-gray-200 rounded-xl overflow-hidden mb-4">
                {members.map((m) => (
                  <View
                    key={m.user_id}
                    className="flex-row items-center justify-between px-3 py-3 border-b border-gray-100 last:border-b-0"
                  >
                    <View className="flex-1 mr-2">
                      <Text className="text-base text-gray-900" numberOfLines={1}>
                        {m.profiles?.full_name ?? 'Member'}
                      </Text>
                      <Text className="text-xs text-gray-500 capitalize">{m.role}</Text>
                    </View>
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'member' && (
                      <TouchableOpacity
                        onPress={() => setMemberRole(m.user_id, 'editor')}
                        className="px-2 py-1 rounded-lg bg-primary/10"
                      >
                        <Text className="text-xs font-semibold text-primary">Make editor</Text>
                      </TouchableOpacity>
                    )}
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'editor' && (
                      <TouchableOpacity
                        onPress={() => setMemberRole(m.user_id, 'member')}
                        className="px-2 py-1 rounded-lg bg-gray-100"
                      >
                        <Text className="text-xs font-semibold text-gray-700">Remove editor</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        <TouchableOpacity
          className="bg-primary rounded-[10px] py-4 items-center mt-2"
          onPress={handleSave}
          disabled={loading}
          style={loading ? { opacity: 0.7 } : undefined}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-semibold">Save</Text>
          )}
        </TouchableOpacity>

        {!isEditorOnly && (
          <TouchableOpacity
            className="border border-red-500 py-4 items-center mt-4 mb-8 rounded-[10px]"
            onPress={handleDelete}
            disabled={deleting}
            style={deleting ? { opacity: 0.7 } : undefined}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text className="text-red-500 text-base font-semibold">Delete Group</Text>
            )}
          </TouchableOpacity>
        )}
        {isEditorOnly && <View className="h-8" />}
      </ScrollView>
    </SafeAreaView>
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
  safeArea: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
