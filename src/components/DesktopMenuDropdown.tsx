"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { X, User, LogOut, LucideIcon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  hasNotification?: boolean;
}

interface DesktopMenuDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  role: "homeowner" | "cleaner" | "manager" | "admin";
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

const DesktopMenuDropdown: React.FC<DesktopMenuDropdownProps> = ({
  isOpen,
  onClose,
  role,
  tabs = [],
  activeTab,
  onTabChange,
}) => {
  const { user, signOut, signOutEverywhere } = useAuth();

  // Close sidebar on escape key + lock body scroll only while open
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
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
      {/* Backdrop - only mounted while open to avoid stale compositing layers */}
      {isOpen && (
        <button
          type="button"
          aria-label="Close menu"
          className="hidden md:block fixed inset-0 bg-black/50 z-40"
          onClick={onClose}
        />
      )}

      {/* Sidebar Panel */}
      <div
        className={`hidden md:flex fixed top-0 right-0 bottom-0 w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex flex-col h-full w-full">
          {/* Header with Logo and Close Button */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <Link
              href={getDashboardLink()}
              className="flex items-center"
              onClick={onClose}
            >
              <div className="text-2xl font-bold text-primary-600">Nexxus</div>
              <div className="ml-2 text-sm text-gray-600 font-medium">
                Cleaning Solutions
              </div>
            </Link>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-6 h-6 text-gray-600" />
            </button>
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
          <div className="flex-1 p-6 space-y-2 overflow-y-auto">
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
                  className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors text-left ${
                    isActive
                      ? "bg-primary-50 text-primary-700"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  }`}
                >
                  <div className="relative">
                    <Icon
                      className={`w-5 h-5 ${
                        isActive ? "text-primary-600" : "text-gray-400"
                      }`}
                    />
                    {tab.hasNotification && (
                      <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border-2 border-white" />
                    )}
                  </div>
                  <span
                    className={`font-medium text-base ${
                      isActive ? "font-semibold" : ""
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
            <button
              onClick={() => void signOutEverywhere()}
              className="mt-2 w-full text-center text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              Sign out of all devices
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default DesktopMenuDropdown;
