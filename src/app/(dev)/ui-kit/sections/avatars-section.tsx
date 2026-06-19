'use client'

// src/app/(dev)/ui-kit/sections/avatars-section.tsx
import * as React from 'react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Section, Specimen } from './section'

export function AvatarsSection() {
  return (
    <Section id="avatars" title="Avatar">
      <Specimen label="Image Avatar">
        <Avatar>
          <AvatarImage
            src="https://i.pravatar.cc/150?img=47"
            alt="Sample user"
          />
          <AvatarFallback>JD</AvatarFallback>
        </Avatar>
      </Specimen>

      <Specimen label="Initials Fallback (no image src)">
        <Avatar>
          <AvatarFallback>BM</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>SA</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>TK</AvatarFallback>
        </Avatar>
      </Specimen>

      <Specimen label="Sizes (size-9 / size-11 default / size-14)">
        <Avatar className="size-9 text-xs">
          <AvatarFallback>SM</AvatarFallback>
        </Avatar>
        <Avatar className="size-11">
          <AvatarFallback>MD</AvatarFallback>
        </Avatar>
        <Avatar className="size-14 text-base">
          <AvatarFallback>LG</AvatarFallback>
        </Avatar>
      </Specimen>

      <Specimen label="Overlapping Stack">
        <div className="flex -space-x-3">
          <Avatar className="size-10 ring-2 ring-background">
            <AvatarImage src="https://i.pravatar.cc/150?img=11" alt="User 1" />
            <AvatarFallback>A1</AvatarFallback>
          </Avatar>
          <Avatar className="size-10 ring-2 ring-background">
            <AvatarImage src="https://i.pravatar.cc/150?img=22" alt="User 2" />
            <AvatarFallback>A2</AvatarFallback>
          </Avatar>
          <Avatar className="size-10 ring-2 ring-background">
            <AvatarImage src="https://i.pravatar.cc/150?img=33" alt="User 3" />
            <AvatarFallback>A3</AvatarFallback>
          </Avatar>
          <Avatar className="size-10 ring-2 ring-background">
            <AvatarFallback className="text-xs">+4</AvatarFallback>
          </Avatar>
        </div>
      </Specimen>
    </Section>
  )
}
