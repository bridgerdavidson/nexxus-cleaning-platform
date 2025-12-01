"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../hooks/useAuth";
import { ChevronDown, LogOut, User, LucideIcon } from "lucide-react";

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
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  role,
  tabs = [],
  activeTab,
  onTabChange,
}) => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleLogout = () => {
    // Close dropdown immediately
    setIsUserDropdownOpen(false);

    // Redirect immediately for instant UI feedback
    router.push("/login");

    // Sign out in background (fire and forget)
    // Don't wait for it - user already sees the redirect
    signOut().catch((error) => {
      // signOut is designed to always clear local state, so even on error
      // the user should be logged out locally
      console.error("Logout error:", error);
    });
  };

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
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo */}
          <div className="flex-shrink-0">
            <Link href={getDashboardLink()} className="flex items-center">
              <div className="text-2xl font-bold text-primary-600">Nexxus</div>
              <div className="ml-2 text-sm text-gray-600 font-medium hidden sm:block">
                Cleaning Solutions
              </div>
            </Link>
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

          {/* User Profile */}
          <div className="flex items-center flex-shrink-0">
            {user ? (
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setIsUserDropdownOpen(!isUserDropdownOpen)}
                  className="flex items-center space-x-2 text-gray-700 hover:text-primary-600 transition-colors duration-200"
                >
                  <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-primary-600" />
                  </div>
                  <span className="hidden sm:block font-medium">
                    {user.profile.firstName} {user.profile.lastName}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>

                {isUserDropdownOpen && (
                  <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200">
                    <div className="px-4 py-2 border-b border-gray-100">
                      <p className="text-sm font-medium text-gray-900">
                        {user.profile.firstName} {user.profile.lastName}
                      </p>
                      <p className="text-xs text-gray-500 capitalize">{role}</p>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      <div className="flex items-center space-x-2">
                        <LogOut className="w-4 h-4" />
                        <span>Sign Out</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="text-gray-700 hover:text-primary-600 font-medium transition-colors duration-200"
              >
                Login
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default DashboardHeader;
