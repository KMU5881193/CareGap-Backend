import { z } from 'zod';
import { Id } from '../../shared/contracts.js';
import { compareUtcInstants, parseUtcInstant } from './availability.js';
import { relateUtcIntervals, type IntervalRelation } from './interval.js';

const relationNames = [
  'before',
  'meets',
  'overlaps',
  'starts',
  'during',
  'finishes',
  'equal',
  'after',
  'met-by',
  'overlapped-by',
  'started-by',
  'contains',
  'finished-by',
] as const;

type ListedRelation = typeof relationNames[number];
type RelationListMatches = [IntervalRelation] extends [ListedRelation]
  ? ([ListedRelation] extends [IntervalRelation] ? true : never)
  : never;
const relationListMatchesInterval: RelationListMatches = true;
void relationListMatchesInterval;

const RelationName = z.enum(relationNames);
const OccupyingAppointment = z.object({
  appointment_id: Id,
  staff_user_id: Id,
  person_id: Id,
  status: z.string().min(1),
  starts_at: z.string(),
  ends_at: z.string(),
}).strict();

const CandidateAppointment = z.object({
  staff_user_id: Id,
  person_id: Id,
  starts_at: z.string(),
  ends_at: z.string(),
}).strict();

export type ConflictFinding = {
  appointment_id: string;
  relation: IntervalRelation;
  axis: 'staff' | 'person';
};

export type ConflictAnalysis =
  | { configured: false; reason: 'policy_unset' }
  | { configured: true; conflicts: ConflictFinding[] };

export type ConflictPolicy = {
  occupyingStatuses: readonly string[];
  blockingRelations: readonly IntervalRelation[];
  excludeAppointmentId?: string;
};

// Empty occupancy or blocking lists are unset policy, not an approval.
// meets is a conflict only when the caller includes it. Status names are not fixed here.
export function findAppointmentConflicts(
  candidate: { staff_user_id: string; person_id: string; starts_at: string; ends_at: string },
  existing: readonly {
    appointment_id: string;
    staff_user_id: string;
    person_id: string;
    status: string;
    starts_at: string;
    ends_at: string;
  }[],
  policy: ConflictPolicy,
): ConflictAnalysis {
  const subject = CandidateAppointment.parse(candidate);
  assertUtcInterval(subject.starts_at, subject.ends_at);
  const rows = existing.map((row) => {
    const parsed = OccupyingAppointment.parse(row);
    assertUtcInterval(parsed.starts_at, parsed.ends_at);
    return parsed;
  });
  if (policy.excludeAppointmentId !== undefined) Id.parse(policy.excludeAppointmentId);
  const blockingRelations = z.array(RelationName).parse(policy.blockingRelations);
  if (policy.occupyingStatuses.length === 0 || blockingRelations.length === 0) {
    return { configured: false, reason: 'policy_unset' };
  }

  const occupying = new Set(policy.occupyingStatuses);
  const blocking = new Set<IntervalRelation>(blockingRelations);
  const conflicts: ConflictFinding[] = [];
  for (const row of rows) {
    if (policy.excludeAppointmentId !== undefined && sameUuid(row.appointment_id, policy.excludeAppointmentId)) continue;
    if (!occupying.has(row.status)) continue;
    const sameStaff = sameUuid(row.staff_user_id, subject.staff_user_id);
    const samePerson = sameUuid(row.person_id, subject.person_id);
    if (!sameStaff && !samePerson) continue;
    // Relation of the candidate to the existing row. before and after are not swapped.
    const relation = relateUtcIntervals(
      { starts_at: subject.starts_at, ends_at: subject.ends_at },
      { starts_at: row.starts_at, ends_at: row.ends_at },
    );
    if (!blocking.has(relation)) continue;
    if (sameStaff) conflicts.push({ appointment_id: row.appointment_id, relation, axis: 'staff' });
    if (samePerson) conflicts.push({ appointment_id: row.appointment_id, relation, axis: 'person' });
  }
  return { configured: true, conflicts };
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertUtcInterval(startsAt: string, endsAt: string) {
  parseUtcInstant(startsAt);
  parseUtcInstant(endsAt);
  if (compareUtcInstants(startsAt, endsAt) >= 0) throw new Error('UTC instant interval is not ordered');
}
