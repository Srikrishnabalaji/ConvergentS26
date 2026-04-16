import React from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { cn } from '@/lib/cn';

type TextFieldProps = TextInputProps & {
  label?: string;
  error?: string;
  containerClassName?: string;
  inputClassName?: string;
};

export function TextField({
  label,
  error,
  containerClassName,
  inputClassName,
  placeholderTextColor = '#999',
  ...rest
}: TextFieldProps) {
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Text className="text-sm font-semibold text-ink-body">{label}</Text> : null}
      <TextInput
        placeholderTextColor={placeholderTextColor}
        className={cn(
          'border border-line-neutral rounded-[10px] px-4 py-3.5 text-base text-ink-strong bg-surface-subtle',
          error && 'border-danger',
          inputClassName
        )}
        {...rest}
      />
      {error ? <Text className="text-xs text-danger-strong">{error}</Text> : null}
    </View>
  );
}
