// Fictional company used across every landing showcase so the page tells one
// coherent story. Pure fixtures, zero network.

export const DEMO_COMPANY = 'Brightside Cleaning Co'

export interface DemoCleaner {
  id: string
  name: string
  initials: string
}

export const DEMO_CLEANERS: DemoCleaner[] = [
  { id: 'maria', name: 'Maria R.', initials: 'MR' },
  { id: 'james', name: 'James T.', initials: 'JT' },
]

export type DemoJobStatus = 'scheduled' | 'in_progress' | 'completed' | 'pending'

export interface DemoJob {
  id: string
  time: string
  customer: string
  address: string
  service: string
  price: number
  cleanerId: string | null
  status: DemoJobStatus
}

export const DEMO_JOBS: DemoJob[] = [
  {
    id: 'j1',
    time: '9:00 AM',
    customer: 'Chen family',
    address: '114 Birch Ln',
    service: 'Standard clean',
    price: 140,
    cleanerId: 'maria',
    status: 'in_progress',
  },
  {
    id: 'j2',
    time: '1:30 PM',
    customer: 'Harbor View rental',
    address: '22 Harbor View',
    service: 'Move-out clean',
    price: 220,
    cleanerId: 'james',
    status: 'scheduled',
  },
  {
    id: 'j3',
    time: 'Thu 9:00 AM',
    customer: 'Sarah K.',
    address: '8 Cedar Ct',
    service: 'Deep clean, 3 bd 2 ba',
    price: 180,
    cleanerId: null,
    status: 'pending',
  },
]

export const AUTO_BOOKING: DemoJob = {
  id: 'j4',
  time: 'Fri 10:00 AM',
  customer: 'Nguyen home',
  address: '41 Meadow Dr',
  service: 'Standard clean',
  price: 150,
  cleanerId: null,
  status: 'pending',
}

export function cleanerById(id: string | null): DemoCleaner | undefined {
  return DEMO_CLEANERS.find((c) => c.id === id)
}
