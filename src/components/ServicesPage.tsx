"use client";

import React, { useState, useMemo } from "react";
import {
  Search,
  ChevronDown,
  Plus,
  Loader2,
  Briefcase,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  ClipboardList,
  CheckCircle,
  Edit2,
  Trash2,
  X,
  Check,
  GripVertical,
} from "lucide-react";
import { ServiceType, toggleServiceActive } from "../hooks/useServices";
import {
  useChecklists,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  reorderLineItems,
  ChecklistWithItems,
  ChecklistLineItem,
} from "../hooks/useChecklists";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import ServiceCard from "./ServiceCard";
import ServiceFormModal from "./ServiceFormModal";
import DeleteServiceModal from "./DeleteServiceModal";
import ServiceDetailView from "./ServiceDetailView";
import ChecklistFormModal from "./ChecklistFormModal";
import DeleteChecklistModal from "./DeleteChecklistModal";

interface ServicesPageProps {
  services: ServiceType[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  canManageServices: boolean;
  updateServiceInState?: (
    serviceId: string,
    patch: Partial<ServiceType>,
  ) => void;
  maxChecklistAdderByServiceId: Record<string, number>;
  refreshMaxChecklistAdders: () => void;
}

type StatusFilter = "active" | "all" | "disabled";

// Sortable Line Item Component
interface SortableLineItemProps {
  item: ChecklistLineItem;
  editingItemId: string | null;
  editingItemText: string;
  savingItemId: string | null;
  canManageServices: boolean;
  onStartEdit: (item: ChecklistLineItem) => void;
  onCancelEdit: () => void;
  onSaveEdit: (itemId: string) => void;
  onDelete: (itemId: string) => void;
  setEditingItemText: (text: string) => void;
}

function SortableLineItem({
  item,
  editingItemId,
  editingItemText,
  savingItemId,
  canManageServices,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  setEditingItemText,
}: SortableLineItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-3 group py-3 border-b border-gray-100 last:border-0"
    >
      {editingItemId === item.id ? (
        /* Editing Mode */
        <div className="flex-1 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <input
            type="text"
            value={editingItemText}
            onChange={(e) => setEditingItemText(e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onSaveEdit(item.id);
              } else if (e.key === "Escape") {
                onCancelEdit();
              }
            }}
          />
          <button
            onClick={() => onSaveEdit(item.id)}
            disabled={savingItemId === item.id}
            className="p-1.5 rounded-lg text-green-600 hover:bg-green-50 transition-colors disabled:opacity-50"
            title="Save"
          >
            {savingItemId === item.id ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={onCancelEdit}
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* View Mode */
        <>
          {canManageServices && (
            <button
              {...attributes}
              {...listeners}
              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0 mt-0.5"
              title="Drag to reorder"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          )}
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <span className="flex-1 text-gray-700">{item.task}</span>
          {canManageServices && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => onStartEdit(item)}
                disabled={savingItemId === item.id}
                className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50"
                title="Edit item"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onDelete(item.id)}
                disabled={savingItemId === item.id}
                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
                title="Delete item"
              >
                {savingItemId === item.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

// Internal Checklists View Component
interface ChecklistsViewProps {
  service: ServiceType;
  canManageServices: boolean;
  onBackToServices: () => void;
  onBackToServiceDetail?: () => void;
  onChecklistPricingChanged?: () => void;
}

function ChecklistsView({
  service,
  canManageServices,
  onBackToServices,
  onBackToServiceDetail,
  onChecklistPricingChanged,
}: ChecklistsViewProps) {
  const {
    checklists,
    loading,
    error,
    refetch,
    applyLineItemUpdated,
    applyLineItemAdded,
    applyLineItemRemoved,
    applyLineItemsReordered,
    applyChecklistUpdated,
    applyChecklistAdded,
  } = useChecklists(service.id);

  // Modal state for checklists
  const [showChecklistFormModal, setShowChecklistFormModal] = useState(false);
  const [showDeleteChecklistModal, setShowDeleteChecklistModal] =
    useState(false);
  const [selectedChecklist, setSelectedChecklist] =
    useState<ChecklistWithItems | null>(null);

  // Inline editing state for line items
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemText, setEditingItemText] = useState("");
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  // Add new item state (per checklist)
  const [addingToChecklistId, setAddingToChecklistId] = useState<string | null>(
    null,
  );
  const [newItemText, setNewItemText] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  // Error state
  const [itemError, setItemError] = useState<string | null>(null);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Handle drag end for reordering line items
  const handleDragEnd = async (
    event: DragEndEvent,
    checklistId: string,
    items: ChecklistLineItem[],
  ) => {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    // Create the new ordered array
    const reorderedItems = arrayMove(items, oldIndex, newIndex);

    // Update position field for each item based on new order
    const itemsWithNewPositions = reorderedItems.map((item, index) => ({
      ...item,
      position: index,
    }));

    // Apply optimistic update
    applyLineItemsReordered(checklistId, itemsWithNewPositions);

    // Call API to persist the new order
    const orderedIds = reorderedItems.map((item) => item.id);
    const result = await reorderLineItems(checklistId, orderedIds);

    if (!result.success) {
      // Rollback on error
      setItemError(result.error || "Failed to reorder items");
      applyLineItemsReordered(checklistId, items);
    }
  };

  // Handlers for checklist CRUD
  const handleAddChecklist = () => {
    setSelectedChecklist(null);
    setShowChecklistFormModal(true);
  };

  const handleEditChecklist = (checklist: ChecklistWithItems) => {
    setSelectedChecklist(checklist);
    setShowChecklistFormModal(true);
  };

  const handleDeleteChecklist = (checklist: ChecklistWithItems) => {
    setSelectedChecklist(checklist);
    setShowDeleteChecklistModal(true);
  };

  const handleChecklistFormSuccess = (
    result:
      | { type: "created"; checklist: ChecklistWithItems }
      | {
          type: "updated";
          checklistId: string;
          name: string;
          priceAdder: number;
        },
  ) => {
    if (result.type === "created") {
      applyChecklistAdded(result.checklist);
    } else {
      applyChecklistUpdated(result.checklistId, result.name, result.priceAdder);
    }
    onChecklistPricingChanged?.();
  };

  const handleChecklistDeleteSuccess = () => {
    refetch(); // Keep refetch for delete to ensure consistency
    onChecklistPricingChanged?.();
  };

  // Handlers for line item CRUD
  const handleStartEditItem = (item: ChecklistLineItem) => {
    setEditingItemId(item.id);
    setEditingItemText(item.task);
    setItemError(null);
  };

  const handleCancelEditItem = () => {
    setEditingItemId(null);
    setEditingItemText("");
  };

  const handleSaveEditItem = async (itemId: string) => {
    if (!editingItemText.trim()) {
      setItemError("Task cannot be empty");
      return;
    }

    setSavingItemId(itemId);
    setItemError(null);

    const result = await updateLineItem(itemId, editingItemText.trim());
    if (result.success) {
      setEditingItemId(null);
      setEditingItemText("");
      applyLineItemUpdated(itemId, editingItemText.trim());
    } else {
      setItemError(result.error || "Failed to update item");
    }

    setSavingItemId(null);
  };

  const handleDeleteItem = async (itemId: string) => {
    setSavingItemId(itemId);
    setItemError(null);

    const result = await deleteLineItem(itemId);

    if (result.success) {
      applyLineItemRemoved(itemId);
    } else {
      setItemError(result.error || "Failed to delete item");
    }

    setSavingItemId(null);
  };

  const handleStartAddItem = (checklistId: string) => {
    setAddingToChecklistId(checklistId);
    setNewItemText("");
    setItemError(null);
  };

  const handleCancelAddItem = () => {
    setAddingToChecklistId(null);
    setNewItemText("");
  };

  const handleAddItem = async (checklistId: string) => {
    if (!newItemText.trim()) {
      setItemError("Task cannot be empty");
      return;
    }

    setAddingItem(true);
    setItemError(null);

    const result = await createLineItem(checklistId, newItemText.trim());
    if (result.success && result.data) {
      setAddingToChecklistId(null);
      setNewItemText("");
      applyLineItemAdded(checklistId, result.data);
    } else {
      setItemError(result.error || "Failed to add item");
    }

    setAddingItem(false);
  };

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center text-sm flex-wrap gap-1">
        <button
          onClick={onBackToServices}
          className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
        >
          Services
        </button>
        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        {onBackToServiceDetail ? (
          <button
            onClick={onBackToServiceDetail}
            className="text-primary-600 hover:text-primary-700 font-medium transition-colors truncate max-w-[150px] sm:max-w-[200px]"
          >
            {service.name}
          </button>
        ) : (
          <span className="text-gray-600 font-medium truncate max-w-[150px] sm:max-w-[200px]">
            {service.name}
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-gray-600 font-medium">Checklists</span>
      </nav>

      {/* Header with Back Button and Title */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button
            onClick={onBackToServiceDetail || onBackToServices}
            className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
            title="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-4xl font-bold text-gray-900">Checklists</h2>
            <p className="text-gray-600 mt-1">
              for <span className="font-medium">{service.name}</span>
            </p>
          </div>
        </div>

        {/* Add Checklist Button */}
        {canManageServices && (
          <button
            onClick={handleAddChecklist}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>Add Checklist</span>
          </button>
        )}
      </div>

      {/* Item Error Banner */}
      {itemError && (
        <div className="flex items-center justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{itemError}</span>
          </div>
          <button
            onClick={() => setItemError(null)}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading checklists...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load checklists
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : checklists.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <ClipboardList className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No checklists yet
          </h3>
          <p className="text-gray-600 mb-4">
            No checklists have been created for this service.
          </p>
          {canManageServices && (
            <button
              onClick={handleAddChecklist}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Add Checklist
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {checklists.map((checklist) => (
            <div
              key={checklist.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Checklist Header */}
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary-100 rounded-lg">
                      <ClipboardList className="w-5 h-5 text-primary-600" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {checklist.name}
                      </h3>
                      <p className="text-sm text-gray-500">
                        +${(checklist.price_adder ?? 0).toFixed(2)} adder
                      </p>
                    </div>
                  </div>

                  {/* Checklist Actions */}
                  {canManageServices && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditChecklist(checklist)}
                        className="p-2 rounded-lg text-gray-600 hover:bg-gray-200 transition-colors"
                        title="Edit checklist name"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteChecklist(checklist)}
                        className="p-2 rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                        title="Delete checklist"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Checklist Items */}
              <div className="p-6">
                {checklist.checklist_line_items &&
                checklist.checklist_line_items.length > 0 ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(event) =>
                      handleDragEnd(
                        event,
                        checklist.id,
                        checklist.checklist_line_items || [],
                      )
                    }
                  >
                    <SortableContext
                      items={checklist.checklist_line_items.map(
                        (item) => item.id,
                      )}
                      strategy={verticalListSortingStrategy}
                    >
                      <ul className="space-y-0">
                        {checklist.checklist_line_items.map((item) => (
                          <SortableLineItem
                            key={item.id}
                            item={item}
                            editingItemId={editingItemId}
                            editingItemText={editingItemText}
                            savingItemId={savingItemId}
                            canManageServices={canManageServices}
                            onStartEdit={handleStartEditItem}
                            onCancelEdit={handleCancelEditItem}
                            onSaveEdit={handleSaveEditItem}
                            onDelete={handleDeleteItem}
                            setEditingItemText={setEditingItemText}
                          />
                        ))}
                      </ul>
                    </SortableContext>
                  </DndContext>
                ) : (
                  <p className="text-gray-500 text-sm italic mb-4">
                    No items in this checklist.
                  </p>
                )}

                {/* Add New Item */}
                {canManageServices && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    {addingToChecklistId === checklist.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newItemText}
                          onChange={(e) => setNewItemText(e.target.value)}
                          placeholder="Enter new task..."
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleAddItem(checklist.id);
                            } else if (e.key === "Escape") {
                              handleCancelAddItem();
                            }
                          }}
                        />
                        <button
                          onClick={() => handleAddItem(checklist.id)}
                          disabled={addingItem}
                          className="px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {addingItem ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Plus className="w-4 h-4" />
                          )}
                          Add
                        </button>
                        <button
                          onClick={handleCancelAddItem}
                          className="px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartAddItem(checklist.id)}
                        className="flex items-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        Add item
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Checklist Form Modal */}
      <ChecklistFormModal
        isOpen={showChecklistFormModal}
        onClose={() => {
          setShowChecklistFormModal(false);
          setSelectedChecklist(null);
        }}
        onSuccess={handleChecklistFormSuccess}
        checklist={selectedChecklist}
        serviceTypeId={service.id}
      />

      {/* Delete Checklist Modal */}
      <DeleteChecklistModal
        isOpen={showDeleteChecklistModal}
        onClose={() => {
          setShowDeleteChecklistModal(false);
          setSelectedChecklist(null);
        }}
        onSuccess={handleChecklistDeleteSuccess}
        checklist={selectedChecklist}
        itemCount={selectedChecklist?.checklist_line_items?.length || 0}
      />
    </div>
  );
}

export default function ServicesPage({
  services,
  loading,
  error,
  refetch,
  canManageServices,
  updateServiceInState,
  maxChecklistAdderByServiceId,
  refreshMaxChecklistAdders,
}: ServicesPageProps) {
  // Filter and search state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // Modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceType | null>(
    null,
  );

  // Detail view state
  const [viewingService, setViewingService] = useState<ServiceType | null>(
    null,
  );

  // Checklists view state
  const [viewingChecklistsForService, setViewingChecklistsForService] =
    useState<ServiceType | null>(null);

  // Toggle active loading state
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set());

  // Toggle error state
  const [toggleError, setToggleError] = useState<string | null>(null);

  // Filter services
  const filteredServices = useMemo(() => {
    let filtered = [...services];

    // Apply status filter
    if (statusFilter === "active") {
      filtered = filtered.filter((s) => s.is_active);
    } else if (statusFilter === "disabled") {
      filtered = filtered.filter((s) => !s.is_active);
    }

    // Apply search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(
        (s) =>
          s.name.toLowerCase().includes(query) ||
          s.description?.toLowerCase().includes(query) ||
          s.service_type.toLowerCase().includes(query),
      );
    }

    return filtered;
  }, [services, statusFilter, searchQuery]);

