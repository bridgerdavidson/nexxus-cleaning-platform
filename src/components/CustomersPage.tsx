"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  Loader2,
  Users,
  Plus,
  CheckSquare,
  Square,
  Trash2,
  Mail,
  Phone,
  Home,
  Calendar,
  DollarSign,
  ChevronRight,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import {
  AdminCustomer,
  deleteCustomer,
  deleteCustomers,
} from "../hooks/useAdminData";
import { useAuth } from "../hooks/useAuth";
import AddCustomerModal from "./AddCustomerModal";
import CustomerDetailModal from "./CustomerDetailModal";
import DeleteConfirmModal from "./DeleteConfirmModal";

interface CustomersPageProps {
  customers: AdminCustomer[];
  loading: boolean;
  error?: string | null;
  onRefreshCustomers?: () => void;
  onCustomerUpdated?: (
    customerId: string,
    updatedData: Partial<AdminCustomer>,
  ) => void;
  onRefreshAppointments?: () => void;
  onRefreshProperties?: () => void;
  role: "admin" | "manager";
  canEdit?: boolean;
}

export default function CustomersPage({
  customers,
  loading,
  error,
  onRefreshCustomers,
  onCustomerUpdated,
  onRefreshAppointments,
  onRefreshProperties,
  role,
  canEdit = true,
}: CustomersPageProps) {
  const { currentOrganizationId } = useAuth();

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "recent" | "spent">("recent");

  // Modal state
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<AdminCustomer | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Selection state
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Delete modal state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    customerId: string | null;
    customerName: string;
  }>({
    isOpen: false,
    customerId: null,
    customerName: "",
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  // Filter and sort customers
  const filteredCustomers = useMemo(() => {
    let result = [...customers];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter((customer) => {
        const fullName = `${customer.first_name || ""} ${
          customer.last_name || ""
        }`.toLowerCase();
        const email = (customer.email || "").toLowerCase();
        const phone = (customer.phone || "").toLowerCase();
        return (
          fullName.includes(query) ||
          email.includes(query) ||
          phone.includes(query)
        );
      });
    }

    // Sort
    switch (sortBy) {
      case "name":
        result.sort((a, b) => {
          const nameA = `${a.first_name || ""} ${
            a.last_name || ""
          }`.toLowerCase();
          const nameB = `${b.first_name || ""} ${
            b.last_name || ""
          }`.toLowerCase();
          return nameA.localeCompare(nameB);
        });
        break;
      case "spent":
        result.sort((a, b) => b.total_spent - a.total_spent);
        break;
      case "recent":
      default:
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        break;
    }

    return result;
  }, [customers, searchQuery, sortBy]);

  // Selection handlers
  const toggleSelectMode = () => {
    setIsSelectMode(!isSelectMode);
    setSelectedIds(new Set());
  };

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredCustomers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCustomers.map((c) => c.id)));
    }
  };

  const isAllSelected =
    filteredCustomers.length > 0 &&
    selectedIds.size === filteredCustomers.length;
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  // Delete handlers
  const handleDeleteClick = (customer: AdminCustomer, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirmModal({
      isOpen: true,
      customerId: customer.id,
      customerName: `${customer.first_name} ${customer.last_name}`,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirmModal.customerId || !currentOrganizationId) return;

    setIsDeleting(true);
    const result = await deleteCustomer(
      deleteConfirmModal.customerId,
      currentOrganizationId,
    );
    setIsDeleting(false);

    if (result.success) {
      setDeleteConfirmModal({
        isOpen: false,
        customerId: null,
        customerName: "",
      });
      if (onRefreshCustomers) onRefreshCustomers();
    } else {
      alert("Failed to delete customer: " + result.error);
    }
  };

  const handleBulkDelete = async () => {
    if (!currentOrganizationId || selectedIds.size === 0) return;

    setIsBulkDeleting(true);
    const result = await deleteCustomers(
      Array.from(selectedIds),
      currentOrganizationId,
    );
    setIsBulkDeleting(false);

    if (result.success) {
      setShowBulkDeleteModal(false);
      setSelectedIds(new Set());
      setIsSelectMode(false);
      if (onRefreshCustomers) onRefreshCustomers();
    } else {
      alert("Failed to delete customers: " + result.error);
    }
  };

  // Customer card click handler
  const handleCustomerClick = (customer: AdminCustomer) => {
    if (isSelectMode) {
      toggleSelection(customer.id);
    } else {
      setSelectedCustomer(customer);
      setShowDetailModal(true);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (date: string) => {
    // Handle both date-only strings (YYYY-MM-DD) and full ISO timestamps
    // Extract just the date part (YYYY-MM-DD) from the string
    const dateOnly = date.split("T")[0]; // Get date part before 'T' if it exists
    const [year, month, day] = dateOnly.split("-").map(Number);

    // Validate that we have valid numbers
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return "Invalid Date";
    }

    // Parse date string as local date to avoid timezone issues
    const localDate = new Date(year, month - 1, day); // month is 0-indexed
    return localDate.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold text-gray-900">Customers</h2>
          <p className="text-gray-600 mt-1 hidden md:block">
            Manage your customer profiles and view their information
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddCustomerModal(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>New</span>
          </button>
        )}
      </div>

      {/* Search Input - Own line on mobile */}
      <div className="flex-1 relative md:hidden">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search by name, email, or phone..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
        />
      </div>

      {/* Filters Row - Mobile: Filters and Select Many inline, Desktop: All in one line with search */}
      <div className="flex flex-row gap-3 overflow-x-auto">
        {/* Search Input - Desktop only (in same line as filters) */}
        <div className="hidden md:flex flex-1 min-w-[200px] relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white"
          />
        </div>

        {/* Sort Dropdown */}
        <div className="relative flex-shrink-0 min-w-[140px]">
          <select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "name" | "recent" | "spent")
            }
            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
          >
            <option value="recent">Most Recent</option>
            <option value="name">Name (A-Z)</option>
            <option value="spent">Highest Spent</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        {/* Select Many Button - Only show if can edit */}
        {canEdit && (
          <button
            onClick={toggleSelectMode}
            className={`px-4 py-2.5 rounded-full font-medium transition-colors whitespace-nowrap border border-gray-300 flex-shrink-0 ${
              isSelectMode
                ? "bg-gray-600 text-white hover:bg-gray-700 border-gray-600"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            {isSelectMode ? "Cancel Selection" : "Select Many"}
          </button>
        )}
      </div>

      {/* Bulk Action Bar */}
      {isSelectMode && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Select All Checkbox */}
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                {isAllSelected ? (
                  <CheckSquare className="w-5 h-5 text-primary-600" />
                ) : isSomeSelected ? (
                  <div className="w-5 h-5 border-2 border-primary-600 rounded bg-primary-100 flex items-center justify-center">
                    <div className="w-2.5 h-0.5 bg-primary-600" />
                  </div>
                ) : (
                  <Square className="w-5 h-5 text-gray-400" />
                )}
                <span className="font-medium text-gray-700">
                  {isAllSelected ? "Deselect All" : "Select All"}
                </span>
              </button>

              <span className="text-sm text-gray-600">
                {selectedIds.size} customer{selectedIds.size !== 1 ? "s" : ""}{" "}
                selected
              </span>
            </div>

            {/* Bulk Actions */}
            {selectedIds.size > 0 && (
              <button
                onClick={() => setShowBulkDeleteModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <Trash2 className="w-4 h-4" />
                Delete Selected
              </button>
            )}
          </div>
        </div>
      )}

      {/* Customer Stats Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary-100 rounded-lg">
              <Users className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Customers</p>
              <p className="text-xl font-bold text-gray-900">
                {customers.length}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Revenue</p>
              <p className="text-xl font-bold text-gray-900">
                {formatCurrency(
                  customers.reduce((sum, c) => sum + c.total_spent, 0),
                )}
              </p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total Appointments</p>
              <p className="text-xl font-bold text-gray-900">
                {customers.reduce((sum, c) => sum + c.appointments_count, 0)}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Customers List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading customers...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Error loading customers
          </h3>
          <p className="text-gray-600">{error}</p>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {searchQuery ? "No customers found" : "No customers yet"}
          </h3>
          <p className="text-gray-600">
            {searchQuery
              ? "Try adjusting your search query"
              : "Add your first customer to get started"}
          </p>
          {!searchQuery && (
            <button
              onClick={() => setShowAddCustomerModal(true)}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700 transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Customer
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredCustomers.map((customer) => (
            <div
              key={customer.id}
              onClick={() => handleCustomerClick(customer)}
              className={`bg-white border rounded-xl p-5 cursor-pointer transition-all duration-200 shadow-sm hover:shadow-md ${
                isSelectMode && selectedIds.has(customer.id)
                  ? "border-primary-500 ring-2 ring-primary-200"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {isSelectMode && (
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelection(customer.id);
                      }}
                      className="cursor-pointer"
                    >
                      {selectedIds.has(customer.id) ? (
                        <CheckSquare className="w-5 h-5 text-primary-600" />
                      ) : (
                        <Square className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  )}
                  <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
                    {customer.avatar_url ? (
                      <img
                        src={customer.avatar_url}
                        alt=""
                        className="w-12 h-12 rounded-full object-cover"
                      />
                    ) : (
                      <Users className="w-6 h-6 text-primary-600" />
                    )}
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">
                      {customer.first_name} {customer.last_name}
                    </h3>
                    <p className="text-sm text-gray-500">
                      Since {formatDate(customer.created_at)}
                    </p>
                  </div>
                </div>
                {!isSelectMode && (
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                )}
              </div>

              {/* Contact Info */}
              <div className="space-y-2 mb-4">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span className="truncate">{customer.email}</span>
                </div>
                {customer.phone && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Phone className="w-4 h-4 text-gray-400" />
                    <span>{customer.phone}</span>
                  </div>
                )}
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <Home className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {customer.properties_count} properties
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {customer.appointments_count} appts
                  </span>
                </div>
              </div>

              {/* Total Spent & Actions */}
              <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-green-600">
                    {formatCurrency(customer.total_spent)} spent
                  </span>
                </div>
                {!isSelectMode && canEdit && (
                  <button
                    onClick={(e) => handleDeleteClick(customer, e)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Delete customer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <AddCustomerModal
        isOpen={showAddCustomerModal}
        onClose={() => setShowAddCustomerModal(false)}
        onCustomerCreated={() => {
          // Refresh customers, appointments, and properties when customer is created
          if (onRefreshCustomers) {
            onRefreshCustomers();
          }
          if (onRefreshAppointments) {
            onRefreshAppointments();
          }
          if (onRefreshProperties) {
            onRefreshProperties();
          }
        }}
      />

      <CustomerDetailModal
        isOpen={showDetailModal}
        onClose={() => {
          setShowDetailModal(false);
          setSelectedCustomer(null);
        }}
        customer={selectedCustomer}
        onCustomerUpdated={(updatedCustomer) => {
          // Update selected customer immediately for side panel display
          setSelectedCustomer(updatedCustomer);
          // Update the customer in the parent list without refetch
          if (onCustomerUpdated) {
            onCustomerUpdated(updatedCustomer.id, updatedCustomer);
          } else if (onRefreshCustomers) {
            // Fallback to full refresh if selective update not available
            onRefreshCustomers();
          }
          // Only refresh related data if name changed (appointments/properties show customer name)
          const nameChanged =
            selectedCustomer &&
            (selectedCustomer.first_name !== updatedCustomer.first_name ||
              selectedCustomer.last_name !== updatedCustomer.last_name);
          if (nameChanged) {
            if (onRefreshAppointments) {
              onRefreshAppointments();
            }
            if (onRefreshProperties) {
              onRefreshProperties();
            }
          }
        }}
        onRefreshAppointments={onRefreshAppointments}
        onRefreshProperties={onRefreshProperties}
      />

      <DeleteConfirmModal
        isOpen={deleteConfirmModal.isOpen}
        onClose={() =>
          setDeleteConfirmModal({
            isOpen: false,
            customerId: null,
            customerName: "",
          })
        }
        onConfirm={handleDeleteConfirm}
        title="Delete Customer"
        message="Are you sure you want to remove this customer from your organization? This will remove their access but preserve their data."
        itemName={deleteConfirmModal.customerName}
        isLoading={isDeleting}
      />

      {/* Bulk Delete Modal - Using a modified approach since BulkActionConfirmModal is for appointments */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-gray-900">
                    Delete {selectedIds.size} Customer
                    {selectedIds.size !== 1 ? "s" : ""}
                  </h2>
                  <p className="text-sm text-gray-600">
                    This action cannot be undone
                  </p>
                </div>
              </div>
            </div>

            <div className="p-6">
              <p className="text-gray-700 mb-6">
                Are you sure you want to remove {selectedIds.size} selected
                customer
                {selectedIds.size !== 1 ? "s" : ""} from your organization? This
                will remove their access but preserve their data.
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowBulkDeleteModal(false)}
                  disabled={isBulkDeleting}
                  className="flex-1 px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Keep Customers
                </button>

                <button
                  onClick={handleBulkDelete}
                  disabled={isBulkDeleting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isBulkDeleting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Trash2 className="w-5 h-5" />
                  )}
                  Delete {selectedIds.size} Customer
                  {selectedIds.size !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
