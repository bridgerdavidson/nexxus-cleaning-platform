"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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

const PILL_WIDTH = 28;
const SLIDE_MS = 280;
const EASE = "cubic-bezier(.22,.61,.36,1)";

const MobileNavigation: React.FC<MobileNavigationProps> = ({
  tabs,
  activeTab,
  onTabChange,
  onMenuClick,
}) => {
  // Cap visible tabs at 4; Menu is the 5th slot.
  const visibleTabs = tabs.slice(0, 4);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{ left: number; width: number; opacity: number }>({
    left: 0,
    width: PILL_WIDTH,
    opacity: 0,
  });

  const activeIdx = visibleTabs.findIndex((t) => t.id === activeTab);

  // Smooth glide: animate the pill's left position; width stays constant.
  // When the active tab lives in the drawer (not in visibleTabs), hide the pill.
  useLayoutEffect(() => {
    if (activeIdx < 0) {
      setPillStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const btn = tabRefs.current[activeIdx];
    const parent = containerRef.current;
    if (!btn || !parent) return;

    const btnRect = btn.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const newCenter = btnRect.left - parentRect.left + btnRect.width / 2;
    setPillStyle({ left: newCenter - PILL_WIDTH / 2, width: PILL_WIDTH, opacity: 1 });
  }, [activeIdx]);

  // Re-pin pill on viewport resize (no animation, just snap to new layout).
  useEffect(() => {
    const onResize = () => {
      if (activeIdx < 0) {
        setPillStyle((prev) => ({ ...prev, opacity: 0 }));
        return;
      }
      const btn = tabRefs.current[activeIdx];
      const parent = containerRef.current;
      if (!btn || !parent) return;
      const btnRect = btn.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const center = btnRect.left - parentRect.left + btnRect.width / 2;
      setPillStyle({ left: center - PILL_WIDTH / 2, width: PILL_WIDTH, opacity: 1 });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIdx]);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-lg border-t border-x border-gray-200 z-40 rounded-t-2xl shadow-[0_-2px_12px_rgba(0,0,0,0.06)] pb-[env(safe-area-inset-bottom)]">
      <div
        ref={containerRef}
        className="relative flex items-center justify-around px-2 py-2 h-[5.125rem]"
      >
        {/* Sliding active-pill (lifted out of buttons so it can travel) */}
        <span
          aria-hidden
          className="absolute bottom-1 h-[3px] rounded-full bg-primary-600 will-change-[left]"
          style={{
            left: `${pillStyle.left}px`,
            width: `${pillStyle.width}px`,
            opacity: pillStyle.opacity,
            transition: `left ${SLIDE_MS}ms ${EASE}, opacity 200ms ease-out`,
          }}
        />

        {visibleTabs.map((tab, i) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
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
            </button>
          );
        })}

        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center w-full min-w-[44px] h-full transition-colors duration-200 text-gray-500 hover:text-gray-900 active:bg-gray-100/50 group"
        >
          <Menu
            className="w-[22px] h-[22px] mb-1 transition-colors duration-200 group-hover:text-gray-700"
            strokeWidth={1.75}
          />
          <span className="text-[12px] font-medium tracking-wide group-hover:text-gray-700">Menu</span>
        </button>
      </div>
    </nav>
  );
};

export default MobileNavigation;
