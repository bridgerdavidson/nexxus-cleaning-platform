"use client";

import React from "react";
import { Menu, LucideIcon } from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface DashboardHeaderProps {
  role: "homeowner" | "cleaner" | "manager" | "admin";
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  onMenuClick?: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  tabs = [],
  activeTab,
  onTabChange,
  onMenuClick,
}) => {
  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
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

          {/* Navigation Tabs */}
          {tabs.length > 0 && (
            <nav className="hidden md:flex items-center space-x-1 flex-1 justify-center px-8">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange?.(tab.id)}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
                      activeTab === tab.id
                        ? "text-primary-600 bg-primary-50"
                        : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* Menu Icon */}
          <div className="flex items-center flex-shrink-0">
            <button
              onClick={onMenuClick}
              className="p-2 rounded-lg text-gray-600 hover:text-primary-600 hover:bg-gray-50 transition-colors duration-200"
              aria-label="Open menu"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
