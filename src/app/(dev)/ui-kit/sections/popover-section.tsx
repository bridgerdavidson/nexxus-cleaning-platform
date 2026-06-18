'use client'

// src/app/(dev)/ui-kit/sections/popover-section.tsx
import * as React from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Section, Specimen } from './section'

export function PopoverSection() {
  const [value, setValue] = React.useState('')
  const [open, setOpen] = React.useState(false)

  function handleSave() {
    setOpen(false)
    setValue('')
  }

  return (
    <Section id="popover" title="Popover">
      <Specimen label="Button trigger with inline form">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline">Add note</Button>
          </PopoverTrigger>
          <PopoverContent className="w-64" align="start">
            <div className="grid gap-3">
              <div className="grid gap-1">
                <label htmlFor="note-input" className="text-sm font-medium leading-none text-foreground">
                  Note
                </label>
                <Input
                  id="note-input"
                  placeholder="Enter a note..."
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={handleSave}>
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </Specimen>
    </Section>
  )
}
