'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../hooks/useAuth';
import { Eye, EyeOff, Loader } from 'lucide-react';
import Link from 'next/link';

function SignupContent() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  
  const { signUp, user, loading } = useAuth();
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

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long');
      setIsLoading(false);
      return;
    }

    try {
      const result = await signUp(email, password, {
        firstName,
        lastName,
        role
      });

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        // Redirect to login after successful signup
        setTimeout(() => {
          router.push(`/login?role=${role}`);
        }, 2000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
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

  const getTestUserData = (role: string) => {
    switch (role) {
      case 'admin':
        return {
          email: 'admin@nexxus.com',
          firstName: 'Admin',
          lastName: 'User',
          password: 'Admin123!'
        };
      case 'manager':
        return {
          email: 'manager@nexxus.com',
          firstName: 'Operations',
          lastName: 'Manager',
          password: 'Manager123!'
        };
      case 'cleaner':
        return {
          email: 'cleaner@nexxus.com',
          firstName: 'Jane',
          lastName: 'Smith',
          password: 'Cleaner123!'
        };
      case 'homeowner':
        return {
          email: 'homeowner@nexxus.com',
          firstName: 'John',
          lastName: 'Doe',
          password: 'Homeowner123!'
        };
      default:
        return {
          email: '',
          firstName: '',
          lastName: '',
          password: ''
        };
    }
  };

  const fillTestUserData = () => {
    const testData = getTestUserData(role);
    setEmail(testData.email);
    setFirstName(testData.firstName);
    setLastName(testData.lastName);
    setPassword(testData.password);
    setConfirmPassword(testData.password);
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
            <div className="text-center">
              <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
                Account Created Successfully!
              </h2>
              <p className="mt-2 text-center text-sm text-gray-600">
                Your {role} account has been created. You will be redirected to the login page shortly.
              </p>
              <div className="mt-6">
                <Link
                  href={`/login?role=${role}`}
                  className="btn-primary w-full"
                >
                  Go to Login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-primary-600">Nexxus</h1>
          <p className="text-sm text-gray-600 mt-1">Cleaning Solutions</p>
        </div>
        <h2 className="mt-6 text-center text-3xl font-bold text-gray-900">
          Create {getRoleDisplayName(role)} Account
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          Sign up for a new {role} account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {/* Test User Data Banner */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 mb-2">Create Test {getRoleDisplayName(role)}</h3>
            <p className="text-xs text-blue-600 mb-3">
              Click below to fill in test data for a {role} account:
            </p>
            <button
              type="button"
              onClick={fillTestUserData}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 transition-colors"
            >
              Fill Test Data
            </button>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                {error}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700">
                  First Name
                </label>
                <div className="mt-1">
                  <input
                    id="firstName"
                    name="firstName"
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="input-field"
                    placeholder="First name"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700">
                  Last Name
                </label>
                <div className="mt-1">
                  <input
                    id="lastName"
                    name="lastName"
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="input-field"
                    placeholder="Last name"
                  />
                </div>
              </div>
            </div>

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
                  autoComplete="new-password"
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

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
                Confirm Password
              </label>
              <div className="mt-1 relative">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirmPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="input-field pr-10"
                  placeholder="Confirm your password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 pr-3 flex items-center"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400" />
                  )}
                </button>
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
                    <span>Creating account...</span>
                  </>
                ) : (
                  <span>Create Account</span>
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
                <span className="px-2 bg-white text-gray-500">Or create account as</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Link
                href="/signup?role=homeowner"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'homeowner' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Homeowner
              </Link>
              <Link
                href="/signup?role=cleaner"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'cleaner' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Cleaner
              </Link>
              <Link
                href="/signup?role=manager"
                className={`inline-flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors ${
                  role === 'manager' ? 'bg-primary-50 border-primary-300 text-primary-700' : ''
                }`}
              >
                Manager
              </Link>
              <Link
                href="/signup?role=admin"
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
              Already have an account?{' '}
              <Link href={`/login?role=${role}`} className="font-medium text-primary-600 hover:text-primary-500">
                Sign in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <Loader className="w-8 h-8 animate-spin mx-auto mb-4 text-primary-600" />
        <p className="text-gray-600">Loading...</p>
      </div>
    </div>}>
      <SignupContent />
    </Suspense>
  );
}
