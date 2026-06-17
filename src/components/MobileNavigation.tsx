"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LucideIcon, Menu } from "lucide-react";

interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  hasNotification?: boolean;
  /** When > 0, render a numeric count badge instead of the plain dot. */
  notificationCount?: number;
}

interface MobileNavigationProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  onMenuClick: () => void;
}

// Active-tab indicator: a soft gold capsule that slides behind the active icon.
const CAPSULE_WIDTH = 56;
const CAPSULE_HEIGHT = 32;
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
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [pillStyle, setPillStyle] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    opacity: number;
  }>({
    left: 0,
    top: 0,
    width: CAPSULE_WIDTH,
    height: CAPSULE_HEIGHT,
    opacity: 0,
  });

  const activeIdx = visibleTabs.findIndex((t) => t.id === activeTab);

  // Smooth glide: animate the capsule's position behind the active icon.
  // When the active tab lives in the drawer (not in visibleTabs), hide it.
  useLayoutEffect(() => {
    if (activeIdx < 0) {
      setPillStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const icon = iconRefs.current[activeIdx];
    const parent = containerRef.current;
    if (!icon || !parent) return;

    const iconRect = icon.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const centerX = iconRect.left - parentRect.left + iconRect.width / 2;
    const centerY = iconRect.top - parentRect.top + iconRect.height / 2;
    setPillStyle({
      left: centerX - CAPSULE_WIDTH / 2,
      top: centerY - CAPSULE_HEIGHT / 2,
      width: CAPSULE_WIDTH,
      height: CAPSULE_HEIGHT,
      opacity: 1,
    });
  }, [activeIdx]);

  // Re-pin capsule on viewport resize (no animation, just snap to new layout).
  useEffect(() => {
    const onResize = () => {
      if (activeIdx < 0) {
        setPillStyle((prev) => ({ ...prev, opacity: 0 }));
        return;
      }
      const icon = iconRefs.current[activeIdx];
      const parent = containerRef.current;
      if (!icon || !parent) return;
      const iconRect = icon.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      const centerX = iconRect.left - parentRect.left + iconRect.width / 2;
      const centerY = iconRect.top - parentRect.top + iconRect.height / 2;
      setPillStyle({
        left: centerX - CAPSULE_WIDTH / 2,
        top: centerY - CAPSULE_HEIGHT / 2,
        width: CAPSULE_WIDTH,
        height: CAPSULE_HEIGHT,
        opacity: 1,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeIdx]);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-40 pb-[env(safe-area-inset-bottom)]">
      <div
        ref={containerRef}
        className="relative flex items-center justify-around px-2 py-2 h-16"
      >
        {/* Sliding active-tab indicator (lifted out of buttons so it can travel
            smoothly between tabs). A soft gold capsule that sits behind the
            active icon; the icon paints on top (later in DOM order). */}
        <span
          aria-hidden
          className="absolute rounded-xl bg-primary-100 will-change-[left,top]"
          style={{
            left: `${pillStyle.left}px`,
            top: `${pillStyle.top}px`,
            width: `${pillStyle.width}px`,
            height: `${pillStyle.height}px`,
            opacity: pillStyle.opacity,
            transition: `left ${SLIDE_MS}ms ${EASE}, top ${SLIDE_MS}ms ${EASE}, opacity 200ms ease-out`,
          }}
        />
        {/* ROLLBACK: to restore the 3px sliding underline pill instead of the
            capsule above, render this span instead, and in BOTH measuring
            effects use the button's width/center (constant width 28) instead of
            the icon's box:
              <span
                aria-hidden
                className="absolute bottom-1 h-[3px] rounded-full bg-primary-600 will-change-[left]"
                style={{
                  left: `${pillStyle.left}px`,
                  width: `28px`,
                  opacity: pillStyle.opacity,
                  transition: `left ${SLIDE_MS}ms ${EASE}, opacity 200ms ease-out`,
                }}
              />
            i.e. measure tabRefs[activeIdx] (still set below) and set
            left = btnCenter - 14; top/height go unused. */}

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
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-col items-center justify-center w-full min-w-[44px] h-full transition-colors duration-200 relative group ${
                isActive
                  ? "text-primary-700"
                  : "text-gray-500 hover:text-gray-900 active:bg-gray-100/50"
              }`}
            >
              <div
                ref={(el) => {
                  iconRefs.current[i] = el;
                }}
                className="relative mb-1"
              >
                <Icon
                  className={`w-[22px] h-[22px] transition-colors duration-200 ${
                    isActive ? "text-primary-600" : "text-gray-500 group-hover:text-gray-700"
                  }`}
                  strokeWidth={1.75}
                />
                {typeof tab.notificationCount === "number" && tab.notificationCount > 0 ? (
                  <>
                    <span
                      aria-hidden
                      className="absolute -top-2 -right-2.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary-600 text-white text-[10px] font-bold leading-none flex items-center justify-center border-2 border-white tabular-nums"
                    >
                      {tab.notificationCount > 99 ? "99+" : tab.notificationCount}
                    </span>
                    <span className="sr-only">
                      {tab.notificationCount} need your attention
                    </span>
                  </>
                ) : tab.hasNotification ? (
                  <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary-600 rounded-full border-2 border-white" />
                ) : null}
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
