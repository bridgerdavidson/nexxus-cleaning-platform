'use client';

import React, { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { 
  Calendar, 
  MapPin, 
  MessageCircle, 
  DollarSign, 
  Camera, 
  Clock,
  CheckCircle,
  Star,
  Upload,
  Loader2
} from 'lucide-react';
import {
  useCleanerAppointments,
  useCleanerStats,
  useCleanerMessages,
  useCleanerPayouts,
  useCleanerPhotos,
  updateAppointmentStatus,
  uploadJobPhoto
} from '../../hooks/useCleanerData';

export default function CleanerDashboard() {
  const { user, enterBypassMode } = useAuth();
  const [activeTab, setActiveTab] = useState('schedule');

  // Real data hooks - must be called at top level
  const { appointments, loading: appointmentsLoading, error: appointmentsError } = useCleanerAppointments();
  const { stats, loading: statsLoading, error: statsError } = useCleanerStats();
  const { messages, loading: messagesLoading, error: messagesError } = useCleanerMessages();
  const { payouts, loading: payoutsLoading, error: payoutsError } = useCleanerPayouts();
  const { photos, loading: photosLoading, error: photosError } = useCleanerPhotos();

  // If no user, show Enter button
  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <div className="mb-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="w-8 h-8 text-primary-600" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Cleaner Portal</h2>
            <p className="text-gray-600">
              Access your cleaning dashboard to manage jobs, schedule, and earnings.
            </p>
          </div>
          <button
            onClick={() => enterBypassMode('cleaner')}
            className="w-full btn-primary text-lg py-3"
          >
            Enter Portal
          </button>
        </div>
      </div>
    );
  }

  // Helper functions
  const formatDateTime = (date: string, time: string) => {
    const formattedDate = new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    return `${formattedDate} at ${time}`;
  };

  const getHomeownerName = (appointment: any) => {
    if (appointment.homeowner) {
      const { first_name, last_name } = appointment.homeowner;
      return `${first_name || ''} ${last_name || ''}`.trim() || 'Unknown Homeowner';
    }
    return 'Unknown Homeowner';
  };

  const getPropertyAddress = (appointment: any) => {
    if (appointment.property) {
      const { address, city, state, zip_code } = appointment.property;
      if (address && city && state) {
        return `${address}, ${city}, ${state}${zip_code ? ' ' + zip_code : ''}`;
      }
    }
    return 'Address not available';
  };

  const getTodaysJobs = () => {
    // Get today's date in local timezone (NOT UTC)
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    
    return appointments.filter(appointment => 
      appointment.scheduled_date === today && 
      ['pending', 'confirmed', 'in_progress'].includes(appointment.status)
    );
  };

  const getUpcomingJobs = () => {
    // Get today's date in local timezone
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const today = `${year}-${month}-${day}`;
    
    // Return only future jobs (exclude today's jobs)
    return appointments.filter(appointment => 
      appointment.scheduled_date !== today &&
      ['pending', 'confirmed', 'in_progress'].includes(appointment.status)
    );
  };

  const formatTime = (time: string) => {
    // Convert military time (HH:mm:ss) to standard time (h:mm AM/PM)
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const standardHour = hour % 12 || 12;
    return `${standardHour}:${minutes} ${ampm}`;
  };

  const formatDate = (dateString: string) => {
    // Parse date as local date (not UTC) to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    const date = new Date(year, month - 1, day); // month is 0-indexed
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const handleStartJob = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, 'in_progress');
    if (result.success) {
      window.location.reload(); // Simple refresh for now
    } else {
      alert('Failed to start job: ' + result.error);
    }
  };

  const handleCompleteJob = async (appointmentId: string) => {
    const result = await updateAppointmentStatus(appointmentId, 'completed');
    if (result.success) {
      window.location.reload(); // Simple refresh for now
    } else {
      alert('Failed to complete job: ' + result.error);
    }
  };

  const tabs = [
    { id: 'schedule', label: 'My Schedule', icon: Calendar },
    { id: 'jobs', label: 'Job Details', icon: MapPin },
    { id: 'messages', label: 'Messages', icon: MessageCircle },
    { id: 'earnings', label: 'Earnings', icon: DollarSign },
    { id: 'photos', label: 'Photos', icon: Camera }
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'upcoming':
        return 'text-blue-600 bg-blue-100';
      case 'in_progress':
        return 'text-yellow-600 bg-yellow-100';
      case 'completed':
        return 'text-green-600 bg-green-100';
      case 'cancelled':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const renderSchedule = () => (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-lg p-6 text-white">
        <h2 className="text-2xl font-bold mb-2">
          Good morning, Cleaner!
        </h2>
        <p className="text-primary-100">
          You have {getTodaysJobs().length} jobs scheduled for today.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-primary-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-primary-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Total Jobs</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">{stats.totalJobs}</p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <Clock className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">This Week</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">{stats.upcomingJobs}</p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Confirmed Today</p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  ${getTodaysJobs()
                    .filter(a => a.status === 'confirmed')
                    .reduce((sum, a) => sum + Number(a.total_price), 0)
                    .toFixed(0)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-yellow-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Pending Today</p>
              {appointmentsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">
                  ${getTodaysJobs()
                    .filter(a => a.status === 'pending')
                    .reduce((sum, a) => sum + Number(a.total_price), 0)
                    .toFixed(0)}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Star className="w-6 h-6 text-purple-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Rating</p>
              {statsLoading ? (
                <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
              ) : (
                <p className="text-2xl font-bold text-gray-900">{stats.rating}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Today's Schedule */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Today's Schedule</h3>
        {appointmentsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading schedule...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {getTodaysJobs().map((appointment) => (
              <div key={appointment.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 relative" style={{
                borderLeftColor: appointment.status === 'confirmed' ? '#10b981' : 
                                 appointment.status === 'in_progress' ? '#f59e0b' : 
                                 appointment.status === 'pending' ? '#3b82f6' : '#6b7280'
              }}>
                <div className="flex items-center space-x-4 flex-1">
                  <div className="flex-shrink-0">
                    <Clock className="w-8 h-8 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-lg">{formatTime(appointment.scheduled_time)}</p>
                      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                        appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        appointment.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        appointment.status === 'pending' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full mr-1" style={{
                          backgroundColor: appointment.status === 'confirmed' ? '#10b981' : 
                                         appointment.status === 'in_progress' ? '#f59e0b' : 
                                         appointment.status === 'pending' ? '#3b82f6' : '#6b7280'
                        }}></span>
                        {appointment.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">
                      {appointment.homeowner ? 
                        `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}` : 
                        'Unknown Homeowner'}
                    </p>
                    <p className="text-sm text-gray-600">
                      {appointment.property ? 
                        `${appointment.property.address}, ${appointment.property.city}, ${appointment.property.state}` : 
                        'Address not available'}
                    </p>
                    {appointment.service_type && (
                      <p className="text-sm text-gray-600">{appointment.service_type.name}</p>
                    )}
                  </div>
                </div>
                <div className="text-right ml-4">
                  <p className="text-lg font-bold text-gray-900">${Number(appointment.total_price).toFixed(0)}</p>
                  <button 
                    onClick={() => setActiveTab('jobs')}
                    className="btn-primary text-sm mt-2"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
            {getTodaysJobs().length === 0 && (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No jobs scheduled for today</p>
                <p className="text-sm text-gray-500 mt-2">Check "Upcoming Jobs" below</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Upcoming Jobs */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Upcoming Jobs</h3>
        {appointmentsLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading jobs...</span>
          </div>
        ) : (
          <div className="space-y-4">
            {getUpcomingJobs().map((appointment) => (
              <div key={appointment.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border-l-4 relative" style={{
                borderLeftColor: appointment.status === 'confirmed' ? '#10b981' : 
                                 appointment.status === 'in_progress' ? '#f59e0b' : 
                                 appointment.status === 'pending' ? '#3b82f6' : '#6b7280'
              }}>
                <div className="flex items-center space-x-4 flex-1">
                  <div className="flex-shrink-0">
                    <Calendar className="w-8 h-8 text-primary-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-gray-900 text-lg">
                        {formatDate(appointment.scheduled_date)} at {formatTime(appointment.scheduled_time)}
                      </p>
                      <span className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${
                        appointment.status === 'confirmed' ? 'bg-green-100 text-green-800' :
                        appointment.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        appointment.status === 'pending' ? 'bg-blue-100 text-blue-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        <span className="w-1.5 h-1.5 rounded-full mr-1" style={{
                          backgroundColor: appointment.status === 'confirmed' ? '#10b981' : 
                                         appointment.status === 'in_progress' ? '#f59e0b' : 
                                         appointment.status === 'pending' ? '#3b82f6' : '#6b7280'
                        }}></span>
                        {appointment.status}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-800 mt-1">
                      {appointment.homeowner ? 
                        `${appointment.homeowner.first_name} ${appointment.homeowner.last_name}` : 
                        'Unknown Homeowner'}
                    </p>
                    <p className="text-sm text-gray-600">
                      {appointment.property ? 
                        `${appointment.property.address}, ${appointment.property.city}, ${appointment.property.state}` : 
                        'Address not available'}
                    </p>
                    {appointment.service_type && (
                      <p className="text-sm text-gray-600">{appointment.service_type.name}</p>
                    )}
                  </div>
                </div>
                <div className="text-right ml-4">
                  <p className="text-lg font-bold text-gray-900">${Number(appointment.total_price).toFixed(0)}</p>
                  <button 
                    onClick={() => setActiveTab('jobs')}
                    className="btn-primary text-sm mt-2"
                  >
                    View Details
                  </button>
                </div>
              </div>
            ))}
            {getUpcomingJobs().length === 0 && (
              <div className="text-center py-8">
                <Calendar className="w-12 h-12 text-gray-400 mx-auto mb-2" />
                <p className="text-gray-600">No upcoming jobs</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const renderJobs = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">Job Details</h2>
      </div>

      {appointmentsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading jobs...</span>
        </div>
      ) : (
        <div className="grid gap-6">
          {getUpcomingJobs().map((appointment) => (
            <div key={appointment.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <MapPin className="w-6 h-6 text-primary-600" />
                  <div>
                    <h3 className="font-semibold text-gray-900">
                      {formatDateTime(appointment.scheduled_date, appointment.scheduled_time)}
                    </h3>
                    <p className="text-sm text-gray-600">{getHomeownerName(appointment)}</p>
                    <p className="text-sm text-gray-600">{getPropertyAddress(appointment)}</p>
                    {appointment.service_type && (
                      <p className="text-sm text-gray-600">{appointment.service_type.name}</p>
                    )}
                  </div>
                </div>
                <span className={`inline-flex px-3 py-1 text-sm font-semibold rounded-full ${getStatusColor(appointment.status)}`}>
                  {appointment.status}
                </span>
              </div>
              
              {appointment.special_requests && (
                <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-sm text-yellow-800">
                    <strong>Special Requests:</strong> {appointment.special_requests}
                  </p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-gray-900">
                  ${appointment.total_price}
                </div>
                <div className="flex space-x-2">
                  {appointment.status === 'confirmed' && (
                    <button 
                      onClick={() => handleStartJob(appointment.id)}
                      className="btn-primary text-sm"
                    >
                      Start Job
                    </button>
                  )}
                  {appointment.status === 'in_progress' && (
                    <button 
                      onClick={() => handleCompleteJob(appointment.id)}
                      className="btn-primary text-sm"
                    >
                      Complete Job
                    </button>
                  )}
                  {appointment.status === 'completed' && (
                    <button 
                      onClick={() => setActiveTab('photos')}
                      className="btn-secondary text-sm"
                    >
                      View Photos
                    </button>
                  )}
                  <button className="btn-secondary text-sm">
                    Contact Homeowner
                  </button>
                </div>
              </div>
            </div>
          ))}
          {getUpcomingJobs().length === 0 && (
            <div className="text-center py-12">
              <MapPin className="w-12 h-12 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-600">No upcoming jobs</p>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderMessages = () => (
    <div className="card">
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Messages</h2>
      {messagesLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading messages...</span>
        </div>
      ) : messages.length > 0 ? (
        <div className="space-y-4">
          {messages.slice(0, 10).map((message) => (
            <div key={message.id} className="border-b border-gray-200 pb-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <p className="font-medium text-gray-900">
                      {message.sender ? `${message.sender.first_name} ${message.sender.last_name}` : 'Unknown'}
                    </p>
                    <span className="text-sm text-gray-500">
                      ({message.sender?.role || 'Unknown'})
                    </span>
                  </div>
                  {message.subject && (
                    <p className="text-sm font-medium text-gray-800 mt-1">{message.subject}</p>
                  )}
                  <p className="text-sm text-gray-600 mt-1">{message.content}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    {new Date(message.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
                <div className="ml-4">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    message.is_read ? 'text-gray-600 bg-gray-100' : 'text-blue-600 bg-blue-100'
                  }`}>
                    {message.is_read ? 'Read' : 'Unread'}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <MessageCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No messages yet</h3>
          <p className="text-gray-600">
            Messages with homeowners and admin will appear here.
          </p>
        </div>
      )}
    </div>
  );

  const renderEarnings = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Earnings & Payouts</h2>
      
      {/* Earnings Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Total Earnings</h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-green-600">${stats.totalEarnings}</p>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Pending Payout</h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-yellow-600">${stats.pendingPayouts}</p>
          )}
        </div>
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-2">This Week</h3>
          {statsLoading ? (
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          ) : (
            <p className="text-3xl font-bold text-blue-600">${stats.completedThisWeek * 120}</p>
          )}
        </div>
      </div>

      {/* Payout History */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Payout History</h3>
        {payoutsLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading payouts...</span>
          </div>
        ) : payouts.length > 0 ? (
          <div className="space-y-4">
            {payouts.slice(0, 10).map((payout) => (
              <div key={payout.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900">
                    ${payout.amount} - {payout.appointment?.service_type?.name || 'Service'}
                  </p>
                  <p className="text-sm text-gray-600">
                    {payout.appointment?.homeowner ? 
                      `${payout.appointment.homeowner.first_name} ${payout.appointment.homeowner.last_name}` : 
                      'Unknown Customer'
                    }
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(payout.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                </div>
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${
                  payout.status === 'paid' ? 'text-green-600 bg-green-100' :
                  payout.status === 'pending' ? 'text-yellow-600 bg-yellow-100' :
                  'text-red-600 bg-red-100'
                }`}>
                  {payout.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <DollarSign className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No payouts yet</h3>
            <p className="text-gray-600">
              Your payout history will appear here once you complete jobs.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderPhotos = () => (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Photo Management</h2>
      
      {/* Upload Section */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Upload Before/After Photos</h3>
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h4 className="text-lg font-medium text-gray-900 mb-2">Upload Photos</h4>
          <p className="text-gray-600 mb-4">
            Drag and drop your before/after photos here, or click to browse
          </p>
          <button className="btn-primary">
            Choose Files
          </button>
        </div>
      </div>

      {/* Recent Photos */}
      <div className="card">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Recent Photos</h3>
        {photosLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            <span className="ml-2 text-gray-600">Loading photos...</span>
          </div>
        ) : photos.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.slice(0, 12).map((photo) => (
              <div key={photo.id} className="relative group">
                <img
                  src={photo.photo_url}
                  alt={`${photo.photo_type} photo`}
                  className="w-full h-32 object-cover rounded-lg"
                />
                <div className="absolute inset-0 bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <div className="text-white text-center">
                    <p className="text-sm font-medium">{photo.photo_type}</p>
                    <p className="text-xs">
                      {photo.appointment?.homeowner ? 
                        `${photo.appointment.homeowner.first_name} ${photo.appointment.homeowner.last_name}` : 
                        'Unknown'
                      }
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <Camera className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No photos uploaded</h3>
            <p className="text-gray-600">
              Photos you upload for jobs will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    switch (activeTab) {
      case 'schedule':
        return renderSchedule();
      case 'jobs':
        return renderJobs();
      case 'messages':
        return renderMessages();
      case 'earnings':
        return renderEarnings();
      case 'photos':
        return renderPhotos();
      default:
        return renderSchedule();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="mb-8">
          <div className="border-b border-gray-200">
            <nav className="-mb-px flex space-x-8 overflow-x-auto">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm whitespace-nowrap ${
                      activeTab === tab.id
                        ? 'border-primary-500 text-primary-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Tab Content */}
        {renderContent()}
      </div>
    </div>
  );
}
