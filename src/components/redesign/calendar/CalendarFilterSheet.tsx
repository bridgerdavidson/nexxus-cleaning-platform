// src/components/redesign/calendar/CalendarFilterSheet.tsx
'use client';

import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CleanerOption } from '@/components/redesign/bookings/bookings-types';
import { STATUS_OPTIONS } from './CalendarToolbar';

/** Bottom-sheet filters for the mobile calendar (same cleaner/status filters as desktop). */
export function CalendarFilterSheet({
  open, onOpenChange, cleaners, cleanerFilter, statusFilter, onCleanerFilter, onStatusFilter,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cleaners: CleanerOption[];
  cleanerFilter: string;
  statusFilter: string;
  onCleanerFilter: (v: string) => void;
  onStatusFilter: (v: string) => void;
}) {
  const active = cleanerFilter !== 'all' || statusFilter !== 'all';
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <div className="space-y-4 px-5">
          <div className="space-y-1.5">
            <Label htmlFor="cal-filter-cleaner">Cleaner</Label>
            <Select value={cleanerFilter} onValueChange={onCleanerFilter}>
              <SelectTrigger id="cal-filter-cleaner" className="h-11 w-full" aria-label="Filter by cleaner">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cleaners</SelectItem>
                {cleaners.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cal-filter-status">Status</Label>
            <Select value={statusFilter} onValueChange={onStatusFilter}>
              <SelectTrigger id="cal-filter-status" className="h-11 w-full" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DrawerFooter>
          {active ? (
            <Button
              variant="ghost"
              onClick={() => { onCleanerFilter('all'); onStatusFilter('all'); }}
            >
              Reset filters
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
