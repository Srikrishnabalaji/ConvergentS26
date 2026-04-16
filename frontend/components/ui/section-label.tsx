import React from 'react';
import { Text, type TextProps } from 'react-native';
import { cn } from '@/lib/cn';

export function SectionLabel({ className, children, ...rest }: TextProps) {
  return (
    <Text
      className={cn(
        'text-xs font-bold text-ink-muted uppercase tracking-[1.2px] mb-2.5 mt-1',
        className
      )}
      {...rest}
    >
      {children}
    </Text>
  );
}
