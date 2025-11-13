'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { Eye, EyeOff, Loader } from 'lucide-react';
import Link from 'next/link';

function LoginContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { signIn, user, loading, enterBypassMode } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const role = searchParams.get('role') || 'homeowner';

  useEffect(() => {
    // Redirect if already logged in
    if (user) {
      const dashboardPath = getDashboardPath(user.role);
      router.push(dashboardPath);
    }
  }, [user, router]);

  const getDashboardPath = (userRole: string) => {
    switch (userRole) {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await signIn(email, password);
      if (result.error) {
        setError(result.error);
      }
      // Don't redirect here - let the useEffect handle it when user state updates
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleDisplayName = (role: string) => {
    switch (role) {
      case 'homeowner':
        return 'Homeowner';
      case 'cleaner':
        return 'Cleaner';
      case 'manager':
        return 'Manager';
      case 'admin':
        return 'Admin';
      default:
        return 'User';
    }
  };

  const getTestCredentials = (role: string) => {
    switch (role) {
      case 'admin':
        return {
          email: 'admin@nexxus.com',
          password: 'Admin123!'
        };
      case 'manager':
        return {
          email: 'manager@nexxus.com',
          password: 'Manager123!'
        };
      case 'cleaner':
        return {
          email: 'cleaner@nexxus.com',
          password: 'Cleaner123!'
        };
      case 'homeowner':
        return {
          email: 'homeowner@nexxus.com',
          password: 'Homeowner123!'
        };
      default:
        return {
          email: '',
          password: ''
        };
    }
  };

  const fillTestCredentials = () => {
    const testData = getTestCredentials(role);
    setEmail(testData.email);
    setPassword(testData.password);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary-600">Nexxus</h1>
          <p className="text-sm text-gray-600 mt-1">Cleaning Solutions</p>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          {getRoleDisplayName(role)} Login
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign in to your {role} account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Test Credentials Banner */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Test Account</h3>
            <p className="text-xs text-blue-600 mb-3">
              Use these credentials to test the {role} dashboard:
            </p>
            <div className="text-xs text-blue-700 mb-3">
              <div>Email: {getTestCredentials(role).email}</div>
              <div>Password: {getTestCredentials(role).password}</div>
            </div>
            <button
              type="button"
              onClick={fillTestCredentials}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors"
            >
              Fill Test Credentials
            </button>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <div className="mt-1">
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder="Enter your email"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-10"
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <input
                  id="remember-me"
                  name="remember-me"
                  type="checkbox"
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                  Remember me
                </label>
              </div>

              <div className="text-sm">
                <a href="#" className="font-medium text-primary-600 hover:text-primary-500">
                  Forgot your password?
                </a>
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full flex justify-center items-center space-x-2"
              >
                {isLoading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    <span>Signing in...</span>
                  </>
                ) : (
                  <span>Sign in</span>
                )}
              </button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-gray-500">Or sign in as</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link
                href="/login?role=homeowner"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'homeowner' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Homeowner
              </Link>
              <Link
                href="/login?role=cleaner"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'cleaner' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Cleaner
              </Link>
              <Link
                href="/login?role=manager"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'manager' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Manager
              </Link>
              <Link
                href="/login?role=admin"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'admin' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Admin
              </Link>
            </div>
          </div>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <a href="#" className="font-medium text-primary-600 hover:text-primary-500">
                Sign up here
              </a>
            </p>
          </div>

          {/* Demo Mode Section */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="text-center mb-4">
              <h3 className="text-sm font-medium text-gray-900 mb-1">Demo Mode</h3>
              <p className="text-xs text-gray-600">
                Skip authentication and explore the {getRoleDisplayName(role).toLowerCase()} dashboard
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                const validRole = role as 'homeowner' | 'cleaner' | 'admin' | 'manager';
                enterBypassMode(validRole);
                router.push(getDashboardPath(validRole));
              }}
              className="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white py-2 px-4 rounded-md text-sm font-medium hover:from-purple-700 hover:to-purple-800 transition-all duration-200 shadow-sm"
            >
              🚀 Enter {getRoleDisplayName(role)} Portal
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">
              Perfect for presentations and demos
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>}>
      <LoginContent />
    </Suspense>
  );
}
