import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const safeAuthStorage = {
  getItem: async (key: string): Promise<string | null> => {
    const value = await AsyncStorage.getItem(key);
    if (!value) return value;

    // Expo/RN can occasionally persist unusable blob URLs in auth payloads.
    // Returning null forces a clean auth state instead of repeated fetch errors.
    if (value.includes('blob:')) {
      await AsyncStorage.removeItem(key);
      return null;
    }

    return value;
  },
  setItem: (key: string, value: string): Promise<void> => AsyncStorage.setItem(key, value),
  removeItem: (key: string): Promise<void> => AsyncStorage.removeItem(key),
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: safeAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
