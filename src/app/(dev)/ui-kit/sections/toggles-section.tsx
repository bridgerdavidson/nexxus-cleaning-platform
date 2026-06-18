'use client'
// src/app/(dev)/ui-kit/sections/toggles-section.tsx
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
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
            <Label htmlFor="rg-weekly" className="cursor-pointer font-normal">Weekly</Label>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <RadioGroupItem value="biweekly" id="rg-biweekly" />
            <Label htmlFor="rg-biweekly" className="cursor-pointer font-normal">Biweekly (preselected)</Label>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-pointer select-none">
            <RadioGroupItem value="monthly" id="rg-monthly" />
            <Label htmlFor="rg-monthly" className="cursor-pointer font-normal">Monthly</Label>
          </label>

          <label className="flex items-center gap-3 min-h-11 cursor-not-allowed select-none opacity-50">
            <RadioGroupItem value="custom" id="rg-custom" disabled />
            <Label htmlFor="rg-custom" className="cursor-not-allowed font-normal">Custom (disabled)</Label>
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
