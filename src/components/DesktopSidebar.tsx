"use client";

import React from "react";
import Link from "next/link";
import { LogOut, LucideIcon, User } from "lucide-react";

interface NavigationGroup {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface SidebarUser {
  profile: {
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
  };
  email: string;
  role: string;
}

interface DesktopSidebarProps {
  groups: NavigationGroup[];
  activeGroup: string;
  onGroupChange: (groupId: string) => void;
  onLogout: () => void;
  /** When provided (admin/manager), show profile card above Sign Out */
  user?: SidebarUser | null;
  /** When "settings", no sidebar group is shown as active */
  activeTab?: string;
}

const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  groups,
  activeGroup,
  onGroupChange,
  onLogout,
  user,
  activeTab,
}) => {
  const displayName =
    user?.profile?.firstName || user?.profile?.lastName
      ? `${user.profile.firstName || ""} ${user.profile.lastName || ""}`.trim()
      : user?.email ?? "";

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
            const isActive =
              activeTab !== "settings" && activeGroup === group.id;
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

      {/* Profile + Log out in a subtle grey box (no borders) */}
      <div className="p-4">
        <div className="rounded-xl bg-gray-100/90 p-4">
          {user && (
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-primary-100 flex items-center justify-center">
                {user.profile?.avatarUrl ? (
                  <img
                    src={user.profile.avatarUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-6 h-6 text-primary-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-800 truncate text-sm">
                  {displayName}
                </p>
                <p className="text-xs text-gray-500 capitalize">{user.role}</p>
              </div>
            </div>
          )}
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 text-gray-600 hover:text-gray-900 transition-colors font-medium text-sm"
          >
            <LogOut className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </aside>
  );
};

export default DesktopSidebar;
