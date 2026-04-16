import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, type TouchableOpacityProps } from 'react-native';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

type ButtonProps = Omit<TouchableOpacityProps, 'children'> & {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  block?: boolean;
  className?: string;
  textClassName?: string;
};

const variantMap: Record<Variant, { box: string; text: string; activityColor: string; shadow?: boolean }> = {
  primary: {
    box: 'bg-primary',
    text: 'text-white',
    activityColor: '#fff',
    shadow: true,
  },
  secondary: {
    box: 'bg-white border border-line',
    text: 'text-ink-strong',
    activityColor: '#0B617E',
  },
  outline: {
    box: 'bg-transparent border border-primary',
    text: 'text-primary',
    activityColor: '#0B617E',
  },
  danger: {
    box: 'bg-white border border-danger-border',
    text: 'text-danger-strong',
    activityColor: '#b91c1c',
  },
  ghost: {
    box: 'bg-transparent',
    text: 'text-primary',
    activityColor: '#0B617E',
  },
};

const sizeMap: Record<Size, { box: string; text: string }> = {
  sm: { box: 'px-3 py-2 rounded-lg', text: 'text-sm' },
  md: { box: 'px-4 py-3 rounded-xl', text: 'text-base' },
  lg: { box: 'px-5 py-4 rounded-xl', text: 'text-base' },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  leading,
  trailing,
  block = false,
  disabled,
  className,
  textClassName,
  style,
  ...rest
}: ButtonProps) {
  const v = variantMap[variant];
  const s = sizeMap[size];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.85}
      style={[v.shadow ? shadows.primaryBtn : undefined, style]}
      className={cn(
        'flex-row items-center justify-center',
        s.box,
        v.box,
        block && 'self-stretch',
        isDisabled && 'opacity-60',
        className
      )}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={v.activityColor} />
      ) : (
        <>
          {leading ? <View className="mr-2">{leading}</View> : null}
          <Text className={cn('font-bold', s.text, v.text, textClassName)}>{label}</Text>
          {trailing ? <View className="ml-2">{trailing}</View> : null}
        </>
      )}
    </TouchableOpacity>
  );
}
