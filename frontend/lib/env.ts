// Single source of truth for required client env vars. Importing this module
// runs the check at app boot. Add new keys here when they become required so
// a missing value fails loudly instead of producing silent `undefined`s deep
// inside feature code.
//
// IMPORTANT: Expo Metro statically replaces every `process.env.NAME` it sees
// at build time. Dynamic indexing (`process.env[key]`) is NOT replaced, so
// every read here must be a literal property access.

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const missing: string[] = [];
if (!SUPABASE_URL      || SUPABASE_URL.trim()      === '') missing.push('EXPO_PUBLIC_SUPABASE_URL');
if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.trim() === '') missing.push('EXPO_PUBLIC_SUPABASE_ANON_KEY');

if (missing.length > 0) {
  throw new Error(
    `Missing required env vars: ${missing.join(', ')}. ` +
      `Copy frontend/.env.example to frontend/.env and fill them in.`,
  );
}

// After the guard above, both are non-empty strings.
export const env = {
  SUPABASE_URL:      SUPABASE_URL      as string,
  SUPABASE_ANON_KEY: SUPABASE_ANON_KEY as string,
} as const;
