'use client'

// src/app/(dev)/ui-kit/sections/table-section.tsx
import * as React from 'react'
import { ChevronUp, ChevronDown, SearchX } from 'lucide-react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { StatusPill } from '@/components/ui/status-pill'
import { Skeleton } from '@/components/ui/skeleton'
import { Section } from './section'

type SortDir = 'ascending' | 'descending'

const JOBS = [
  { property: '42 Maple Drive',   date: 'Jun 18, 2026', status: 'completed'   as const, amount: '$120.00' },
  { property: '8 River Oaks Ct',  date: 'Jun 19, 2026', status: 'scheduled'   as const, amount: '$95.00'  },
  { property: '301 Summit Blvd',  date: 'Jun 20, 2026', status: 'in_progress' as const, amount: '$150.00' },
  { property: '17 Lakeview Ln',   date: 'Jun 22, 2026', status: 'pending'     as const, amount: '$80.00'  },
]

/** Shared label + card shell used in place of Specimen so the table sits flush. */
function TableSpecimen({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">{label}</p>
      <div className="shadow-soft-sm">
        {children}
      </div>
    </div>
  )
}

function JobsTable() {
  const [sortDir, setSortDir] = React.useState<SortDir>('ascending')

  const sorted = React.useMemo(() => {
    return [...JOBS].sort((a, b) =>
      sortDir === 'ascending'
        ? a.date.localeCompare(b.date)
        : b.date.localeCompare(a.date),
    )
  }, [sortDir])

  function toggleSort() {
    setSortDir((d) => (d === 'ascending' ? 'descending' : 'ascending'))
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead aria-sort={sortDir}>
            <button
              onClick={toggleSort}
              className="inline-flex items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={`Sort by date ${sortDir === 'ascending' ? 'descending' : 'ascending'}`}
            >
              Date
              {sortDir === 'ascending' ? (
                <ChevronUp className="size-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((job) => (
          <TableRow key={job.property}>
            <TableCell className="font-medium text-foreground">{job.property}</TableCell>
            <TableCell className="text-muted-foreground">{job.date}</TableCell>
            <TableCell>
              <StatusPill status={job.status} />
            </TableCell>
            <TableCell className="text-right tabular-nums text-foreground">{job.amount}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function SkeletonTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {[1, 2, 3].map((i) => (
          <TableRow key={i}>
            <TableCell><Skeleton className="h-4 w-36" /></TableCell>
            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
            <TableCell><Skeleton className="h-5 w-20 rounded-pill" /></TableCell>
            <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function EmptyTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={4}>
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted-foreground">
              <SearchX className="size-8" aria-hidden="true" />
              <p className="text-sm font-medium">No jobs found</p>
              <p className="text-xs">Try adjusting your filters or check back later.</p>
            </div>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

export function TableSection() {
  return (
    <Section id="table" title="Table">
      <TableSpecimen label="4-row jobs table (click Date header to sort)">
        <JobsTable />
      </TableSpecimen>

      <TableSpecimen label="Loading variant">
        <SkeletonTable />
      </TableSpecimen>

      <TableSpecimen label="Empty variant">
        <EmptyTable />
      </TableSpecimen>
    </Section>
  )
}
