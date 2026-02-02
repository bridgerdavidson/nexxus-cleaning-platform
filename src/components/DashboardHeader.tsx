"use client";

import React, { useState, useRef } from "react";
import { Menu, LucideIcon } from "lucide-react";
import DesktopMenuDropdown from "./DesktopMenuDropdown";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  hasNotification?: boolean;
}

interface DashboardHeaderProps {
  role: "homeowner" | "cleaner" | "manager" | "admin";
  tabs?: Tab[];
  sidebarTabs?: Tab[]; // Separate tabs for sidebar (defaults to tabs if not provided)
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  onMenuClick?: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  role,
  tabs = [],
  sidebarTabs,
  activeTab,
  onTabChange,
  onMenuClick,
}) => {
  // Use sidebarTabs if provided, otherwise fall back to tabs
  const tabsForSidebar = sidebarTabs ?? tabs;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const handleMenuToggle = () => {
    if (onMenuClick) {
      onMenuClick();
    } else {
      setIsMenuOpen(!isMenuOpen);
    }
  };

  const handleMenuClose = () => {
    setIsMenuOpen(false);
  };

  return (
    <>
      <header className="bg-white shadow-sm fixed top-0 left-0 right-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8 pt-8 md:pt-0">
          <div className="flex justify-between items-center h-16 relative">
            {/* Logo */}
            <div className="flex-shrink-0">
              <button
                onClick={() => onTabChange?.("home")}
                className="flex items-center hover:opacity-80 transition-opacity"
              >
                <div className="text-2xl font-bold text-primary-600">Nexxus</div>
                <div className="ml-2 text-sm text-gray-600 font-medium hidden sm:block">
                  Cleaning Solutions
                </div>
              </button>
            </div>

            {/* Navigation Tabs - Centered */}
            {tabs.length > 0 && (
              <nav className="hidden md:flex items-center space-x-1 absolute left-1/2 transform -translate-x-1/2">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => onTabChange?.(tab.id)}
                      className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 relative ${
                        activeTab === tab.id
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
            )}

            {/* Menu Icon */}
            <div className="flex items-center flex-shrink-0">
              <button
                ref={menuButtonRef}
                onClick={handleMenuToggle}
                className={`p-2 rounded-lg transition-colors duration-200 ${
                  isMenuOpen
                    ? "text-primary-600 bg-gray-50"
                    : "text-gray-600 hover:text-primary-600 hover:bg-gray-50"
                }`}
                aria-label="Open menu"
              >
                <Menu className="w-6 h-6" />
              </button>
            </div>
          </div>
        </div>
      </header>
      {/* Desktop Sidebar - rendered outside header for proper positioning */}
      {!onMenuClick && (
        <DesktopMenuDropdown
          isOpen={isMenuOpen}
          onClose={handleMenuClose}
          role={role}
          tabs={tabsForSidebar}
          activeTab={activeTab}
          onTabChange={onTabChange}
        />
      )}
    </>
  );
};

export default DashboardHeader;
