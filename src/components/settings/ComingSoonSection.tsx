'use client';

import { LucideIcon } from 'lucide-react';

interface ComingSoonSectionProps {
  icon: LucideIcon;
  /** Short headline, e.g. "Security settings coming soon". */
  title: string;
  /** Paragraph explaining what will land here. */
  description: string;
}

/**
 * Shared body for settings sections that aren't built yet (Security, Notifications).
 * One illustration + headline + paragraph — no fake buttons, no centred whitespace.
 */
export default function ComingSoonSection({
  icon: Icon,
  title,
  description,
}: ComingSoonSectionProps) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 px-6 py-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <Icon className="h-6 w-6 text-gray-400" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-bold text-gray-900">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-gray-500">{description}</p>
    </div>
  );
}
