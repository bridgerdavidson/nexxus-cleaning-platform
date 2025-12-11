import React from "react";
import { Home, MapPin, User, Mail, Bed, Bath, Square, CheckSquare, Square as SquareIcon, Trash2 } from "lucide-react";

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
}

export default function PropertyCard({
  property,
  onClick,
  isSelectMode = false,
  isSelected = false,
  onToggleSelect,
  onDelete,
}: PropertyCardProps) {
  const getHomeownerName = () => {
    if (property.homeowner) {
      const { first_name, last_name } = property.homeowner;
      return `${first_name} ${last_name}`;
    }
    return "Unknown";
  };

  const getFullAddress = () => {
    return `${property.address}, ${property.city}, ${property.state} ${property.zip_code}`;
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectMode && onToggleSelect) {
      onToggleSelect();
    } else if (!isSelectMode) {
      onClick();
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onToggleSelect) {
      onToggleSelect();
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
      className={`bg-white border rounded-lg hover:shadow-lg transition-all duration-200 cursor-pointer group ${
        isSelected
          ? "border-primary-500 bg-primary-50"
          : "border-gray-200 hover:border-primary-300"
      }`}
    >
      <div className="flex items-center gap-3 p-3 sm:p-4 lg:p-3">
        {/* Checkbox (when in select mode) - Always on left */}
        {isSelectMode && (
          <div className="flex-shrink-0">
            <button
              onClick={handleCheckboxClick}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
            >
              {isSelected ? (
                <CheckSquare className="w-5 h-5 text-primary-600" />
              ) : (
                <SquareIcon className="w-5 h-5 text-gray-400" />
              )}
            </button>
          </div>
        )}

        {/* Desktop Layout (lg+): Horizontal compact */}
        <div className="hidden lg:grid lg:grid-cols-12 lg:gap-3 lg:items-center flex-1">
          {/* Property Name & Address */}
          <div className="col-span-4 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Home className="w-4 h-4 text-primary-600 flex-shrink-0" />
              <p className="text-sm text-gray-900 truncate font-medium">{property.name}</p>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <p className="text-xs text-gray-600 truncate">{getFullAddress()}</p>
            </div>
          </div>

          {/* Homeowner */}
          <div className="col-span-3 flex items-center gap-1.5 min-w-0">
            <User className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <div className="min-w-0">
              <p className="font-medium text-sm text-gray-900 truncate">{getHomeownerName()}</p>
              {property.homeowner?.email && (
                <p className="text-xs text-gray-600 truncate flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {property.homeowner.email}
                </p>
              )}
            </div>
          </div>

          {/* Property Details */}
          <div className="col-span-3 flex items-center gap-3">
            {property.bedrooms !== null && (
              <div className="flex items-center gap-1">
                <Bed className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-600">{property.bedrooms}</span>
              </div>
            )}
            {property.bathrooms !== null && (
              <div className="flex items-center gap-1">
                <Bath className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-600">{property.bathrooms}</span>
              </div>
            )}
            {property.square_feet !== null && (
              <div className="flex items-center gap-1">
                <Square className="w-4 h-4 text-gray-400" />
                <span className="text-xs text-gray-600">{property.square_feet} sqft</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="col-span-2 flex items-center justify-end gap-2">
            {!isSelectMode && onDelete && (
              <button
                onClick={handleDeleteClick}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete property"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tablet & Mobile Layout: Vertical cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:hidden flex-1">
          <div className="sm:col-span-2 space-y-2">
            {/* Property Name */}
            <div className="flex items-start gap-2">
              <Home className="w-5 h-5 text-primary-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-gray-900">{property.name}</p>
                <div className="flex items-start gap-2 mt-1">
                  <MapPin className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-gray-600">{getFullAddress()}</p>
                </div>
              </div>
            </div>

            {/* Homeowner */}
            <div className="flex items-start gap-2">
              <User className="w-5 h-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                  Homeowner
                </p>
                <p className="font-medium text-gray-900">{getHomeownerName()}</p>
                {property.homeowner?.email && (
                  <p className="text-sm text-gray-600 flex items-center gap-1 mt-1">
                    <Mail className="w-4 h-4" />
                    {property.homeowner.email}
                  </p>
                )}
              </div>
            </div>

            {/* Property Details */}
            {(property.bedrooms !== null || property.bathrooms !== null || property.square_feet !== null) && (
              <div className="flex items-center gap-4 pt-2">
                {property.bedrooms !== null && (
                  <div className="flex items-center gap-1.5">
                    <Bed className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{property.bedrooms} bed</span>
                  </div>
                )}
                {property.bathrooms !== null && (
                  <div className="flex items-center gap-1.5">
                    <Bath className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{property.bathrooms} bath</span>
                  </div>
                )}
                {property.square_feet !== null && (
                  <div className="flex items-center gap-1.5">
                    <Square className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-600">{property.square_feet} sqft</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="sm:col-span-2 flex items-center justify-end">
            {!isSelectMode && onDelete && (
              <button
                onClick={handleDeleteClick}
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="Delete property"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

