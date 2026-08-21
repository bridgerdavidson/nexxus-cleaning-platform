"use client";

import { useState } from "react";
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { Plus, Pencil, Copy, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { SortableTask } from "./SortableTask";
import type { ChecklistVM } from "./services-types";

export function ChecklistCard({
  checklist,
  canManage,
  onAddTasks,
  onSaveTask,
  onDeleteTask,
  onReorderTasks,
  onEditChecklist,
  onDuplicateChecklist,
  onDeleteChecklist,
}: {
  checklist: ChecklistVM;
  canManage: boolean;
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void | Promise<void>;
  onDeleteChecklist: (checklistId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [draft, setDraft] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = checklist.tasks.map((t) => t.id);
    const next = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string));
    onReorderTasks(checklist.id, next);
  };

  const submitAdd = () => {
    if (draft.trim()) onAddTasks(checklist.id, draft);
    setDraft("");
    setAdding(false);
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="font-bold text-foreground">{checklist.name}</span>
        <Badge variant="secondary" className="tnum">{checklist.priceAdderLabel}</Badge>
        {canManage && (
          <div className="ml-auto flex items-center gap-0.5">
            <Button size="icon" variant="ghost" aria-label="Edit checklist" onClick={() => onEditChecklist(checklist.id)}>
              <Pencil className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Duplicate checklist"
              loading={duplicating}
              onClick={async () => {
                if (duplicating) return;
                setDuplicating(true);
                try {
                  await onDuplicateChecklist(checklist.id);
                } finally {
                  setDuplicating(false);
                }
              }}
            >
              <Copy className="size-4" />
            </Button>
            <Button size="icon" variant="ghost" aria-label="Delete checklist" onClick={() => onDeleteChecklist(checklist.id)}>
              <Trash2 className="size-4 text-critical-700" />
            </Button>
          </div>
        )}
      </div>

      <div className="p-2">
        {checklist.tasks.length === 0 && !adding && (
          <p className="px-2 py-3 text-sm text-muted-foreground">No tasks yet. Add the first one.</p>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={checklist.tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            {checklist.tasks.map((t) => (
              <SortableTask key={t.id} task={t} canManage={canManage} onSave={onSaveTask} onDelete={onDeleteTask} />
            ))}
          </SortableContext>
        </DndContext>

        {canManage && (adding ? (
          <div className="flex flex-col gap-2 px-2 py-2">
            <Textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitAdd();
                if (e.key === "Escape") { setDraft(""); setAdding(false); }
              }}
              placeholder="Add a task. Paste multiple lines to add several at once."
              rows={2}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={submitAdd}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setDraft(""); setAdding(false); }}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="mt-1 text-muted-foreground" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add task
          </Button>
        ))}
      </div>
    </Card>
  );
}
