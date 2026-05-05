"use client";

import React, { ReactNode, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface OverviewSectionCardProps {
  icon: ReactNode;
  iconClassName?: string;
  title: string;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  /**
   * When true the section header acts as a toggle on mobile and the body is
   * collapsed when not expanded. Desktop (md+) always shows the body.
   */
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

export default function OverviewSectionCard({
  icon,
  iconClassName = "bg-gray-50 text-gray-600",
  title,
  subtitle,
  headerExtra,
  children,
  collapsible = false,
  defaultExpanded = true,
}: OverviewSectionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerInner = (
    <>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${iconClassName}`}>{icon}</div>
        <div className="text-left">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          {subtitle != null && (
            <span className="text-xs font-medium text-gray-500">
              {subtitle}
            </span>
          )}
        </div>
      </div>
      {collapsible ? (
        <div className="md:hidden p-2 bg-gray-50 rounded-full transition-colors duration-200">
          {expanded ? (
            <ChevronDown className="w-5 h-5 text-gray-500" />
          ) : (
            <ChevronRight className="w-5 h-5 text-gray-500" />
          )}
        </div>
      ) : (
        headerExtra
      )}
    </>
  );

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden w-full">
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full flex items-center justify-between px-4 sm:px-5 py-4 hover:bg-gray-50 transition-colors duration-200 md:cursor-default md:hover:bg-transparent"
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex items-center justify-between px-4 sm:px-5 py-4">
          {headerInner}
        </div>
      )}
      <div
        className={`${
          collapsible && !expanded ? "hidden md:block" : ""
        } border-t border-gray-100 bg-gray-50/60 p-3 sm:p-4`}
      >
        {children}
      </div>
    </div>
  );
}
