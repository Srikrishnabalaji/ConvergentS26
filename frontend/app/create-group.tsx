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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '@/lib/supabase';

export default function CreateGroupScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [isCampusOrg, setIsCampusOrg] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      const { data: group, error: groupError } = await supabase
        .from('groups')
        .insert({ name: name.trim(), image_url: imageUrl, type })
        .select('id')
        .single();

      if (groupError) {
        Alert.alert('Failed to create group', groupError.message);
        setLoading(false);
        return;
      }

      const { error: memberError } = await supabase.from('group_members').insert({
        group_id: group.id,
        user_id: user.id,
        role: 'admin',
      });

      if (memberError) {
        Alert.alert('Group created', 'There was an issue adding you as admin. Try refreshing.');
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
      <View className="flex-1 px-5 pt-2">
        <View className="flex-row items-center justify-between mb-6">
          <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
            <MaterialIcons name="close" size={28} color="#007C6E" />
          </TouchableOpacity>
          <Text className="text-[20px] font-semibold text-primary">Create Group</Text>
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
            trackColor={{ false: '#6b7280', true: '#66b9af' }}
            thumbColor={isCampusOrg ? '#007C6E' : '#f3f4f6'}
          />
        </View>

        <TouchableOpacity
          className="bg-primary rounded-[10px] py-4 items-center mt-8"
          onPress={handleCreate}
          disabled={loading}
          style={loading ? { opacity: 0.7 } : undefined}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-semibold">Create</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// Decode base64 to ArrayBuffer for Supabase upload
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
