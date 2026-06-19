'use client'

import { Plus, Trash2, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Section, Specimen } from './section'

export function ButtonsSection() {
  return (
    <Section id="buttons" title="Buttons">
      <Specimen label="Variants">
        <Button>New booking</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive"><Trash2 />Delete</Button>
        <Button variant="link">Link</Button>
      </Specimen>
      <Specimen label="Sizes">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="lg"><Plus />Large</Button>
      </Specimen>
      <Specimen label="States">
        <Button disabled>Disabled</Button>
        <Button loading>Saving</Button>
      </Specimen>
      <Specimen label="Icon buttons">
        <IconButton aria-label="Add"><Plus /></IconButton>
        <IconButton aria-label="Notifications" variant="outline"><Bell /></IconButton>
        <IconButton aria-label="Delete" variant="destructive"><Trash2 /></IconButton>
      </Specimen>
    </Section>
  )
}
