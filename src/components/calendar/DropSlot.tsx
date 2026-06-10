/**
 * A 15-minute droppable band inside a time column. Encodes its target in the id
 * (`slot:<date>:<minutes>` for week, `slot:<cleanerId>:<date>:<minutes>` for the dispatch
 * board). Mounted only while a drag is active (perf). Highlights when hovered.
 */
'use client';
import React from 'react';
import { useDroppable } from '@dnd-kit/core';

export default function DropSlot({
  id,
  top,
  height,
}: {
  id: string;
  top: number;
  height: number;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`absolute inset-x-0 z-0 transition-colors ${
        isOver ? 'bg-primary-100/70 ring-1 ring-inset ring-primary-400' : ''
      }`}
      style={{ top, height }}
      aria-hidden="true"
    />
  );
}
