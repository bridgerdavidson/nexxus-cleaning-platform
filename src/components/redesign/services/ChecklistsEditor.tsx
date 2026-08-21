"use client";

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

export function ChecklistsEditor({
  checklists, canManage, onAddChecklist, ...handlers
}: {
  checklists: ChecklistVM[];
  canManage: boolean;
  onAddChecklist: () => void;
} & CardHandlers) {
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
      {/* Tier order is locked (cheapest first; see compareChecklists) and tier
          drag-reorder is gone on purpose: an edit must never appear to shuffle
          the list. Tasks INSIDE a card stay drag-reorderable. */}
      <div className="space-y-3">
        {checklists.map((c) => (
          <ChecklistCard key={c.id} checklist={c} canManage={canManage} {...handlers} />
        ))}
      </div>
    </section>
  );
}
