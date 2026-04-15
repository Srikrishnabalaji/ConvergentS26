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
  Clipboard,
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

type JoinRequest = {
  id: string;
  user_id: string;
  full_name: string | null;
  created_at: string;
};

export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  // Base group fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);

  // Password settings (public friend groups only)
  const [enablePassword, setEnablePassword] = useState(false);
  const [passwordValue, setPasswordValue] = useState('');

  // Join code (private groups, admins only)
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [regeneratingCode, setRegeneratingCode] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState(true);
  const [myRole, setMyRole] = useState<MemberRole | null>(null);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // Members
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Join requests (campus org admins)
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [handlingRequestId, setHandlingRequestId] = useState<string | null>(null);

  const isEditorOnly = myRole === 'editor';
  const isAdmin = myRole === 'admin';
  // Password option only relevant for public friend groups
  const showPasswordOption = isAdmin && !isPrivate && !isCampusOrg;
  const showJoinCode = isAdmin && isPrivate;
  const showJoinRequests = isAdmin && isCampusOrg;

  // ── Load members ──────────────────────────────────────────────────────────
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

  // ── Load join requests ────────────────────────────────────────────────────
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
      }))
    );
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!id) { router.back(); return; }
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setMyUserId(user?.id ?? null);

      const { data: groupRow, error: gErr } = await supabase
        .from('groups')
        .select('id, name, description, image_url, type, is_private, has_join_password, join_code, join_password')
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
      setEnablePassword(groupRow.has_join_password ?? false);
      setPasswordValue(groupRow.join_password ?? '');
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

  // ── Image picker ──────────────────────────────────────────────────────────
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

  // ── Member role change ────────────────────────────────────────────────────
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

  // ── Handle join request ───────────────────────────────────────────────────
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

  // ── Regenerate join code ──────────────────────────────────────────────────
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
      ]
    );
  }

  // ── Save ──────────────────────────────────────────────────────────────────
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

    // Editors can only update description
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

    if (showPasswordOption && enablePassword && !passwordValue.trim()) {
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
      const effectivePassword =
        !isPrivate && type === 'friends' && enablePassword && passwordValue.trim()
          ? passwordValue.trim()
          : null;

      const updatePayload: Record<string, unknown> = {
        name: name.trim(),
        type,
        description: description.trim() || null,
        is_private: isPrivate,
        join_password: effectivePassword,
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

  // ── Delete ────────────────────────────────────────────────────────────────
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
            if (error) { Alert.alert('Error', error.message); }
            else { router.back(); }
          },
        },
      ]
    );
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loadingGroup) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#0B617E" />
        </View>
      </SafeAreaView>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <MaterialIcons name="close" size={28} color="#0B617E" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {isEditorOnly ? 'Edit description' : 'Edit Group'}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* ── Admin-only: image + name + type ── */}
        {!isEditorOnly && (
          <>
            <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={styles.imagePreview} />
              ) : (
                <>
                  <MaterialIcons name="add-a-photo" size={32} color="#94a3b8" />
                  <Text style={styles.imagePickerLabel}>Change photo</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Group name</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Calc Study Group"
                placeholderTextColor="#999"
                value={name}
                onChangeText={setName}
              />
            </View>
          </>
        )}

        {/* Description (visible to all roles) */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description</Text>
          {isEditorOnly && (
            <Text style={styles.fieldNote}>Editors can update the group description.</Text>
          )}
          <TextInput
            style={[styles.textInput, styles.textInputMulti]}
            placeholder="What is this group about?"
            placeholderTextColor="#999"
            value={description}
            onChangeText={setDescription}
            multiline
            textAlignVertical="top"
          />
        </View>

        {/* ── Admin-only sections ── */}
        {!isEditorOnly && (
          <>
            <Text style={styles.sectionLabel}>GROUP SETTINGS</Text>

            {/* Campus org toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>Campus organization</Text>
                <Text style={styles.toggleSubtitle}>New members must be approved by an admin</Text>
              </View>
              <Switch
                value={isCampusOrg}
                onValueChange={(val) => {
                  setIsCampusOrg(val);
                  if (val) { setEnablePassword(false); setPasswordValue(''); }
                }}
                trackColor={switchTrackColors}
                thumbColor={switchThumbColor(isCampusOrg, PRIMARY_HEX)}
                ios_backgroundColor={switchTrackColors.false}
              />
            </View>

            {/* Private toggle */}
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>Private group</Text>
                <Text style={styles.toggleSubtitle}>Hidden from Discover — members join with a code</Text>
              </View>
              <Switch
                value={isPrivate}
                onValueChange={(val) => {
                  setIsPrivate(val);
                  if (val) { setEnablePassword(false); setPasswordValue(''); }
                }}
                trackColor={switchTrackColors}
                thumbColor={switchThumbColor(isPrivate, PRIMARY_HEX)}
                ios_backgroundColor={switchTrackColors.false}
              />
            </View>

            {/* Join code (private groups) */}
            {showJoinCode && (
              <View style={styles.infoCard}>
                <View style={styles.infoCardHeader}>
                  <MaterialIcons name="key" size={17} color={PRIMARY_HEX} style={{ marginRight: 7 }} />
                  <Text style={styles.infoCardTitle}>Join Code</Text>
                </View>
                <Text style={styles.infoCardSubtitle}>
                  Share this code with people you want to invite. Only the code-holder can join.
                </Text>
                <View style={styles.codeDisplayRow}>
                  <Text style={styles.codeText} selectable>
                    {joinCode ?? '—'}
                  </Text>
                  <View style={styles.codeActions}>
                    {joinCode && (
                      <TouchableOpacity
                        style={styles.codeActionBtn}
                        onPress={() => {
                          Clipboard.setString(joinCode);
                          Alert.alert('Copied', 'Join code copied to clipboard.');
                        }}
                      >
                        <MaterialIcons name="content-copy" size={16} color={PRIMARY_HEX} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[styles.codeActionBtn, regeneratingCode && { opacity: 0.6 }]}
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
                  <Text style={styles.infoCardNote}>
                    Save the group to generate a code (toggle Private on and save).
                  </Text>
                )}
              </View>
            )}

            {/* Password option (public friend groups) */}
            {showPasswordOption && (
              <>
                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextCol}>
                    <Text style={styles.toggleTitle}>Require a password to join</Text>
                    <Text style={styles.toggleSubtitle}>Members must enter a password you set</Text>
                  </View>
                  <Switch
                    value={enablePassword}
                    onValueChange={(val) => {
                      setEnablePassword(val);
                      if (!val) setPasswordValue('');
                    }}
                    trackColor={switchTrackColors}
                    thumbColor={switchThumbColor(enablePassword, PRIMARY_HEX)}
                    ios_backgroundColor={switchTrackColors.false}
                  />
                </View>
                {enablePassword && (
                  <View style={[styles.fieldGroup, { marginTop: 4 }]}>
                    <Text style={styles.fieldLabel}>Join password</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="Password members must enter to join"
                      placeholderTextColor="#999"
                      value={passwordValue}
                      onChangeText={setPasswordValue}
                      autoCapitalize="none"
                    />
                  </View>
                )}
              </>
            )}

            {/* Pending join requests (campus org) */}
            {showJoinRequests && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
                  JOIN REQUESTS
                  {joinRequests.length > 0 && ` (${joinRequests.length})`}
                </Text>
                {loadingRequests ? (
                  <View style={styles.centeredRow}>
                    <ActivityIndicator color={PRIMARY_HEX} />
                  </View>
                ) : joinRequests.length === 0 ? (
                  <View style={styles.emptyRequestsCard}>
                    <MaterialIcons name="check-circle-outline" size={24} color="#94a3b8" style={{ marginBottom: 6 }} />
                    <Text style={styles.emptyRequestsText}>No pending requests</Text>
                  </View>
                ) : (
                  <View style={styles.requestsList}>
                    {joinRequests.map((req) => (
                      <View key={req.id} style={styles.requestRow}>
                        <View style={styles.requestAvatarFallback}>
                          <Text style={styles.requestAvatarInitials}>
                            {initialsFromName(req.full_name)}
                          </Text>
                        </View>
                        <Text style={styles.requestName} numberOfLines={1}>
                          {req.full_name ?? 'Unknown user'}
                        </Text>
                        <View style={styles.requestActions}>
                          <TouchableOpacity
                            style={[styles.requestBtn, styles.requestBtnDecline]}
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
                            style={[styles.requestBtn, styles.requestBtnApprove]}
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

            {/* Members & editors */}
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>MEMBERS</Text>
            <Text style={styles.fieldNote}>
              Editors can update the group description. Admins have full control.
            </Text>
            {loadingMembers ? (
              <View style={styles.centeredRow}>
                <ActivityIndicator color={PRIMARY_HEX} />
              </View>
            ) : (
              <View style={styles.membersList}>
                {members.map((m) => (
                  <View key={m.user_id} style={styles.memberRow}>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {m.profiles?.full_name ?? 'Member'}
                      </Text>
                      <Text style={styles.memberRole}>{m.role}</Text>
                    </View>
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'member' && (
                      <TouchableOpacity
                        style={styles.roleBtn}
                        onPress={() => setMemberRole(m.user_id, 'editor')}
                      >
                        <Text style={styles.roleBtnText}>Make editor</Text>
                      </TouchableOpacity>
                    )}
                    {myRole === 'admin' && m.user_id !== myUserId && m.role === 'editor' && (
                      <TouchableOpacity
                        style={[styles.roleBtn, styles.roleBtnSecondary]}
                        onPress={() => setMemberRole(m.user_id, 'member')}
                      >
                        <Text style={styles.roleBtnSecondaryText}>Remove editor</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </>
        )}

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveBtn, loading && { opacity: 0.7 }]}
          onPress={handleSave}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>

        {/* Delete button (admin only) */}
        {!isEditorOnly && (
          <TouchableOpacity
            style={[styles.deleteBtn, deleting && { opacity: 0.7 }]}
            onPress={handleDelete}
            disabled={deleting}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text style={styles.deleteBtnText}>Delete Group</Text>
            )}
          </TouchableOpacity>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function initialsFromName(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function decode(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const PRIMARY = '#0B617E';

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  closeBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: PRIMARY },
  headerSpacer: { width: 36 },
  imagePicker: {
    width: 100,
    height: 100,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
    overflow: 'hidden',
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePickerLabel: { fontSize: 11, color: '#94a3b8', marginTop: 5, fontWeight: '500' },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
  fieldNote: { fontSize: 12, color: '#94a3b8', marginBottom: 8, lineHeight: 17 },
  textInput: {
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#fafafa',
  },
  textInputMulti: { minHeight: 110, paddingTop: 12 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94a3b8',
    letterSpacing: 1,
    marginBottom: 4,
    marginTop: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
  },
  toggleTextCol: { flex: 1, marginRight: 12 },
  toggleTitle: { fontSize: 15, fontWeight: '500', color: '#111827' },
  toggleSubtitle: { fontSize: 12, color: '#94a3b8', marginTop: 2, lineHeight: 17 },
  // Join code card
  infoCard: {
    backgroundColor: 'rgba(11, 97, 126, 0.06)',
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    marginBottom: 4,
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  infoCardTitle: { fontSize: 14, fontWeight: '700', color: PRIMARY },
  infoCardSubtitle: { fontSize: 13, color: '#64748b', lineHeight: 18, marginBottom: 14 },
  codeDisplayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  codeText: {
    fontSize: 22,
    fontWeight: '800',
    color: PRIMARY,
    letterSpacing: 4,
  },
  codeActions: { flexDirection: 'row', gap: 8 },
  codeActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: 'rgba(11, 97, 126, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCardNote: { fontSize: 12, color: '#94a3b8', marginTop: 10, fontStyle: 'italic' },
  // Join requests
  emptyRequestsCard: {
    backgroundColor: '#f8fafb',
    borderRadius: 12,
    paddingVertical: 20,
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyRequestsText: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
  requestsList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 8,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  requestAvatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(11, 97, 126, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  requestAvatarInitials: { fontSize: 13, fontWeight: '700', color: PRIMARY },
  requestName: { flex: 1, fontSize: 15, fontWeight: '500', color: '#111827' },
  requestActions: { flexDirection: 'row', gap: 8 },
  requestBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestBtnDecline: { backgroundColor: '#fef2f2' },
  requestBtnApprove: { backgroundColor: PRIMARY },
  // Members list
  membersList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#f1f5f9',
    backgroundColor: '#fff',
  },
  memberInfo: { flex: 1, marginRight: 8 },
  memberName: { fontSize: 15, color: '#111827', fontWeight: '500' },
  memberRole: { fontSize: 12, color: '#94a3b8', marginTop: 1, textTransform: 'capitalize' },
  roleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(11, 97, 126, 0.09)',
  },
  roleBtnText: { fontSize: 12, fontWeight: '600', color: PRIMARY },
  roleBtnSecondary: { backgroundColor: '#f1f5f9' },
  roleBtnSecondaryText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  centeredRow: { paddingVertical: 16, alignItems: 'center' },
  // Actions
  saveBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
    marginBottom: 12,
  },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  deleteBtn: {
    borderWidth: 1.5,
    borderColor: '#ef4444',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
  },
  deleteBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
