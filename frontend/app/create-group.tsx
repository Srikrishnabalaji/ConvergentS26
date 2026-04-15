import React, { useState } from 'react';
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
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';

const PRIMARY_HEX = '#0B617E';

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [joinPassword, setJoinPassword] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Password only applies to public friend groups
  const showPasswordOption = !isPrivate && !isCampusOrg;
  // When user switches to campus org or private, clear password settings
  function handleCampusToggle(val: boolean) {
    setIsCampusOrg(val);
    if (val) { setHasPassword(false); setJoinPassword(''); }
  }
  function handlePrivateToggle(val: boolean) {
    setIsPrivate(val);
    if (val) { setHasPassword(false); setJoinPassword(''); }
  }

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

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a group name.');
      return;
    }
    if (showPasswordOption && hasPassword && !joinPassword.trim()) {
      Alert.alert('Error', 'Please enter a join password, or disable the password option.');
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      Alert.alert('Error', 'You must be signed in to create a group.');
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
      const effectivePassword =
        showPasswordOption && hasPassword && joinPassword.trim()
          ? joinPassword.trim()
          : null;

      // Use an RPC so the creator is added as admin atomically and RLS
      // doesn't block the implicit RETURNING on private groups.
      const { data: rpcData, error: groupError } = await supabase.rpc('create_group', {
        p_name: name.trim(),
        p_description: description.trim() || null,
        p_image_url: imageUrl,
        p_type: type,
        p_is_private: isPrivate,
        p_join_password: effectivePassword,
      });

      if (groupError || rpcData?.error) {
        Alert.alert('Failed to create group', groupError?.message ?? rpcData?.error ?? 'Something went wrong.');
        setLoading(false);
        return;
      }

      if (isPrivate) {
        Alert.alert(
          'Private group created',
          'Your join code is ready. You can view and share it from the group\'s edit screen.',
        );
      }

      router.back();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
            <MaterialIcons name="close" size={28} color="#0B617E" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Create Group</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Image picker */}
        <TouchableOpacity style={styles.imagePicker} onPress={pickImage}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.imagePreview} />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={32} color="#94a3b8" />
              <Text style={styles.imagePickerLabel}>Add photo</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Group name */}
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

        {/* Description */}
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Description (optional)</Text>
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

        {/* Divider label */}
        <Text style={styles.sectionLabel}>GROUP SETTINGS</Text>

        {/* Campus org toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.toggleTitle}>Campus organization</Text>
            <Text style={styles.toggleSubtitle}>New members must be approved by an admin</Text>
          </View>
          <Switch
            value={isCampusOrg}
            onValueChange={handleCampusToggle}
            trackColor={switchTrackColors}
            thumbColor={switchThumbColor(isCampusOrg, PRIMARY_HEX)}
            ios_backgroundColor={switchTrackColors.false}
          />
        </View>

        {/* Private toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextCol}>
            <Text style={styles.toggleTitle}>Private group</Text>
            <Text style={styles.toggleSubtitle}>Not discoverable — members join with a unique code</Text>
          </View>
          <Switch
            value={isPrivate}
            onValueChange={handlePrivateToggle}
            trackColor={switchTrackColors}
            thumbColor={switchThumbColor(isPrivate, PRIMARY_HEX)}
            ios_backgroundColor={switchTrackColors.false}
          />
        </View>

        {/* Private group info banner */}
        {isPrivate && (
          <View style={styles.infoBanner}>
            <MaterialIcons name="key" size={16} color="#0B617E" style={{ marginRight: 8, marginTop: 1 }} />
            <Text style={styles.infoBannerText}>
              A unique join code will be automatically generated. View and share it from the group's edit screen after creating.
            </Text>
          </View>
        )}

        {/* Password option (public friend groups only) */}
        {showPasswordOption && (
          <>
            <View style={styles.toggleRow}>
              <View style={styles.toggleTextCol}>
                <Text style={styles.toggleTitle}>Require a password to join</Text>
                <Text style={styles.toggleSubtitle}>Members must enter a password you set</Text>
              </View>
              <Switch
                value={hasPassword}
                onValueChange={setHasPassword}
                trackColor={switchTrackColors}
                thumbColor={switchThumbColor(hasPassword, PRIMARY_HEX)}
                ios_backgroundColor={switchTrackColors.false}
              />
            </View>
            {hasPassword && (
              <View style={[styles.fieldGroup, { marginTop: 4 }]}>
                <Text style={styles.fieldLabel}>Join password</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="Choose a password for your group"
                  placeholderTextColor="#999"
                  value={joinPassword}
                  onChangeText={setJoinPassword}
                  autoCapitalize="none"
                />
              </View>
            )}
          </>
        )}

        {/* Create button */}
        <TouchableOpacity
          style={[styles.createBtn, loading && { opacity: 0.7 }]}
          onPress={handleCreate}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.createBtnText}>Create Group</Text>
          )}
        </TouchableOpacity>
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
  safeArea: { flex: 1, backgroundColor: '#fff' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  closeBtn: { padding: 4, marginLeft: -4 },
  headerTitle: { fontSize: 20, fontWeight: '600', color: '#0B617E' },
  headerSpacer: { width: 36 },
  imagePicker: {
    width: 100,
    height: 100,
    borderRadius: 20,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
    overflow: 'hidden',
  },
  imagePreview: { width: '100%', height: '100%' },
  imagePickerLabel: { fontSize: 12, color: '#94a3b8', marginTop: 6, fontWeight: '500' },
  fieldGroup: { marginBottom: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 6 },
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
  textInputMulti: { minHeight: 96, paddingTop: 12 },
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
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(11, 97, 126, 0.07)',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    marginBottom: 4,
  },
  infoBannerText: { flex: 1, fontSize: 13, color: '#0B617E', lineHeight: 19, fontWeight: '500' },
  createBtn: {
    backgroundColor: '#0B617E',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 28,
  },
  createBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
