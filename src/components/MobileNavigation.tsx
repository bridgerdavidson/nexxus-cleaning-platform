"use client";

import React from "react";
import { LucideIcon, Menu } from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  hasNotification?: boolean;
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
    <nav className="md:hidden fixed bottom-4 left-4 right-4 bg-white/95 backdrop-blur-lg border border-gray-200 shadow-xl ring-1 ring-black/5 z-40 pb-safe rounded-[1.25rem] overflow-hidden">
      <div className="flex items-center justify-around px-2 py-2 h-20">
        {/* Navigation Tabs */}
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center w-full min-w-[44px] h-full rounded-xl transition-all duration-200 relative group ${
                isActive
                  ? "text-primary-700"
                  : "text-gray-500 hover:text-gray-900 active:bg-gray-100/50"
              }`}
            >
              {isActive && (
                <div className="absolute inset-0 bg-primary-50 rounded-xl -z-10 scale-95" />
              )}
              <div className="relative mb-1.5">
                <Icon
                  className={`w-6 h-6 transition-transform duration-200 ${
                    isActive ? "text-primary-600 scale-110" : "text-gray-500 group-hover:text-gray-700 group-active:scale-95"
                  }`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {tab.hasNotification && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-primary-600 rounded-full border-2 border-white" />
                )}
              </div>
              <span
                className={`text-xs tracking-wide transition-all duration-200 ${
                  isActive ? "font-bold text-primary-700" : "font-medium text-gray-500 group-hover:text-gray-700"
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
          className="flex flex-col items-center justify-center w-full min-w-[44px] h-full rounded-xl transition-all duration-200 text-gray-500 hover:text-gray-900 active:bg-gray-100/50 group"
        >
          <Menu className="w-6 h-6 mb-1.5 transition-transform duration-200 group-hover:text-gray-700 group-active:scale-95" strokeWidth={2} />
          <span className="text-xs font-medium tracking-wide group-hover:text-gray-700">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default MobileNavigation;
