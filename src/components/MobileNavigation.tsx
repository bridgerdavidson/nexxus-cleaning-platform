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
  // Cap visible tabs at 4; Menu is the 5th slot.
  const visibleTabs = tabs.slice(0, 4);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-x border-gray-200 z-40 rounded-t-2xl shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around px-2 py-2 h-[5.125rem]">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center w-full min-w-[44px] h-full transition-colors duration-200 relative group ${
                isActive
                  ? "text-primary-700"
                  : "text-gray-500 hover:text-gray-900 active:bg-gray-100/50"
              }`}
            >
              <div className="relative mb-1">
                <Icon
                  className={`w-[22px] h-[22px] transition-colors duration-200 ${
                    isActive ? "text-primary-600" : "text-gray-500 group-hover:text-gray-700"
                  }`}
                  strokeWidth={1.75}
                />
                {tab.hasNotification && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary-600 rounded-full border-2 border-white" />
                )}
              </div>
              <span
                className={`text-[12px] font-medium tracking-wide transition-colors duration-200 ${
                  isActive ? "text-primary-700" : "text-gray-500 group-hover:text-gray-700"
                }`}
              >
                {tab.label}
              </span>
              {isActive && (
                <span
                  aria-hidden
                  className="absolute bottom-1 h-[3px] w-7 rounded-full bg-primary-600"
                />
              )}
            </button>
          );
        })}

        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center w-full min-w-[44px] h-full transition-colors duration-200 text-gray-500 hover:text-gray-900 active:bg-gray-100/50 group"
        >
          <Menu className="w-[22px] h-[22px] mb-1 transition-colors duration-200 group-hover:text-gray-700" strokeWidth={1.75} />
          <span className="text-[12px] font-medium tracking-wide group-hover:text-gray-700">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default MobileNavigation;
