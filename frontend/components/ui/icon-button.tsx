import React from 'react';
import { TouchableOpacity, View, type TouchableOpacityProps } from 'react-native';
import { cn } from '@/lib/cn';

type IconButtonProps = TouchableOpacityProps & {
  size?: number;
  tone?: 'onPrimary' | 'surface' | 'danger';
  children: React.ReactNode;
};

export function IconButton({
  size = 36,
  tone = 'onPrimary',
  children,
  className,
  style,
  ...rest
}: IconButtonProps) {
  const toneClass =
    tone === 'onPrimary'
      ? 'bg-white/15'
      : tone === 'danger'
      ? 'bg-danger-bg border border-danger-border'
      : 'bg-white border border-line';

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[{ width: size, height: size, borderRadius: size / 2 }, style]}
      className={cn('items-center justify-center', toneClass, className)}
      {...rest}
    >
      <View className="items-center justify-center">{children}</View>
    </TouchableOpacity>
  );
}
