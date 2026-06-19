// src/app/(dev)/ui-kit/page.tsx
'use client'

import { ThemeToggle } from '@/components/ui/theme-toggle'
import { CanvasToggle } from '@/components/ui/canvas-toggle'
import { BrandSection } from './sections/brand-section'
import { ButtonsSection } from './sections/buttons-section'
import { InputsSection } from './sections/inputs-section'
import { SelectSection } from './sections/select-section'
import { TogglesSection } from './sections/toggles-section'
import { DatePickerSection } from './sections/datepicker-section'
import { CardsSection } from './sections/cards-section'
import { BadgesSection } from './sections/badges-section'
import { AvatarsSection } from './sections/avatars-section'
import { StatsSection } from './sections/stats-section'
import { FeedbackSection } from './sections/feedback-section'
import { TableSection } from './sections/table-section'
import { DialogSection } from './sections/dialog-section'
import { SheetSection } from './sections/sheet-section'
import { MenusSection } from './sections/menus-section'
import { PopoverSection } from './sections/popover-section'
import { ToastSection } from './sections/toast-section'
import { Toaster } from '@/components/ui/toast'
import { ConfirmSection } from './sections/confirm-section'
import { TabsSection } from './sections/tabs-section'
import { NavSection } from './sections/nav-section'

export default function UiKitPage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight text-foreground">Nexxus UI Kit</h1>
          <p className="mt-2 text-base text-muted-foreground">
            Redesign primitives. Plus Jakarta Sans, warm canvas, brand blue, pillowy shapes. Toggle the theme to verify both.
          </p>
        </div>
        <div className="flex items-center gap-2"><CanvasToggle /><ThemeToggle /></div>
      </header>

      <div className="grid gap-16">
        <BrandSection />
        <ButtonsSection />
        <InputsSection />
        <SelectSection />
        <TogglesSection />
        <DatePickerSection />
        <CardsSection />
        <BadgesSection />
        <AvatarsSection />
        <StatsSection />
        <FeedbackSection />
        <TableSection />
        <DialogSection />
        <SheetSection />
        <MenusSection />
        <PopoverSection />
        <ToastSection />
        <ConfirmSection />
        <TabsSection />
        <NavSection />
      </div>
      <Toaster position="top-right" />
    </div>
  )
}
