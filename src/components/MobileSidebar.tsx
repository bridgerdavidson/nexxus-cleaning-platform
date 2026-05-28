"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X, User, LogOut, ChevronRight, LucideIcon } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

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

const SWIPE_CLOSE_THRESHOLD = 60;

function timeOfDayGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
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
  const router = useRouter();

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Swipe-right-to-close with direction lock so vertical scrolling in the
  // nav region doesn't trigger horizontal drift. Once the user moves >10px
  // in either axis we commit to that axis; only horizontal-dominant drags
  // translate the panel.
  const dragStartX = useRef<number | null>(null);
  const dragStartY = useRef<number | null>(null);
  const dragAxis = useRef<"x" | "y" | null>(null);
  const [dragX, setDragX] = useState(0);
  const isDragging = dragAxis.current === "x";

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartX.current = e.touches[0].clientX;
    dragStartY.current = e.touches[0].clientY;
    dragAxis.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (dragStartX.current === null || dragStartY.current === null) return;
    const dx = e.touches[0].clientX - dragStartX.current;
    const dy = e.touches[0].clientY - dragStartY.current;

    if (dragAxis.current === null) {
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
        dragAxis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
    }

    if (dragAxis.current === "x" && dx > 0) {
      setDragX(dx);
    }
  };

  const handleTouchEnd = () => {
    if (dragAxis.current === "x" && dragX > SWIPE_CLOSE_THRESHOLD) onClose();
    dragStartX.current = null;
    dragStartY.current = null;
    dragAxis.current = null;
    setDragX(0);
  };

  const handleProfileTap = () => {
    onClose();
    router.push("/settings");
  };

  const handleLogout = async () => {
    await signOut();
  };

  const displayName =
    user?.profile?.firstName || user?.profile?.lastName
      ? `${user?.profile?.firstName || ""} ${user?.profile?.lastName || ""}`.trim()
      : (user?.email ?? "");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-hidden={!isOpen}
      className={`md:hidden fixed inset-0 z-50 bg-white transform ${
        isDragging ? "" : "transition-transform duration-300 ease-in-out"
      } ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      style={
        isDragging && dragX > 0
          ? { transform: `translateX(${dragX}px)` }
          : undefined
      }
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {/* Floating close button — sits above safe area */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close menu"
        className="absolute right-4 z-10 p-2.5 rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <X className="w-6 h-6 text-gray-600" />
      </button>

      <div
        className="flex flex-col h-full"
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Profile hero — tappable → opens Settings */}
        {user && (
          <>
            <button
              type="button"
              onClick={handleProfileTap}
              className="flex items-center gap-4 px-6 pt-16 pb-6 text-left hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="w-16 h-16 bg-primary-100 rounded-full overflow-hidden flex items-center justify-center flex-shrink-0">
                {user.profile?.avatarUrl ? (
                  <img
                    src={user.profile.avatarUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8 text-primary-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 mb-0.5">
                  {timeOfDayGreeting()}
                </p>
                <h3 className="font-semibold text-gray-900 text-lg truncate">
                  {displayName}
                </h3>
                <p className="text-sm text-gray-600 truncate">{user.email}</p>
                <span className="inline-block mt-1.5 px-2 py-0.5 text-[11px] font-medium bg-primary-100 text-primary-700 rounded-full capitalize">
                  {role}
                </span>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </button>
            <div className="mx-6 border-b border-gray-100" />
          </>
        )}

        {/* Nav list */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  onTabChange?.(tab.id);
                  onClose();
                }}
                className={`w-full flex items-center px-4 py-3 rounded-lg transition-colors duration-200 relative ${
                  isActive
                    ? "bg-gray-50 text-primary-700"
                    : "text-gray-600 hover:bg-gray-50 active:bg-gray-100"
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary-600 rounded-r-full" />
                )}
                <Icon
                  className={`flex-shrink-0 w-5 h-5 mr-3 ${
                    isActive ? "text-primary-600" : "text-gray-400"
                  }`}
                />
                <span
                  className={`font-medium text-[15px] truncate ${
                    isActive ? "font-semibold" : ""
                  }`}
                >
                  {tab.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Subtle log out */}
        <div className="px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-3 text-gray-600 hover:text-gray-900 active:bg-gray-50 transition-colors font-medium text-[15px] rounded-lg"
          >
            <LogOut className="w-4 h-4" />
            <span>Log out</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default MobileSidebar;
