'use client'
// src/app/(dev)/ui-kit/sections/select-section.tsx
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FormField } from '@/components/ui/form-field'
import { Section, Specimen } from './section'

export function SelectSection() {
  return (
    <Section id="selects" title="Select">
      <Specimen label="Default (uncontrolled)">
        <div className="w-full max-w-sm">
          <FormField htmlFor="select-service" label="Service type">
            <Select>
              <SelectTrigger id="select-service">
                <SelectValue placeholder="Choose a service" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Recurring</SelectLabel>
                  <SelectItem value="weekly">Weekly clean</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly clean</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>One-time</SelectLabel>
                  <SelectItem value="standard">Standard clean</SelectItem>
                  <SelectItem value="deep">Deep clean</SelectItem>
                  <SelectItem value="moveout">Move-out clean</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Specimen>

      <Specimen label="With helper text">
        <div className="w-full max-w-sm">
          <FormField
            htmlFor="select-duration"
            label="Estimated duration"
            helper="Time may vary based on property size."
          >
            <Select>
              <SelectTrigger id="select-duration">
                <SelectValue placeholder="Select duration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1h">1 hour</SelectItem>
                <SelectItem value="2h">2 hours</SelectItem>
                <SelectItem value="3h">3 hours</SelectItem>
                <SelectItem value="4h">4 hours</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Specimen>

      <Specimen label="Disabled">
        <div className="w-full max-w-sm">
          <FormField htmlFor="select-disabled" label="Assigned cleaner">
            <Select disabled>
              <SelectTrigger id="select-disabled">
                <SelectValue placeholder="Not available" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="c1">Alex M.</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Specimen>

      <Specimen label="Pre-selected value">
        <div className="w-full max-w-sm">
          <FormField htmlFor="select-preselected" label="Frequency">
            <Select defaultValue="biweekly">
              <SelectTrigger id="select-preselected">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Recurring</SelectLabel>
                  <SelectItem value="weekly">Weekly clean</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly clean</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>One-time</SelectLabel>
                  <SelectItem value="standard">Standard clean</SelectItem>
                  <SelectItem value="deep">Deep clean</SelectItem>
                  <SelectItem value="moveout">Move-out clean</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      </Specimen>
    </Section>
  )
}
