import React from 'react';
import { Modal, Pressable, type DimensionValue, type ModalProps } from 'react-native';
import { shadows } from '@/constants/shadows';
import { cn } from '@/lib/cn';

type BottomSheetProps = Omit<ModalProps, 'children'> & {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxHeight?: DimensionValue;
  sheetClassName?: string;
};

export function BottomSheet({
  visible,
  onClose,
  children,
  maxHeight = '85%',
  sheetClassName,
  ...rest
}: BottomSheetProps) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} {...rest}>
      <Pressable className="flex-1 bg-black/40 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={[shadows.sheet, { maxHeight }]}
          className={cn('bg-white rounded-t-[20px] p-6 pb-9', sheetClassName)}
        >
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
