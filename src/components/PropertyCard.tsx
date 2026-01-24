import React from "react";
import { Home, MapPin, User, Bed, Bath, Square, CheckSquare, Square as SquareIcon, Trash2, Eye, Edit2 } from "lucide-react";

export interface PropertyCardData {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip_code: string;
  bedrooms: number | null;
  bathrooms: number | null;
  square_feet: number | null;
  homeowner: {
    id: string;
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface PropertyCardProps {
  property: PropertyCardData;
  onClick: () => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  onDelete?: (propertyId: string) => void;
  onEdit?: () => void;
  role?: "admin" | "manager" | "homeowner";
}

export default function PropertyCard({
  property,
  onClick,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onDelete,
  onEdit,
  role = "admin",
}: PropertyCardProps) {
  const getHomeownerName = () => {
    if (property.homeowner) {
      const { first_name, last_name } = property.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectMode && onToggleSelect) {
      onToggleSelect();
    }
    // In non-select mode, clicking the card does nothing - use action buttons instead
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect();
    }
  };

  const handleViewClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onClick();
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit();
    } else {
      onClick(); // Fallback to onClick if no edit handler
    }
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(property.id);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`bg-white border rounded-xl hover:shadow-lg transition-all duration-200 cursor-pointer group relative flex flex-col ${
        isSelected
          ? "border-primary-500 bg-primary-50 ring-2 ring-primary-200"
          : "border-gray-200 hover:border-primary-300"
      }`}
    >
      {/* Checkbox for select mode - Top left corner */}
      {isSelectMode && (
        <div className="absolute top-3 left-3 z-10">
          <button
            onClick={handleCheckboxClick}
            className="p-1.5 bg-white rounded-lg shadow-sm hover:bg-gray-50 transition-colors border border-gray-200"
          >
            {isSelected ? (
              <CheckSquare className="w-5 h-5 text-primary-600" />
            ) : (
              <SquareIcon className="w-5 h-5 text-gray-400" />
            )}
          </button>
        </div>
      )}

      {/* Card Content */}
      <div className="p-5 flex flex-col flex-1">
        {/* Circular Image Area with Property Name Overlay */}
        <div className="relative mb-8">
          {/* Circular placeholder */}
          <div className="w-28 h-28 mx-auto rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center shadow-inner">
            <Home className="w-12 h-12 text-primary-600" />
          </div>
          
          {/* Property name badge overlaying bottom of circle */}
          <div className="absolute -bottom-4 left-1/2 transform -translate-x-1/2">
            <span className="inline-block px-4 py-1.5 bg-primary-600 text-white rounded-full text-sm font-semibold shadow-lg whitespace-nowrap max-w-[180px] truncate">
              {property.name}
            </span>
          </div>
        </div>

        {/* Address Section */}
        <div className="text-center space-y-1 mb-4">
          <div className="flex items-center justify-center gap-1.5">
            <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <p className="text-sm font-medium text-gray-900 truncate">{property.address}</p>
          </div>
          <p className="text-xs text-gray-500">
            {property.city}, {property.state} {property.zip_code}
          </p>
        </div>

        {/* Homeowner - Only show for admin/manager */}
        {role !== "homeowner" && property.homeowner && (
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600 mb-3">
            <User className="w-4 h-4 text-gray-400" />
            <span className="truncate">{getHomeownerName()}</span>
          </div>
        )}

        {/* Property Details */}
        {(property.bedrooms !== null || property.bathrooms !== null || property.square_feet !== null) && (
          <div className="flex items-center justify-center gap-4 text-sm text-gray-500 mb-4">
            {property.bedrooms !== null && (
              <div className="flex items-center gap-1">
                <Bed className="w-4 h-4" />
                <span>{property.bedrooms}</span>
              </div>
            )}
            {property.bathrooms !== null && (
              <div className="flex items-center gap-1">
                <Bath className="w-4 h-4" />
                <span>{property.bathrooms}</span>
              </div>
            )}
            {property.square_feet !== null && (
              <div className="flex items-center gap-1">
                <Square className="w-4 h-4" />
                <span>{property.square_feet.toLocaleString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Spacer to push buttons to bottom */}
        <div className="flex-1" />

        {/* Action Buttons */}
        {!isSelectMode && (
          <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
            <button
              onClick={handleViewClick}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <Eye className="w-4 h-4" />
              <span>View</span>
            </button>
            <button
              onClick={handleEditClick}
              className="flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
            </button>
            {onDelete && (
              <button
                onClick={handleDeleteClick}
                className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
                title="Delete property"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
