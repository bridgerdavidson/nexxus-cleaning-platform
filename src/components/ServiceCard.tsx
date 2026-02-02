"use client";

import React from "react";
import { Clock, DollarSign, Tag, Edit2, Trash2, ToggleLeft, ToggleRight, ClipboardList } from "lucide-react";
import { ServiceType } from "../hooks/useServices";

interface ServiceCardProps {
  service: ServiceType;
  canManage: boolean;
  onClick?: (service: ServiceType) => void;
  onEdit?: (service: ServiceType) => void;
  onDelete?: (service: ServiceType) => void;
  onToggleActive?: (service: ServiceType) => void;
  onViewChecklists?: (service: ServiceType) => void;
}

export default function ServiceCard({
  service,
  canManage,
  onClick,
  onEdit,
  onDelete,
  onToggleActive,
  onViewChecklists,
}: ServiceCardProps) {
  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes === 0) {
      return `${hours} hr${hours > 1 ? "s" : ""}`;
    }
    return `${hours} hr${hours > 1 ? "s" : ""} ${remainingMinutes} min`;
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

  return (
    <div
      onClick={() => onClick?.(service)}
      className={`bg-white rounded-xl border shadow-sm transition-all duration-200 ${
        service.is_active
          ? "border-gray-200 hover:shadow-md hover:border-gray-300"
          : "border-gray-200 opacity-60 grayscale"
      } ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <h3
              className={`text-lg font-semibold truncate ${
                service.is_active ? "text-gray-900" : "text-gray-500"
              }`}
            >
              {service.name}
            </h3>
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium mt-1 ${
                service.is_active
                  ? "bg-primary-100 text-primary-700"
                  : "bg-gray-100 text-gray-500"
              }`}
            >
              <Tag className="w-3 h-3 mr-1" />
              {formatServiceType(service.service_type)}
            </span>
          </div>

          {/* Manage buttons - only show for managers/admins with permissions */}
          {canManage && (
            <div className="flex items-center gap-1 ml-4">
              {/* Toggle Active */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleActive?.(service);
                }}
                className={`p-2 rounded-lg transition-colors ${
                  service.is_active
                    ? "text-green-600 hover:bg-green-50"
                    : "text-gray-400 hover:bg-gray-100"
                }`}
                title={service.is_active ? "Disable service" : "Enable service"}
              >
                {service.is_active ? (
                  <ToggleRight className="w-5 h-5" />
                ) : (
                  <ToggleLeft className="w-5 h-5" />
                )}
              </button>

              {/* Edit */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit?.(service);
                }}
                className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
                title="Edit service"
              >
                <Edit2 className="w-4 h-4" />
              </button>

              {/* Delete */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete?.(service);
                }}
                className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                title="Delete service"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Description */}
        {service.description && (
          <p
            className={`text-sm mb-4 line-clamp-2 ${
              service.is_active ? "text-gray-600" : "text-gray-400"
            }`}
          >
            {service.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-100">
          <div className="flex items-center gap-4">
            {/* Price */}
            <div className="flex items-center gap-1.5">
              <DollarSign
                className={`w-4 h-4 ${
                  service.is_active ? "text-green-600" : "text-gray-400"
                }`}
              />
              <span
                className={`font-semibold ${
                  service.is_active ? "text-gray-900" : "text-gray-500"
                }`}
              >
                {formatPrice(service.base_price)}
              </span>
            </div>

            {/* Duration */}
            <div className="flex items-center gap-1.5">
              <Clock
                className={`w-4 h-4 ${
                  service.is_active ? "text-blue-600" : "text-gray-400"
                }`}
              />
              <span
                className={`text-sm ${
                  service.is_active ? "text-gray-600" : "text-gray-400"
                }`}
              >
                {formatDuration(service.duration_minutes)}
              </span>
            </div>
          </div>

          {/* Checklists Button - Bottom Right */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewChecklists?.(service);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              service.is_active
                ? "text-primary-600 hover:bg-primary-50"
                : "text-gray-400 hover:bg-gray-100"
            }`}
            title="View checklists"
          >
            <ClipboardList className="w-4 h-4" />
            <span>Checklists</span>
          </button>
        </div>
      </div>
    </div>
  );
}
