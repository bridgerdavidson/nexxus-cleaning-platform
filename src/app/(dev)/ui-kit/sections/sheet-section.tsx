'use client'

// src/app/(dev)/ui-kit/sections/sheet-section.tsx
import * as React from 'react'
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Section } from './section'
import { Specimen } from './section'

export function SheetSection() {
  return (
    <Section id="sheet" title="Sheet / Drawer">
      <Specimen label="Right sheet (filters panel)">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Open Filters</Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription>
                Narrow results by date, status, or cleaner.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-6 py-4">
              <FormField label="Date range" htmlFor="filter-date">
                <Input id="filter-date" type="date" />
              </FormField>
              <FormField label="Status" htmlFor="filter-status">
                <Input id="filter-status" placeholder="e.g. Completed" />
              </FormField>
            </div>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="ghost">Clear</Button>
              </SheetClose>
              <Button>Apply</Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Specimen>

      <Specimen label="Bottom sheet (quick actions)">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline">Quick Actions</Button>
          </SheetTrigger>
          <SheetContent side="bottom">
            <SheetHeader>
              <SheetTitle>Quick Actions</SheetTitle>
              <SheetDescription>
                Perform a fast action on this booking.
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-2 px-6 py-4">
              <Button variant="outline" className="w-full justify-start">
                Reassign cleaner
              </Button>
              <Button variant="outline" className="w-full justify-start">
                Send reminder
              </Button>
              <Button variant="destructive" className="w-full justify-start">
                Cancel booking
              </Button>
            </div>
            <SheetFooter>
              <SheetClose asChild>
                <Button variant="ghost" className="w-full">Dismiss</Button>
              </SheetClose>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </Specimen>
    </Section>
  )
}
