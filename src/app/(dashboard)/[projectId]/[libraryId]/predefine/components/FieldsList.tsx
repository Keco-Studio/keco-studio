'use client';
import { useState, useEffect } from 'react';
import type { FieldConfig } from '../types';
import { FieldItem } from './FieldItem';
import styles from './FieldsList.module.css';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

interface FieldsListProps {
  fields: FieldConfig[];
  /** Update field directly when editing inline */
  onChangeField: (fieldId: string, data: Omit<FieldConfig, 'id'>) => void;
  onDeleteField: (fieldId: string) => void;
  /** Reorder fields array after drag-and-drop */
  onReorderFields: (newOrder: FieldConfig[]) => void;
  disabled?: boolean;
  isFirstSection?: boolean;
}

export function FieldsList({ fields, onChangeField, onDeleteField, onReorderFields, disabled, isFirstSection = false }: FieldsListProps) {
  // Local state for optimistic UI updates during drag
  const [localFields, setLocalFields] = useState(fields);
  
  // Sync local state when props change (but not during drag operations)
  useEffect(() => {
    if (!disabled) {
      setLocalFields(fields);
    }
  }, [fields, disabled]);
  
  // Configure sensors for drag interactions
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts (prevents accidental drags)
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || active.id === over.id) {
      return; // No change needed
    }
    
    const oldIndex = localFields.findIndex((f) => f.id === active.id);
    const newIndex = localFields.findIndex((f) => f.id === over.id);
    
    if (oldIndex !== -1 && newIndex !== -1) {
      const newOrder = arrayMove(localFields, oldIndex, newIndex);
      setLocalFields(newOrder);
      
      // Update parent state with new field order
      // The order_index will be calculated from array position when saving
      onReorderFields(newOrder);
    }
  };
  
  if (fields.length === 0) {
    return null;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={localFields.map((f) => f.id)}
        strategy={verticalListSortingStrategy}
        disabled={disabled}
      >
        <div className={styles.fieldsList}>
          {localFields.map((field, index) => {
            // If this is in the first section, and label is 'name', type is 'string', then it's a mandatory field (regardless of position)
            const isMandatoryNameField = isFirstSection && field.label === 'name' && field.dataType === 'string';
            
            return (
              <FieldItem
                key={field.id}
                field={field}
                onChangeField={onChangeField}
                onDelete={onDeleteField}
                isFirst={index === 0}
                disabled={disabled}
                isMandatoryNameField={isMandatoryNameField}
                isDraggable={!disabled}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
