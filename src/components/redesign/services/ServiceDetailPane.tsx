"use client";

import { ChevronLeft, MoreHorizontal, Pencil, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChecklistsEditor } from "./ChecklistsEditor";
import type { ServiceDetailVM, ChecklistVM } from "./services-types";

export type ServiceDetailHandlers = {
  onBack: () => void;
  onEdit: () => void;
  onToggleActive: (next: boolean) => void;
  onDuplicateService: () => void;
  onDeleteService: () => void;
  onReorderChecklists: (orderedIds: string[]) => void;
  onAddChecklist: () => void;
  onAddTasks: (checklistId: string, raw: string) => void;
  onSaveTask: (taskId: string, task: string) => void;
  onDeleteTask: (taskId: string) => void;
  onReorderTasks: (checklistId: string, orderedIds: string[]) => void;
  onEditChecklist: (checklistId: string) => void;
  onDuplicateChecklist: (checklistId: string) => void;
  onDeleteChecklist: (checklistId: string) => void;
};

export function ServiceDetailPane({
  detail,
  checklists,
  checklistsLoading,
  canManage,
  ...h
}: {
  detail: ServiceDetailVM | null;
  checklists: ChecklistVM[];
  checklistsLoading: boolean;
  canManage: boolean;
} & ServiceDetailHandlers) {
  if (!detail) {
    return (
      <div className="grid h-full min-h-[40vh] place-items-center text-sm text-muted-foreground">
        Select a service to see its details.
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground lg:hidden" onClick={h.onBack}>
          <ChevronLeft className="size-4" /> All services
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-foreground">{detail.name}</h2>
              <Badge variant={detail.isActive ? "positive" : "secondary"}>
                {detail.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <p className="tnum text-sm text-muted-foreground">
              {detail.priceRangeLabel} · {detail.durationLabel} · {detail.serviceTypeLabel}
            </p>
          </div>
          {canManage && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <Switch checked={detail.isActive} onCheckedChange={h.onToggleActive} aria-label="Active" />
                Active
              </label>
              <Button variant="outline" size="sm" onClick={h.onEdit}>
                <Pencil className="size-4" /> Edit
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="More actions">
                    <MoreHorizontal className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={h.onDuplicateService}>
                    <Copy className="size-4" /> Duplicate service
                  </DropdownMenuItem>
                  <DropdownMenuItem destructive onSelect={h.onDeleteService}>
                    <Trash2 className="size-4" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
        {detail.description && <p className="text-sm text-foreground/80">{detail.description}</p>}
      </div>

      {checklistsLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
        </div>
      ) : (
        <ChecklistsEditor
          checklists={checklists}
          canManage={canManage}
          onReorderChecklists={h.onReorderChecklists}
          onAddChecklist={h.onAddChecklist}
          onAddTasks={h.onAddTasks}
          onSaveTask={h.onSaveTask}
          onDeleteTask={h.onDeleteTask}
          onReorderTasks={h.onReorderTasks}
          onEditChecklist={h.onEditChecklist}
          onDuplicateChecklist={h.onDuplicateChecklist}
          onDeleteChecklist={h.onDeleteChecklist}
        />
      )}
    </div>
  );
}
