"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { X, User, LogOut, LucideIcon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useThemeColor } from "../hooks/useThemeColor";
import { MENU_OVERLAY_COLOR } from "../constants/theme";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  role: "homeowner" | "cleaner" | "manager" | "admin";
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

const MobileSidebar: React.FC<MobileSidebarProps> = ({
  isOpen,
  onClose,
  role,
  tabs = [],
  activeTab,
  onTabChange,
}) => {
  const { user, signOut } = useAuth();

  useThemeColor(MENU_OVERLAY_COLOR, isOpen);

  // Close sidebar on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  const handleLogout = async () => {
    await signOut();
  };

  // Get dashboard link based on role
  const getDashboardLink = () => {
    switch (role) {
      case "homeowner":
        return "/homeowner-dashboard";
      case "cleaner":
        return "/cleaner-dashboard";
      case "manager":
        return "/manager-dashboard";
      case "admin":
        return "/admin-dashboard";
      default:
        return "/";
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Sidebar Panel */}
      <div
        className={`md:hidden fixed top-0 right-0 bottom-0 w-80 bg-white shadow-2xl border-l border-gray-100 z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header with Logo and Close Button */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 p-6 border-b border-gray-200">
            <div aria-hidden="true" />
            <Link
              href={getDashboardLink()}
              className="flex items-center justify-center"
              onClick={onClose}
            >
              <div className="text-2xl font-bold text-primary-600">Nexxus</div>
            </Link>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <X className="w-6 h-6 text-gray-600" />
              </button>
            </div>
          </div>

          {/* Profile Section */}
          {user && (
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-primary-100 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                  {user.profile.avatarUrl ? (
                    <img
                      src={user.profile.avatarUrl}
                      alt="Profile"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-primary-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 text-lg truncate">
                    {user.profile.firstName || user.profile.lastName
                      ? `${user.profile.firstName || ""} ${user.profile.lastName || ""}`.trim()
                      : user.email}
                  </h3>
                  <p className="text-sm text-gray-600 truncate">{user.email}</p>
                  <span className="inline-block mt-1 px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full capitalize">
                    {role}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Links */}
          <div className="flex-1 p-4 space-y-1.5 overflow-y-auto">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    onTabChange?.(tab.id);
                    onClose();
                  }}
                  className={`w-full flex items-center space-x-3 px-4 py-3.5 rounded-xl transition-all duration-200 text-left active:scale-[0.98] ${
                    isActive
                      ? "bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 active:bg-gray-100"
                  }`}
                >
                  <Icon
                    className={`w-[22px] h-[22px] transition-transform ${
                      isActive ? "text-primary-600 scale-110" : "text-gray-400"
                    }`}
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  <span
                    className={`font-medium text-[15px] ${
                      isActive ? "font-bold tracking-tight" : ""
                    }`}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sign Out Button */}
          <div className="p-6 border-t border-gray-200">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium"
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default MobileSidebar;
