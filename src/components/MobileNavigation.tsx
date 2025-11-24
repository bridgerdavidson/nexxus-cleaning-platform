"use client";

import React from "react";
import { LucideIcon, Menu } from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface MobileNavigationProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onMenuClick: () => void;
}

const MobileNavigation: React.FC<MobileNavigationProps> = ({
  tabs,
  activeTab,
  onTabChange,
  onMenuClick,
}) => {
  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-40 pb-safe">
      <div className="flex items-center justify-around px-2 py-2">
        {/* Navigation Tabs */}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-lg transition-all duration-200 ${
                isActive
                  ? "text-primary-600"
                  : "text-gray-600 hover:text-gray-900"
              }`}
            >
              <Icon
                className={`w-6 h-6 mb-1 ${
                  isActive ? "text-primary-600" : "text-gray-600"
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isActive ? "text-primary-600" : "text-gray-600"
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}

        {/* Menu Button */}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center min-w-[60px] py-2 px-3 rounded-lg transition-all duration-200 text-gray-600 hover:text-gray-900"
        >
          <Menu className="w-6 h-6 mb-1" />
          <span className="text-xs font-medium">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default MobileNavigation;
