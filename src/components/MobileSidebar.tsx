'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { X, User, Settings, HelpCircle, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  role: 'homeowner' | 'cleaner' | 'manager' | 'admin';
}

const MobileSidebar: React.FC<MobileSidebarProps> = ({ isOpen, onClose, role }) => {
  const { user, signOut } = useAuth();

  // Close sidebar on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  const handleLogout = async () => {
    await signOut();
  };

  // Get dashboard link based on role
  const getDashboardLink = () => {
    switch (role) {
      case 'homeowner':
        return '/homeowner-dashboard';
      case 'cleaner':
        return '/cleaner-dashboard';
      case 'manager':
        return '/manager-dashboard';
      case 'admin':
        return '/admin-dashboard';
      default:
        return '/';
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 bg-black/50 z-50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar Panel */}
      <div
        className={`md:hidden fixed top-0 right-0 bottom-0 w-80 bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header with Logo and Close Button */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <Link href={getDashboardLink()} className="flex items-center" onClick={onClose}>
              <div className="text-2xl font-bold text-primary-600">Nexxus</div>
              <div className="ml-2 text-sm text-gray-600 font-medium">
                Cleaning Solutions
              </div>
            </Link>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <X className="w-6 h-6 text-gray-600" />
            </button>
          </div>

          {/* Profile Section */}
          {user && (
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                  <User className="w-8 h-8 text-primary-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-lg">
                    {user.profile.firstName} {user.profile.lastName}
                  </h3>
                  <p className="text-sm text-gray-600">{user.email}</p>
                  <span className="inline-block mt-1 px-2 py-1 text-xs font-medium bg-primary-100 text-primary-700 rounded-full capitalize">
                    {role}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Navigation Links */}
          <div className="flex-1 p-6 space-y-2">
            <button
              onClick={onClose}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <Settings className="w-5 h-5 text-gray-600" />
              <span className="font-medium text-gray-700">Settings</span>
            </button>
            <button
              onClick={onClose}
              className="w-full flex items-center space-x-3 px-4 py-3 rounded-lg hover:bg-gray-50 transition-colors text-left"
            >
              <HelpCircle className="w-5 h-5 text-gray-600" />
              <span className="font-medium text-gray-700">Help & Support</span>
            </button>
          </div>

          {/* Sign Out Button */}
          <div className="p-6 border-t border-gray-200">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium"
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default MobileSidebar;

