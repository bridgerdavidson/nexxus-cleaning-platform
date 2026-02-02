"use client";

import React from "react";
import {
  ArrowLeft,
  Clock,
  DollarSign,
  Tag,
  Edit2,
  Trash2,
  ToggleLeft,
  ToggleRight,
  ChevronRight,
  CheckCircle,
  XCircle,
  Calendar,
  ClipboardList,
} from "lucide-react";
import { ServiceType } from "../hooks/useServices";

interface ServiceDetailViewProps {
  service: ServiceType;
  canManage: boolean;
  onBack: () => void;
  onEdit?: (service: ServiceType) => void;
  onDelete?: (service: ServiceType) => void;
  onToggleActive?: (service: ServiceType) => void;
  onViewChecklists?: (service: ServiceType) => void;
}

export default function ServiceDetailView({
  service,
  canManage,
  onBack,
  onEdit,
  onDelete,
  onToggleActive,
  onViewChecklists,
}: ServiceDetailViewProps) {
  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} minutes`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hour${hours > 1 ? "s" : ""}`;
    }
    return `${hours} hour${hours > 1 ? "s" : ""} ${remainingMinutes} minutes`;
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(2)}`;
  };

  const formatServiceType = (type: string) => {
    // Convert snake_case to Title Case
    return type
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center text-sm">
        <button
          onClick={onBack}
          className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
        >
          Services
        </button>
        <ChevronRight className="w-4 h-4 mx-2 text-gray-400" />
        <span className="text-gray-600 font-medium truncate max-w-[200px] sm:max-w-none">
          {service.name}
        </span>
      </nav>

      {/* Header with Back Button and Title */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-start gap-4">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            title="Back to services"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-3xl font-bold text-gray-900">{service.name}</h2>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 sm:ml-auto">
          {/* Checklists Button - Always visible */}
          <button
            onClick={() => onViewChecklists?.(service)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 transition-colors"
          >
            <ClipboardList className="w-4 h-4" />
            <span className="hidden sm:inline">Checklists</span>
          </button>

          {/* Manage buttons - only show for managers/admins with permissions */}
          {canManage && (
            <>
              <button
                onClick={() => onToggleActive?.(service)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  service.is_active
                    ? "text-orange-700 bg-orange-50 hover:bg-orange-100"
                    : "text-green-700 bg-green-50 hover:bg-green-100"
                }`}
              >
                {service.is_active ? (
                  <>
                    <ToggleLeft className="w-5 h-5" />
                    <span className="hidden sm:inline">Disable</span>
                  </>
                ) : (
                  <>
                    <ToggleRight className="w-5 h-5" />
                    <span className="hidden sm:inline">Enable</span>
                  </>
                )}
              </button>
              <button
                onClick={() => onEdit?.(service)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                <span className="hidden sm:inline">Edit</span>
              </button>
              <button
                onClick={() => onDelete?.(service)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-red-700 bg-red-50 hover:bg-red-100 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline">Delete</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {/* Description Section */}
        {service.description && (
          <div className="p-6 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
              Description
            </h3>
            <p className="text-gray-700 leading-relaxed">{service.description}</p>
          </div>
        )}

        {/* Pricing & Duration */}
        <div className="p-6 border-b border-gray-100">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Base Price */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Base Price</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatPrice(service.base_price)}
                </p>
              </div>
            </div>

            {/* Duration */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Duration</p>
                <p className="text-2xl font-bold text-gray-900">
                  {formatDuration(service.duration_minutes)}
                </p>
              </div>
            </div>

            {/* Created Date */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Calendar className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Created</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatDate(service.created_at)}
                </p>
              </div>
            </div>

            {/* Updated Date */}
            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Calendar className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Last Updated</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatDate(service.updated_at)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Service Details Summary */}
        <div className="p-6">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">
            Service Details
          </h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-600">Service Type</dt>
              <dd>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    service.is_active
                      ? "bg-primary-100 text-primary-700"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  <Tag className="w-4 h-4 mr-1.5" />
                  {formatServiceType(service.service_type)}
                </span>
              </dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-600">Status</dt>
              <dd>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
                    service.is_active
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {service.is_active ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-1.5" />
                      Active
                    </>
                  ) : (
                    <>
                      <XCircle className="w-4 h-4 mr-1.5" />
                      Inactive
                    </>
                  )}
                </span>
              </dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-600">Base Price</dt>
              <dd className="font-medium text-gray-900">{formatPrice(service.base_price)}</dd>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <dt className="text-gray-600">Duration</dt>
              <dd className="font-medium text-gray-900">{formatDuration(service.duration_minutes)}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
