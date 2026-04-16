import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { cn } from '@/lib/cn';

type ChipProps = {
  label: string;
  active?: boolean;
  onPress?: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
  tone?: 'primary' | 'neutral' | 'danger' | 'success';
};

const toneStyles = {
  primary: {
    active: 'bg-primary border-primary',
    inactive: 'bg-white border-line',
    activeText: 'text-white',
    inactiveText: 'text-ink-body',
  },
  neutral: {
    active: 'bg-surface-raised border-line-neutral',
    inactive: 'bg-white border-line',
    activeText: 'text-ink-strong',
    inactiveText: 'text-ink-body',
  },
  danger: {
    active: 'bg-danger-bg border-danger-border',
    inactive: 'bg-white border-line',
    activeText: 'text-danger-strong',
    inactiveText: 'text-ink-body',
  },
  success: {
    active: 'bg-success-bg border-success/30',
    inactive: 'bg-white border-line',
    activeText: 'text-success-text',
    inactiveText: 'text-ink-body',
  },
};

export function Chip({
  label,
  active = false,
  onPress,
  leading,
  trailing,
  className,
  size = 'md',
  tone = 'primary',
}: ChipProps) {
  const t = toneStyles[tone];
  const inner = (
    <View
      className={cn(
        'flex-row items-center border rounded-full',
        size === 'sm' ? 'px-3 py-1' : 'px-3.5 py-1.5',
        active ? t.active : t.inactive,
        className
      )}
    >
      {leading ? <View className="mr-1.5">{leading}</View> : null}
      <Text
        className={cn(
          'font-semibold',
          size === 'sm' ? 'text-xs' : 'text-sm',
          active ? t.activeText : t.inactiveText
        )}
      >
        {label}
      </Text>
      {trailing ? <View className="ml-1.5">{trailing}</View> : null}
    </View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}
