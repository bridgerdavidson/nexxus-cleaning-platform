'use client'

// src/app/(dev)/ui-kit/sections/dialog-section.tsx
import * as React from 'react'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Section } from './section'
import { Specimen } from './section'

export function DialogSection() {
  return (
    <Section id="dialog" title="Dialog">
      <Specimen label="Triggered dialog with form body and footer actions">
        <Dialog>
          <DialogTrigger asChild>
            <Button>Open Dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit service note</DialogTitle>
              <DialogDescription>
                Update the note for this service. Changes are saved immediately.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <FormField label="Note" htmlFor="dialog-note">
                <Input
                  id="dialog-note"
                  placeholder="Add a note for the cleaner..."
                  defaultValue="Use the side gate code 4892."
                />
              </FormField>
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Specimen>
    </Section>
  )
}
