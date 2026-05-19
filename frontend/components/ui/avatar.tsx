import React, { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import { cn } from '@/lib/cn';
import { initialsFromName } from '@/lib/utils/initials';

// Re-export so existing `import { initialsFromName } from '@/components/ui'`
// call sites keep working.
export { initialsFromName };

type Size = 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<Size, { box: string; text: string }> = {
  sm: { box: 'w-8 h-8 rounded-lg', text: 'text-xs' },
  md: { box: 'w-11 h-11 rounded-xl', text: 'text-base' },
  lg: { box: 'w-14 h-14 rounded-2xl', text: 'text-lg' },
  xl: { box: 'w-16 h-16 rounded-[18px]', text: 'text-[22px]' },
};

type AvatarProps = {
  name?: string | null;
  uri?: string | null;
  size?: Size;
  className?: string;
  tone?: 'primary' | 'neutral';
};

function safeRemoteImageUri(uri?: string | null): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function Avatar({ name, uri, size = 'md', className, tone = 'primary' }: AvatarProps) {
  const initials = useMemo(() => initialsFromName(name), [name]);
  const imageUri = useMemo(() => safeRemoteImageUri(uri), [uri]);
  const s = sizeMap[size];

  if (imageUri) {
    return <Image source={{ uri: imageUri }} className={cn(s.box, className)} />;
  }

  return (
    <View
      className={cn(
        s.box,
        'items-center justify-center',
        tone === 'primary' ? 'bg-primary' : 'bg-surface-raised',
        className
      )}
    >
      <Text className={cn(s.text, 'font-bold', tone === 'primary' ? 'text-white' : 'text-ink-body')}>
        {initials}
      </Text>
    </View>
  );
}
