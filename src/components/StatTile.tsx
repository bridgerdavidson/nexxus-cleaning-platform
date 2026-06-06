"use client";

import React from "react";

/**
 * A compact, glanceable KPI tile for the dashboard Overview. Icon-in-colored-box
 * + value + label, matching the app's card language (rounded-2xl white card,
 * shadow-sm). When `onClick` is provided it renders as a button that deep-links
 * into the relevant filtered view. `live` adds a pulsing dot for "in progress".
 */
type StatTone = "primary" | "blue" | "amber" | "green" | "gray" | "red";

const TONE: Record<StatTone, string> = {
  primary: "bg-primary-50 text-primary-600",
  blue: "bg-blue-50 text-blue-600",
  amber: "bg-amber-50 text-amber-600",
  green: "bg-success-50 text-success-600",
  gray: "bg-gray-100 text-gray-600",
  red: "bg-red-50 text-red-600",
};

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: StatTone;
  onClick?: () => void;
  loading?: boolean;
  /** Pulsing dot on the icon to convey a live metric (e.g. jobs in progress). */
  live?: boolean;
}

export default function StatTile({
  icon,
  label,
  value,
  tone = "gray",
  onClick,
  loading = false,
  live = false,
}: StatTileProps) {
  const interactive = typeof onClick === "function";
  const className =
    "flex items-center gap-3 w-full text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-3 sm:p-4" +
    (interactive
      ? " hover:border-primary-300 hover:shadow-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
      : "");

  const inner = (
    <>
      <span className={`relative p-2 rounded-xl shrink-0 ${TONE[tone]}`}>
        {icon}
        {live && (
          <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500 border-2 border-white" />
          </span>
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold text-gray-900 tabular-nums leading-tight">
          {loading ? (
            <span className="inline-block h-5 w-10 rounded bg-gray-100 animate-pulse align-middle" />
          ) : (
            value
          )}
        </span>
        <span className="block text-xs font-medium text-gray-500 leading-tight">{label}</span>
      </span>
    </>
  );

  if (interactive) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {inner}
      </button>
    );
  }
  return <div className={className}>{inner}</div>;
}