  // Handle edit
  const handleEdit = (service: ServiceType) => {
    setSelectedService(service);
    setShowFormModal(true);
  };

  // Handle delete
  const handleDelete = (service: ServiceType) => {
    setSelectedService(service);
    setShowDeleteModal(true);
  };

  // Handle toggle active (optimistic update with rollback)
  const handleToggleActive = async (service: ServiceType) => {
    const newIsActive = !service.is_active;
    const previousIsActive = service.is_active;

    // Clear any previous toggle error
    setToggleError(null);

    // Track that we're toggling this service
    setTogglingIds((prev) => new Set(prev).add(service.id));

    // Optimistic update: immediately update UI
    if (updateServiceInState) {
      updateServiceInState(service.id, { is_active: newIsActive });
    }

    try {
      const result = await toggleServiceActive(
        service.id,
        newIsActive,
        service.organization_id,
      );
      if (!result.success) {
        // Rollback on failure
        if (updateServiceInState) {
          updateServiceInState(service.id, { is_active: previousIsActive });
        }
        setToggleError(result.error || "Failed to update service status");
      }
    } catch {
      // Rollback on unexpected error
      if (updateServiceInState) {
        updateServiceInState(service.id, { is_active: previousIsActive });
      }
      setToggleError("Failed to update service status");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }
  };

