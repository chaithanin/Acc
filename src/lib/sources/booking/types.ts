/**
 * What the Chaithanin Booking API answers with.
 *
 * Unlike Mango RE, this one is a published, versioned, read-only API with its
 * own guide, so these types follow the documented contract rather than a
 * survey of what a screen happened to send. That also means a field going
 * missing is a breaking change on their side rather than an upgrade accident
 * — but the check in `client.ts` still runs, because a contract is a promise
 * and not a guarantee.
 */

/** Every successful response carries these. */
export interface BookingEnvelope {
  ok: boolean;
  version?: string;
}

/** A page of a list endpoint. */
export interface BookingPage<T> extends BookingEnvelope {
  page: number;
  limit: number;
  total: number;
  pages: number;
  data: T[];
}

export interface BookingKey {
  id: string;
  name: string;
  scopes: string[];
}

export interface BookingProject {
  name: string;
  code: string;
  type: string;
  status: string;
  buildings: { name: string; code: string; floorsCount: number }[];
  units: {
    total: number;
    available: number;
    holding: number;
    reserved: number;
    booked: number;
    sold: number;
    blocked: number;
    inactive: number;
    maintenance: number;
  };
}

/**
 * The three prices a unit carries.
 *
 * Thai condominium law caps foreign ownership at 49% of the saleable area, so
 * a unit is priced once per buyer type and the quota says which price applies.
 * Some projects set the foreign price above the Thai one — LOVEIT by 8% — so
 * reading `tc` for everything quietly understates a foreign-quota sale.
 */
export interface BookingPrice {
  tc: number | null;
  tq: number | null;
  fq: number | null;
}

export type BookingQuota = 'TC' | 'TQ' | 'FQ' | string;

/**
 * The central status codes.
 *
 * `status` is the wording a salesperson sees and can change; `statusCode` is
 * the stable code. Read the code — and note the trap that makes this more than
 * a style preference: `status: "Booked"` means sold, while
 * `statusCode: "BOOKED"` means waiting for payment. The same word, one step
 * apart in the funnel.
 */
export type BookingStatusCode =
  | 'AVAILABLE'
  | 'HOLDING'
  | 'RESERVED'
  | 'BOOKED'
  | 'SOLD'
  | 'BLOCKED'
  | 'NO_ACTIVE'
  | 'MAINTENANCE'
  | string;

export interface BookingUnit {
  project: string;
  building: string;
  floor: string;
  unit: string;
  status: string;
  statusCode: BookingStatusCode;
  type: string;
  size: number | null;
  view?: string;
  direction?: string;
  price: BookingPrice;
  quota: BookingQuota | null;
  agency: string | null;
  sale: string | null;
  bookingRef: string | null;
  bookingTime: string | null;
  updatedAt: string | null;
  /** Rises on every edit, so a held copy can be told to be stale. */
  version?: number;
  /** Only present when the key carries `read:units:pii`. */
  customer?: string | null;
  mobile?: string | null;
  payment?: unknown;
}

export interface BookingEvent {
  id: string;
  type: string;
  occurredAt: string;
  project: string;
  room: { code: string; building: string; floor: string; type: string; sizeValue: number | null };
  fromStatus: string;
  toStatus: string;
  fromStatusCode: BookingStatusCode;
  toStatusCode: BookingStatusCode;
  /** +1 entering sold, -1 leaving it, 0 for a move that does not touch the total. */
  sale_effect: number;
  quota: BookingQuota | null;
  price: number | null;
  bookingRef: string | null;
  agency: string | null;
  sale: string | null;
}

export interface BookingEventPage extends BookingEnvelope {
  count: number;
  hasMore: boolean;
  nextCursor: string | null;
  data: BookingEvent[];
}

export interface BookingAgencySale {
  agency: string;
  sold: number;
  booked: number;
  reserved: number;
  holding: number;
  salesValue: number;
  lastSaleAt: string | null;
  projects: Record<string, number>;
}

/** The status codes that count as a sale, and the ones that are still pipeline. */
export const SOLD_CODES: BookingStatusCode[] = ['SOLD'];
export const PIPELINE_CODES: BookingStatusCode[] = ['HOLDING', 'RESERVED', 'BOOKED'];
/** Not for sale in this round, so not part of what the project expects to sell. */
export const OFF_MARKET_CODES: BookingStatusCode[] = ['BLOCKED', 'NO_ACTIVE', 'MAINTENANCE'];

/** Fields a unit must carry for anything downstream to mean what it says. */
export const REQUIRED_UNIT_FIELDS = ['project', 'unit', 'statusCode', 'price'] as const;
