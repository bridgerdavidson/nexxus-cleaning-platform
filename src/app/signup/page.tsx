'use client';

import React from 'react';
import Link from 'next/link';
import { Home, Sparkles, Users, Shield, ArrowLeft } from 'lucide-react';

export default function SignupRoleSelector() {
  const roles = [
    {
      id: 'homeowner',
      title: 'Homeowner',
      description: 'Book professional cleaning services for your home',
      icon: Home,
      color: 'primary',
      featured: true,
    },
    {
      id: 'cleaner',
      title: 'Cleaner',
      description: 'Join our team and start accepting cleaning jobs',
      icon: Sparkles,
      color: 'success',
      featured: false,
    },
    {
      id: 'manager',
      title: 'Manager',
      description: 'Manage cleaners and oversee operations',
      icon: Users,
      color: 'secondary',
      featured: false,
    },
    {
      id: 'admin',
      title: 'Admin',
      description: 'Full system access and administration',
      icon: Shield,
      color: 'secondary',
      featured: false,
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-5xl">
        {/* Header */}
        <div className="text-center mb-12">
          <Link href="/" className="inline-flex items-center text-gray-600 hover:text-primary-600 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Join Nexxus Cleaning
          </h1>
          <p className="text-xl text-gray-600">
            Choose your account type to get started
          </p>
        </div>

        {/* Role Cards Grid */}
        <div className="grid md:grid-cols-2 gap-6 px-4">
          {roles.map((role) => {
            const Icon = role.icon;
            const borderColor = role.featured
              ? 'border-primary-400 shadow-lg'
              : 'border-gray-200';
            const iconBgColor = role.color === 'primary'
              ? 'bg-primary-100'
              : role.color === 'success'
              ? 'bg-success-100'
              : 'bg-gray-100';
            const iconColor = role.color === 'primary'
              ? 'text-primary-600'
              : role.color === 'success'
              ? 'text-success-600'
              : 'text-gray-600';

            return (
              <Link
                key={role.id}
                href={`/signup/${role.id}`}
                className={`relative bg-white rounded-xl border-2 ${borderColor} p-8 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 group`}
              >
                {role.featured && (
                  <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                    <span className="bg-primary-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="flex flex-col items-center text-center">
                  <div className={`w-16 h-16 ${iconBgColor} rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                    <Icon className={`w-8 h-8 ${iconColor}`} />
                  </div>

                  <h3 className="text-2xl font-bold text-gray-900 mb-3">
                    {role.title}
                  </h3>

                  <p className="text-gray-600 mb-6">
                    {role.description}
                  </p>

                  <div className="mt-auto">
                    <span className={`inline-flex items-center ${
                      role.featured ? 'text-primary-600' : 'text-gray-900'
                    } font-semibold group-hover:gap-2 transition-all`}>
                      Get Started
                      <svg className="w-5 h-5 ml-2 group-hover:ml-3 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {/* Login Link */}
        <div className="mt-12 text-center">
          <p className="text-gray-600">
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-primary-600 hover:text-primary-700 transition-colors">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
