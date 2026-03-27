'use client';

import React, { useState } from 'react';
import { getSectionsForRole, SettingsSectionId } from '../lib/settings';
import { useAuth } from '../hooks/useAuth';
import SettingsProfileSection from './SettingsProfileSection';
import SettingsPayoutsSection from './SettingsPayoutsSection';

export default function SettingsHub() {
  const { user } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('profile');

  if (!user) return null;

  const sections = getSectionsForRole(user.role);

  // Fallback if active section isn't available for role
  const currentSection = sections.find(s => s.id === activeSection) || sections[0];

  const renderContent = () => {
    switch (currentSection.id) {
      case 'profile':
        return <SettingsProfileSection />;
      case 'payouts':
        return <SettingsPayoutsSection />;
      case 'security':
        return (
          <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0 transition-all duration-300 group">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">Security Settings</h2>
            <p className="text-gray-500 max-w-sm mt-1">
              Password management and two-factor authentication will be available here soon.
            </p>
          </div>
        );
      case 'notifications':
        return (
          <div className="card flex flex-col items-center justify-center text-center py-24 mx-1 md:mx-0 transition-all duration-300 group">
        <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2 group-hover:text-primary-600 transition-colors">Notification Preferences</h2>
            <p className="text-gray-500 max-w-sm mt-1">
              Manage your email, SMS, and push notification preferences here.
            </p>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-full flex flex-col md:flex-row gap-6 md:gap-12 pb-16">
      {/* Settings Navigation */}
      <nav className="w-full md:w-[260px] flex flex-row md:flex-col gap-2 overflow-x-auto pb-4 md:pb-0 scrollbar-hide shrink-0 md:pr-4 md:sticky md:top-24 md:self-start">
        {sections.map((section) => {
          const Icon = section.icon;
          const isActive = currentSection.id === section.id;
          return (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`flex items-center gap-3.5 px-5 py-3 rounded-xl transition-all duration-200 whitespace-nowrap text-sm font-medium group ${
                isActive
                  ? 'bg-white shadow-sm border border-gray-200 text-gray-900'
                  : 'hover:bg-gray-50 border border-transparent text-gray-600'
              }`}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ${isActive ? 'text-primary-600' : 'text-gray-400 group-hover:text-gray-600'}`} />
              <span className={`transition-colors duration-300 ${isActive ? 'text-gray-900' : 'text-gray-500 group-hover:text-gray-900'}`}>{section.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Settings Content Area */}
      <div className="flex-1 min-w-0 pb-16 w-full max-w-2xl">
        {renderContent()}
      </div>
    </div>
  );
}
