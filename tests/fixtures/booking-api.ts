import type { BookingAgencySale, BookingEvent, BookingProject, BookingUnit } from '@/lib/sources/booking/types';

/**
 * A stand-in for the Booking API, in the shape its own integration guide
 * documents.
 *
 * Built to carry the traps rather than a tidy sample: a unit whose `status`
 * says "Booked" while its code says it is only waiting for payment, and
 * another the other way round; a foreign-quota unit priced above the Thai
 * price; a unit with no price at all; and one blocked from sale, which should
 * not count towards what the project expects to sell for.
 */

export const bookingProjects: BookingProject[] = [
  {
    name: 'MARINA GOLDEN BAY VICTORIA',
    code: 'MARGOLBAYVIC',
    type: 'Condo',
    status: 'active',
    buildings: [{ name: 'MGB', code: 'MGB', floorsCount: 45 }],
    units: {
      total: 6, available: 2, holding: 0, reserved: 1,
      booked: 1, sold: 1, blocked: 1, inactive: 0, maintenance: 0,
    },
  },
  {
    name: 'Project LOVEIT',
    code: 'LOVEIT',
    type: 'Condo',
    status: 'active',
    buildings: [{ name: 'APOLLO', code: 'APOLLO', floorsCount: 8 }],
    units: {
      total: 3, available: 1, holding: 0, reserved: 0,
      booked: 0, sold: 2, blocked: 0, inactive: 0, maintenance: 0,
    },
  },
];

const unit = (u: Partial<BookingUnit> & Pick<BookingUnit, 'project' | 'unit' | 'statusCode'>): BookingUnit => ({
  building: 'MGB', floor: '6', status: '', type: '1 Bedroom', size: 28.7,
  price: { tc: null, tq: null, fq: null }, quota: null, agency: null, sale: null,
  bookingRef: null, bookingTime: null, updatedAt: '2026-09-10T09:40:00.000Z', version: 1,
  ...u,
});

export const bookingUnits: BookingUnit[] = [
  // Sold, Thai-company quota. status "Booked" is the salesperson's word for sold.
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '601', floor: '6',
    status: 'Booked', statusCode: 'SOLD', quota: 'TC',
    price: { tc: 2_990_000, tq: 2_990_000, fq: 3_229_200 },
    agency: 'AG-001', sale: 'MS MARINA GAVVA', bookingRef: 'BK-0001',
  }),
  // Waiting for payment. Its code is BOOKED, which is NOT sold — the trap.
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '602', floor: '6',
    status: 'Waiting Payment', statusCode: 'BOOKED', quota: 'FQ',
    price: { tc: 3_000_000, tq: 3_000_000, fq: 3_240_000 },
    agency: 'AG-002', sale: 'Anna', bookingRef: 'BK-0002',
  }),
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '701', floor: '7',
    status: 'Reserved', statusCode: 'RESERVED', quota: 'TQ',
    price: { tc: 3_100_000, tq: 3_050_000, fq: 3_348_000 },
  }),
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '702', floor: '7',
    status: 'Available', statusCode: 'AVAILABLE',
    price: { tc: 3_200_000, tq: 3_200_000, fq: 3_456_000 },
  }),
  // On the market but carrying no price at all.
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '703', floor: '7',
    status: 'Available', statusCode: 'AVAILABLE',
    price: { tc: null, tq: null, fq: null },
  }),
  // Blocked: not for sale this round, so not part of the sale value.
  unit({
    project: 'MARINA GOLDEN BAY VICTORIA', unit: '801', floor: '8',
    status: '', statusCode: 'BLOCKED',
    price: { tc: 9_000_000, tq: 9_000_000, fq: 9_720_000 },
  }),
  // LOVEIT prices the foreign quota 8% above the Thai one.
  unit({
    project: 'Project LOVEIT', unit: 'A101', building: 'APOLLO', floor: '1',
    status: 'Booked', statusCode: 'SOLD', quota: 'FQ',
    price: { tc: 1_000_000, tq: 1_000_000, fq: 1_080_000 },
    agency: 'AG-001', sale: 'Anna',
  }),
  unit({
    project: 'Project LOVEIT', unit: 'A102', building: 'APOLLO', floor: '1',
    status: 'Booked', statusCode: 'SOLD', quota: 'TC',
    price: { tc: 1_200_000, tq: 1_200_000, fq: 1_296_000 },
    agency: 'AG-003', sale: 'Bee',
  }),
  unit({
    project: 'Project LOVEIT', unit: 'A103', building: 'APOLLO', floor: '1',
    status: 'Available', statusCode: 'AVAILABLE',
    price: { tc: 1_300_000, tq: 1_300_000, fq: 1_404_000 },
  }),
];

export const bookingAgencies: BookingAgencySale[] = [
  {
    agency: 'AG-001', sold: 2, booked: 0, reserved: 0, holding: 0,
    salesValue: 4_070_000, lastSaleAt: '2026-09-01T04:12:00.000Z',
    projects: { 'MARINA GOLDEN BAY VICTORIA': 1, 'Project LOVEIT': 1 },
  },
  {
    agency: 'AG-003', sold: 1, booked: 0, reserved: 0, holding: 0,
    salesValue: 1_200_000, lastSaleAt: '2026-08-20T04:12:00.000Z',
    projects: { 'Project LOVEIT': 1 },
  },
];

export const bookingEvents: BookingEvent[] = [
  {
    id: 'log:aaa', type: 'booking.status_changed', occurredAt: '2026-09-10T03:45:40.120Z',
    project: 'MARINA GOLDEN BAY VICTORIA',
    room: { code: '601', building: 'MGB', floor: '6', type: '1 Bedroom', sizeValue: 28.7 },
    fromStatus: 'Available', toStatus: 'Booked',
    fromStatusCode: 'AVAILABLE', toStatusCode: 'SOLD', sale_effect: 1,
    quota: 'TC', price: 2_990_000, bookingRef: 'BK-0001', agency: 'AG-001', sale: 'MS MARINA GAVVA',
  },
  {
    id: 'log:bbb', type: 'booking.status_changed', occurredAt: '2026-09-10T04:00:00.000Z',
    project: 'Project LOVEIT',
    room: { code: 'A104', building: 'APOLLO', floor: '1', type: 'Studio', sizeValue: 22 },
    fromStatus: 'Booked', toStatus: 'Available',
    fromStatusCode: 'SOLD', toStatusCode: 'AVAILABLE', sale_effect: -1,
    quota: 'TC', price: 900_000, bookingRef: 'BK-0009', agency: 'AG-003', sale: 'Bee',
  },
];
