"use client";

import React, { useState, useRef, useEffect } from "react";
import { Menu, LucideIcon, User, ChevronDown } from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  hasNotification?: boolean;
}

interface TopBarProps {
  role: "homeowner" | "cleaner" | "manager" | "admin";
  user: any;
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onMobileMenuClick?: () => void;
}

const TopBar: React.FC<TopBarProps> = ({
  role,
  user,
  tabs,
  activeTab,
  onTabChange,
  onMobileMenuClick,
}) => {
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsUserDropdownOpen(false);
      }
    };

    if (isUserDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUserDropdownOpen]);

  return (
    <header className="bg-white shadow-md fixed top-0 left-0 md:left-[260px] right-0 z-50">
      <div className="h-16 px-4 sm:px-6 lg:px-8 pt-8 md:pt-0 relative flex items-center">
        {/* Mobile Menu Button - Left */}
        <button
          onClick={onMobileMenuClick}
          className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6 text-gray-600" />
        </button>

        {/* Mobile Title */}
        <div className="md:hidden flex-1 min-w-0 ml-3">
          <h1 className="text-lg font-semibold text-gray-900 truncate">
            {tabs.find((t) => t.id === activeTab)?.label || "Dashboard"}
          </h1>
        </div>

        {/* Desktop Navigation Tabs - Centered to Full Width */}
        <nav className="hidden md:flex items-center justify-center space-x-1 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 relative ${
                  isActive
                    ? "text-primary-600 bg-primary-50"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                }`}
              >
                <div className="relative">
                  <Icon className="w-5 h-5" />
                  {tab.hasNotification && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-yellow-500 rounded-full border-2 border-white" />
                  )}
                </div>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Profile - Right */}
        {user && (
          <div className="hidden md:block relative ml-auto" ref={dropdownRef}>
            <button
              onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
              className="flex items-center space-x-3 text-gray-700 hover:text-primary-600 transition-colors duration-200 px-3 py-2 rounded-lg hover:bg-gray-50"
            >
              <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-primary-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900">
                  {user.profile.firstName || user.profile.lastName
                    ? `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim()
                    : user.email}
                </p>
                <p className="text-xs text-gray-500 capitalize">{role}</p>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {isUserDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg py-1 z-50 border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">
                    {user.profile.firstName || user.profile.lastName
                      ? `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim()
                      : user.email}
                  </p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                  <span className="inline-block mt-2 px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full capitalize">
                    {role}
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default TopBar;
