"use client";

import React from "react";
import Link from "next/link";
import { LogOut, LucideIcon } from "lucide-react";

interface NavigationGroup {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface DesktopSidebarProps {
  groups: NavigationGroup[];
  activeGroup: string;
  onGroupChange: (groupId: string) => void;
  onLogout: () => void;
}

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  groups,
  activeGroup,
  onGroupChange,
  onLogout,
}) => {
  return (
    <aside className="hidden md:flex flex-col fixed left-0 top-0 h-screen w-[260px] bg-gray-50 z-40">
      {/* Logo Section */}
      <div className="p-6 flex justify-center">
        <Link href="/" className="flex items-center">
          <div className="text-3xl font-bold text-primary-600">Nexxus</div>
        </Link>
      </div>

      {/* Group Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        <div className="space-y-1">
          {groups.map((group) => {
            const Icon = group.icon;
            const isActive = activeGroup === group.id;
            return (
              <button
                key={group.id}
                onClick={() => onGroupChange(group.id)}
                className={`w-full flex items-center px-4 py-3 rounded-lg transition-all duration-200 relative ${
                  isActive
                    ? "bg-white text-primary-700 ring-1 ring-primary-100/80"
                    : "text-gray-600 hover:bg-white/80 hover:text-gray-900"
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-600 rounded-r-full" />
                )}
                <Icon
                  className={`flex-shrink-0 w-5 h-5 mr-3 ${
                    isActive ? "text-primary-600" : "text-gray-400"
                  }`}
                />
                <span
                  className={`font-medium text-sm truncate ${
                    isActive ? "font-semibold" : ""
                  }`}
                >
                  {group.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Sign Out Button */}
      <div className="p-4">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center px-4 py-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium text-sm"
        >
          <LogOut className="w-4 h-4 mr-2" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
};

export default DesktopSidebar;
