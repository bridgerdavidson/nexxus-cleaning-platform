"use client";

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Pencil, Trash2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TaskVM } from "./services-types";

export function SortableTask({
  task,
  canManage,
  onSave,
  onDelete,
}: {
  task: TaskVM;
  canManage: boolean;
  onSave: (id: string, task: string) => void;
  onDelete: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(task.task);

  // Keep the edit buffer in sync with the upstream task when not actively
  // editing (e.g., after a realtime refetch), so opening edit shows fresh text
  // without clobbering an in-progress edit.
  useEffect(() => {
    if (!editing) setText(task.task);
  }, [task.task, editing]);

  const style = { transform: CSS.Transform.toString(transform), transition };

  const commit = () => {
    const t = text.trim();
    if (!t) return;
    onSave(task.id, t);
    setEditing(false);
  };
  const cancel = () => {
    setText(task.task);
    setEditing(false);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group flex items-center gap-2 rounded-field px-2 py-1.5 hover:bg-muted/60",
        isDragging && "opacity-50",
      )}
    >
      {canManage && (
        <button
          type="button"
          className="cursor-grab text-muted-foreground/60 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder task"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}
      {editing ? (
        <>
          <Input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") cancel();
            }}
            className="h-9"
          />
          <Button size="icon" variant="ghost" aria-label="Save task" onClick={commit}>
            <Check className="size-4 text-positive-700" />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Cancel" onClick={cancel}>
            <X className="size-4" />
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 text-sm text-foreground">{task.task}</span>
          {canManage && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <Button size="icon" variant="ghost" aria-label="Edit task" onClick={() => setEditing(true)}>
                <Pencil className="size-4" />
              </Button>
              <Button size="icon" variant="ghost" aria-label="Delete task" onClick={() => onDelete(task.id)}>
                <Trash2 className="size-4 text-critical-700" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
