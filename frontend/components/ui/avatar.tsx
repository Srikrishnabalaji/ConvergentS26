import React, { useMemo } from 'react';
import { Image, Text, View } from 'react-native';
import { cn } from '@/lib/cn';

type Size = 'sm' | 'md' | 'lg' | 'xl';

const sizeMap: Record<Size, { box: string; text: string }> = {
  sm: { box: 'w-8 h-8 rounded-lg', text: 'text-xs' },
  md: { box: 'w-11 h-11 rounded-xl', text: 'text-base' },
  lg: { box: 'w-14 h-14 rounded-2xl', text: 'text-lg' },
  xl: { box: 'w-16 h-16 rounded-[18px]', text: 'text-[22px]' },
};

export function initialsFromName(name?: string | null): string {
  if (!name) return 'U';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

type AvatarProps = {
  name?: string | null;
  uri?: string | null;
  size?: Size;
  className?: string;
  tone?: 'primary' | 'neutral';
};

export function Avatar({ name, uri, size = 'md', className, tone = 'primary' }: AvatarProps) {
  const initials = useMemo(() => initialsFromName(name), [name]);
  const s = sizeMap[size];

  if (uri) {
    return <Image source={{ uri }} className={cn(s.box, className)} />;
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
