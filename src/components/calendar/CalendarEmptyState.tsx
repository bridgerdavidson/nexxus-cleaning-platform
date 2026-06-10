'use client';
import React from 'react';
import { CalendarX2, type LucideIcon } from 'lucide-react';

export default function CalendarEmptyState({
  title,
  message,
  icon: Icon = CalendarX2,
}: {
  title: string;
  message: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold text-gray-700">{title}</p>
      <p className="max-w-xs text-xs text-gray-400">{message}</p>
    </div>
  );
}
