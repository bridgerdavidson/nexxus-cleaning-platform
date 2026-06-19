'use client'
// src/app/(dev)/ui-kit/sections/toggles-section.tsx
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Section, Specimen } from './section'

export function TogglesSection() {
  return (
    <Section id="toggles" title="Toggles">

      {/* Checkbox */}
      <Specimen label="Checkbox">
        <div className="flex flex-col gap-3 w-full max-w-xs">

          {/* Default unchecked */}
          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <Checkbox id="cb-default" />
            <span className="text-sm text-foreground">Default (unchecked)</span>
          </label>

          {/* Checked */}
          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <Checkbox id="cb-checked" defaultChecked />
            <span className="text-sm text-foreground">Checked</span>
          </label>

          {/* Disabled unchecked */}
          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <Checkbox id="cb-disabled" disabled />
            <span className="text-sm text-foreground">Disabled</span>
          </label>

          {/* Disabled checked */}
          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <Checkbox id="cb-disabled-checked" disabled defaultChecked />
            <span className="text-sm text-foreground">Disabled (checked)</span>
          </label>

        </div>
      </Specimen>

      {/* RadioGroup */}
      <Specimen label="Radio Group">
        <RadioGroup defaultValue="biweekly" className="w-full max-w-xs">

          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <RadioGroupItem value="weekly" id="rg-weekly" />
            <span className="text-sm text-foreground select-none">Weekly</span>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <RadioGroupItem value="biweekly" id="rg-biweekly" />
            <span className="text-sm text-foreground select-none">Biweekly (preselected)</span>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <RadioGroupItem value="monthly" id="rg-monthly" />
            <span className="text-sm text-foreground select-none">Monthly</span>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <RadioGroupItem value="custom" id="rg-custom" disabled />
            <span className="text-sm text-foreground select-none">Custom (disabled)</span>
          </label>

        </RadioGroup>
      </Specimen>

      {/* Switch */}
      <Specimen label="Switch">
        <div className="flex flex-col gap-3 w-full max-w-xs">

          {/* Default off */}
          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <Switch id="sw-default" />
            <span className="text-sm text-foreground">Default (off)</span>
          </label>

          {/* On */}
          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <Switch id="sw-on" defaultChecked />
            <span className="text-sm text-foreground">On</span>
          </label>

          {/* Disabled off */}
          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <Switch id="sw-disabled" disabled />
            <span className="text-sm text-foreground">Disabled (off)</span>
          </label>

          {/* Disabled on */}
          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <Switch id="sw-disabled-on" disabled defaultChecked />
            <span className="text-sm text-foreground">Disabled (on)</span>
          </label>

        </div>
      </Specimen>

    </Section>
  )
}
