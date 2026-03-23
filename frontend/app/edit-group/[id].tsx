import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  Image,
  ActivityIndicator,
  Switch,
  Alert,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

export default function EditGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [name, setName] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingGroup, setLoadingGroup] = useState(true);

  useEffect(() => {
    if (!id) {
      router.back();
      return;
    }
    supabase
      .from('groups')
      .select('id, name, image_url, type')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        setLoadingGroup(false);
        if (error || !data) {
          Alert.alert('Error', 'Could not load group.');
          router.back();
          return;
        }
        setName(data.name);
        setIsCampusOrg(data.type === 'campus_org');
        if (data.image_url) setImageUri(data.image_url);
      });
  }, [id]);

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
      const updatePayload: { name: string; type: string; image_url?: string } = {
        name: name.trim(),
        type,
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
          <ActivityIndicator size="large" color="#000" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View className="flex-1 px-5 pt-2">
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <MaterialIcons name="close" size={28} color="#000" />
          </TouchableOpacity>
          <Text className="text-[20px] font-semibold text-black">Edit Group</Text>
          <View className="w-10" />
        </View>

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

        <View className="flex-row items-center justify-between py-3 border-b border-gray-100">
          <Text className="text-base font-medium text-gray-800">This is a campus org</Text>
          <Switch
            value={isCampusOrg}
            onValueChange={setIsCampusOrg}
            trackColor={{ false: '#e5e7eb', true: '#d1d5db' }}
            thumbColor={isCampusOrg ? '#000' : '#f3f4f6'}
          />
        </View>

        <TouchableOpacity
          className="bg-black rounded-[10px] py-4 items-center mt-8"
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

        <TouchableOpacity
          className="border border-red-500 py-4 items-center mt-4 rounded-[10px]"
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
      </View>
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
