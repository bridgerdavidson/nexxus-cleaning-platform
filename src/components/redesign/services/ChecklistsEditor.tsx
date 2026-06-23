"use client";

import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  arrayMove, useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChecklistCard } from "./ChecklistCard";
import type { ChecklistVM } from "./services-types";

type CardHandlers = {
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
};

function SortableChecklist({
  checklist, canManage, handlers,
}: { checklist: ChecklistVM; canManage: boolean; handlers: CardHandlers }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: checklist.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  return (
    <div ref={setNodeRef} style={style}>
      <ChecklistCard
        checklist={checklist}
        canManage={canManage}
        handleProps={{ attributes, listeners }}
        {...handlers}
      />
    </div>
  );
}

export function ChecklistsEditor({
  checklists, canManage, onReorderChecklists, onAddChecklist, ...handlers
}: {
  checklists: ChecklistVM[];
  canManage: boolean;
  onReorderChecklists: (orderedIds: string[]) => void;
  onAddChecklist: () => void;
} & CardHandlers) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = checklists.map((c) => c.id);
    onReorderChecklists(arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string)));
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-[0.04em] text-muted-foreground">Checklists</h3>
        {canManage && (
          <Button size="sm" variant="outline" onClick={onAddChecklist}>
            <Plus className="size-4" /> Add checklist
          </Button>
        )}
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={checklists.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {checklists.map((c) => (
              <SortableChecklist key={c.id} checklist={c} canManage={canManage} handlers={handlers} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
