import React from 'react';
import { Text, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { cn } from '@/lib/cn';

type EmptyStateProps = {
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon, title, subtitle, action, className }: EmptyStateProps) {
  return (
    <View className={cn('items-center justify-center px-6 py-10', className)}>
      {icon ? (
        <View className="w-14 h-14 rounded-full bg-primary-soft items-center justify-center mb-3">
          <MaterialIcons name={icon} size={26} color="#0B617E" />
        </View>
      ) : null}
      <Text className="text-base font-bold text-ink-strong text-center">{title}</Text>
      {subtitle ? (
        <Text className="text-sm text-ink-subtle text-center mt-1.5 leading-5">{subtitle}</Text>
      ) : null}
      {action ? <View className="mt-4">{action}</View> : null}
    </View>
  );
}
