/** Wraps EventChip with @dnd-kit draggable behavior. `disabled` keeps it click-only. */
'use client';
import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import EventChip from './EventChip';
import type { CalendarEvent } from '@/lib/calendar/types';

export default function DraggableEventChip({
  event,
  onClick,
  style,
  hideCleaner = false,
  disabled = false,
}: {
  event: CalendarEvent;
  onClick?: () => void;
  style?: React.CSSProperties;
  hideCleaner?: boolean;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: event.id,
    data: { event },
    disabled,
  });

  return (
    <EventChip
      event={event}
      onClick={onClick}
      style={style}
      hideCleaner={hideCleaner}
      isDragging={isDragging}
      innerRef={setNodeRef}
      dragHandleProps={disabled ? undefined : { ...listeners, ...attributes }}
    />
  );
}
