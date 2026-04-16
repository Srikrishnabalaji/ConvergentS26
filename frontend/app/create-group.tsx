import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Switch,
  Alert,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';
import { switchTrackColors, switchThumbColor } from '@/lib/switchTheme';
import { Button, TextField, SectionLabel } from '@/components/ui';

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

  const showPasswordOption = !isPrivate && !isCampusOrg;

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
          .upload(path, decode(imageBase64), { contentType: `image/${ext}`, upsert: false });
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('group-images').getPublicUrl(path);
          imageUrl = urlData.publicUrl;
        }
      }

      const type = isCampusOrg ? 'campus_org' : 'friends';
      const effectivePassword =
        showPasswordOption && hasPassword && joinPassword.trim() ? joinPassword.trim() : null;

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
          "Your join code is ready. You can view and share it from the group's edit screen.",
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
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity onPress={() => router.back()} className="p-1 -ml-1">
            <MaterialIcons name="close" size={28} color={PRIMARY_HEX} />
          </TouchableOpacity>
          <Text className="text-xl font-semibold text-primary">Create Group</Text>
          <View className="w-9" />
        </View>

        <TouchableOpacity
          className="w-[100px] h-[100px] rounded-[20px] bg-surface-alt items-center justify-center self-center mb-6 overflow-hidden"
          onPress={pickImage}
        >
          {imageUri ? (
            <Image source={{ uri: imageUri }} className="w-full h-full" />
          ) : (
            <>
              <MaterialIcons name="add-a-photo" size={32} color="#94a3b8" />
              <Text className="text-xs text-ink-muted mt-1.5 font-medium">Add photo</Text>
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

        <TextField
          label="Description (optional)"
          placeholder="What is this group about?"
          value={description}
          onChangeText={setDescription}
          multiline
          textAlignVertical="top"
          inputClassName="min-h-[96px] pt-3"
          containerClassName="mb-4"
        />

        <SectionLabel className="mb-1 mt-2">GROUP SETTINGS</SectionLabel>

        <ToggleRow
          title="Campus organization"
          subtitle="New members must be approved by an admin"
          value={isCampusOrg}
          onValueChange={handleCampusToggle}
        />

        <ToggleRow
          title="Private group"
          subtitle="Not discoverable — members join with a code"
          value={isPrivate}
          onValueChange={handlePrivateToggle}
        />

        {isPrivate && (
          <View className="flex-row items-start bg-primary/10 rounded-xl p-3.5 mt-2.5 mb-1">
            <MaterialIcons name="key" size={16} color={PRIMARY_HEX} style={{ marginRight: 8, marginTop: 1 }} />
            <Text className="flex-1 text-[13px] text-primary leading-[19px] font-medium">
              A unique join code will be automatically generated. View and share it from the group&apos;s edit screen after creating.
            </Text>
          </View>
        )}

        {showPasswordOption && (
          <>
            <ToggleRow
              title="Require a password to join"
              subtitle="Members must enter a password you set"
              value={hasPassword}
              onValueChange={setHasPassword}
            />
            {hasPassword && (
              <TextField
                label="Join password"
                placeholder="Choose a password for your group"
                value={joinPassword}
                onChangeText={setJoinPassword}
                autoCapitalize="none"
                containerClassName="mt-1"
              />
            )}
          </>
        )}

        <Button
          label="Create Group"
          onPress={handleCreate}
          loading={loading}
          disabled={loading}
          block
          size="lg"
          className="mt-7"
        />
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
  scrollContent: { paddingHorizontal: 20, paddingBottom: 48, paddingTop: 8 },
});