  // Handle add new
  const handleAddNew = () => {
    setSelectedService(null);
    setShowFormModal(true);
  };

  // Handle form success
  const handleFormSuccess = () => {
    refetch();
  };

  // Handle delete success
  const handleDeleteSuccess = () => {
    refetch();
    setViewingService(null);
  };

  // Handle view service details
  const handleViewService = (service: ServiceType) => {
    setViewingService(service);
  };

  // Handle back to list
  const handleBackToList = () => {
    setViewingService(null);
  };

  // Handle toggle from detail view (optimistic update with rollback)
  const handleToggleActiveFromDetail = async (service: ServiceType) => {
    const newIsActive = !service.is_active;
    const previousIsActive = service.is_active;

    // Clear any previous toggle error
    setToggleError(null);

    // Track that we're toggling this service
    setTogglingIds((prev) => new Set(prev).add(service.id));

    // Optimistic update: immediately update both the list and detail view
    if (updateServiceInState) {
      updateServiceInState(service.id, { is_active: newIsActive });
    }
    setViewingService((prev) =>
      prev && prev.id === service.id
        ? { ...prev, is_active: newIsActive }
        : prev,
    );

    try {
      const result = await toggleServiceActive(
        service.id,
        newIsActive,
        service.organization_id,
      );
      if (!result.success) {
        // Rollback on failure
        if (updateServiceInState) {
          updateServiceInState(service.id, { is_active: previousIsActive });
        }
        setViewingService((prev) =>
          prev && prev.id === service.id
            ? { ...prev, is_active: previousIsActive }
            : prev,
        );
        setToggleError(result.error || "Failed to update service status");
      }
    } catch {
      // Rollback on unexpected error
      if (updateServiceInState) {
        updateServiceInState(service.id, { is_active: previousIsActive });
      }
      setViewingService((prev) =>
        prev && prev.id === service.id
          ? { ...prev, is_active: previousIsActive }
          : prev,
      );
      setToggleError("Failed to update service status");
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(service.id);
        return next;
      });
    }
  };

  // Handle edit from detail view
  const handleEditFromDetail = (service: ServiceType) => {
    setSelectedService(service);
    setShowFormModal(true);
  };

  // Handle delete from detail view
  const handleDeleteFromDetail = (service: ServiceType) => {
    setSelectedService(service);
    setShowDeleteModal(true);
  };

  // Handle form success - also update viewing service if it was edited
  const handleFormSuccessWithUpdate = () => {
    refetch();
    // We'll update the viewing service after refetch completes
    // For now, just close the modal - the service list will refresh
  };

  // Handle view checklists for a service
  const handleViewChecklists = (service: ServiceType) => {
    // Set both states so breadcrumbs work from either entry point
    setViewingService(service);
    setViewingChecklistsForService(service);
  };

  // Handle back from checklists to service detail
  const handleBackToServiceDetail = () => {
    setViewingChecklistsForService(null);
  };

  // Handle back from checklists to services list
  const handleBackToServicesFromChecklists = () => {
    setViewingChecklistsForService(null);
    setViewingService(null);
  };

  // If viewing checklists for a service, show the checklists view
  if (viewingChecklistsForService) {
    const latestService =
      services.find((s) => s.id === viewingChecklistsForService.id) ||
      viewingChecklistsForService;

    return (
      <ChecklistsView
        service={latestService}
        canManageServices={canManageServices}
        onBackToServices={handleBackToServicesFromChecklists}
        onBackToServiceDetail={
          viewingService ? handleBackToServiceDetail : undefined
        }
        onChecklistPricingChanged={refreshMaxChecklistAdders}
      />
    );
  }

  // If viewing a service, show the detail view
  if (viewingService) {
    // Find the latest version of this service from the services array
    const latestService =
      services.find((s) => s.id === viewingService.id) || viewingService;

    return (
      <>
        <ServiceDetailView
          service={latestService}
          maxChecklistAdder={
            maxChecklistAdderByServiceId[latestService.id] ?? 0
          }
          canManage={canManageServices && !togglingIds.has(latestService.id)}
          onBack={handleBackToList}
          onEdit={handleEditFromDetail}
          onDelete={handleDeleteFromDetail}
          onToggleActive={handleToggleActiveFromDetail}
          onViewChecklists={handleViewChecklists}
        />

        {/* Service Form Modal */}
        <ServiceFormModal
          isOpen={showFormModal}
          onClose={() => {
            setShowFormModal(false);
            setSelectedService(null);
          }}
          onSuccess={handleFormSuccessWithUpdate}
          service={selectedService}
        />

        {/* Delete Service Modal */}
        <DeleteServiceModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setSelectedService(null);
          }}
          onSuccess={handleDeleteSuccess}
          service={selectedService}
        />
      </>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toggle Error Banner */}
      {toggleError && (
        <div className="flex items-center justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm font-medium">{toggleError}</span>
          </div>
          <button
            onClick={() => setToggleError(null)}
            className="text-red-500 hover:text-red-700 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-4xl font-bold text-gray-900">Services</h2>
        {canManageServices && (
          <button
            onClick={handleAddNew}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-primary-600 text-white rounded-full font-medium hover:bg-primary-700 transition-colors whitespace-nowrap shadow-md"
          >
            <Plus className="w-5 h-5" />
            <span>Add Service</span>
          </button>
        )}
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        {/* Search Input */}
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search by name, type, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white shadow-sm"
          />
        </div>

        {/* Filters Row */}
        <div className="flex flex-row gap-3 overflow-x-auto pb-1 md:pb-0 scrollbar-hide shrink-0">
          {/* Status Filter Dropdown */}
          <div className="relative flex-shrink-0 min-w-[140px]">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-full focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors bg-white font-medium text-sm appearance-none"
            >
              <option value="active">Active</option>
              <option value="all">All</option>
              <option value="disabled">Disabled</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-600">Loading services...</span>
        </div>
      ) : error ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Failed to load services
          </h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={refetch}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      ) : filteredServices.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <Briefcase className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            {services.length === 0 ? "No services yet" : "No services found"}
          </h3>
          <p className="text-gray-600 mb-4">
            {services.length === 0
              ? canManageServices
                ? "Add your first service to get started."
                : "No services have been added yet."
              : "Try adjusting your search or filter."}
          </p>
          {canManageServices && services.length === 0 && (
            <button
              onClick={handleAddNew}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              Add Service
            </button>
          )}
        </div>
      ) : (
        /* Card Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredServices.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              maxChecklistAdder={maxChecklistAdderByServiceId[service.id] ?? 0}
              canManage={canManageServices && !togglingIds.has(service.id)}
              onClick={handleViewService}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleActive={handleToggleActive}
              onViewChecklists={handleViewChecklists}
            />
          ))}
        </div>
      )}

      {/* Service Form Modal */}
      <ServiceFormModal
        isOpen={showFormModal}
        onClose={() => {
          setShowFormModal(false);
          setSelectedService(null);
        }}
        onSuccess={handleFormSuccess}
        service={selectedService}
      />

      {/* Delete Service Modal */}
      <DeleteServiceModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSelectedService(null);
        }}
        onSuccess={handleDeleteSuccess}
        service={selectedService}
      />
    </div>
  );
}
