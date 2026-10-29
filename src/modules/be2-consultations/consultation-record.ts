import { z } from 'zod';
import { Id, type RecordReader, type RecordVersion } from '../../shared/contracts.js';

// Validates the shared RecordVersion fields. Length limits and empty text are not decided here.
export const ConsultationRecordVersion = z.object({
  consultation_id: Id,
  record_version_id: Id,
  person_id: Id,
  text: z.string(),
}).strict();

const RevisionInput = z.object({
  record_version_id: Id,
  text: z.string(),
}).strict();

const AccessDecision = z.union([
  z.object({ verified: z.literal(false) }).strict(),
  z.object({ verified: z.literal(true), allowed: z.boolean() }).strict(),
]);

export type RecordVersionLookup =
  | { found: true; version: RecordVersion }
  | { found: false; reason: 'not_found' | 'consultation_mismatch' | 'ambiguous_version' };

export type AppendRecordVersionResult =
  | { ok: true; versions: RecordVersion[] }
  | { ok: false; reason: 'duplicate_version' | 'consultation_mismatch' | 'person_mismatch' };

export type ReviseRecordVersionResult =
  | { ok: true; version: RecordVersion }
  | { ok: false; reason: 'duplicate_version' };

export type AuthorizedRecordRead =
  | { ok: true; version: RecordVersion }
  | { ok: false; reason: 'access_not_verified' | 'access_denied' | 'not_found' | 'consultation_mismatch' | 'ambiguous_version' };

export type AnalysisSourceSelection =
  | { ok: true; source: { consultation_id: string; record_version_id: string; text: string } }
  | {
      ok: false;
      reason:
        | 'access_not_verified'
        | 'access_denied'
        | 'not_found'
        | 'consultation_mismatch'
        | 'person_mismatch'
        | 'ambiguous_version';
    };

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function copyVersion(input: unknown): RecordVersion {
  const parsed = ConsultationRecordVersion.parse(input);
  return {
    consultation_id: parsed.consultation_id,
    record_version_id: parsed.record_version_id,
    person_id: parsed.person_id,
    text: parsed.text,
  };
}

function versionsOf(existing: readonly RecordVersion[]): RecordVersion[] {
  return existing.map((row) => copyVersion(row));
}

// A revision copies consultation_id and person_id from the source. Array position is not a version number.
export function reviseRecordVersion(source: RecordVersion, revision: unknown): ReviseRecordVersionResult {
  const current = copyVersion(source);
  const next = RevisionInput.parse(revision);
  if (sameUuid(current.record_version_id, next.record_version_id)) {
    return { ok: false, reason: 'duplicate_version' };
  }
  return {
    ok: true,
    version: {
      consultation_id: current.consultation_id,
      record_version_id: next.record_version_id,
      person_id: current.person_id,
      text: next.text,
    },
  };
}

export function appendRecordVersion(
  existing: readonly RecordVersion[],
  next: RecordVersion,
): AppendRecordVersionResult {
  const versions = versionsOf(existing);
  const added = copyVersion(next);
  const sameVersion = versions.filter((row) => sameUuid(row.record_version_id, added.record_version_id));
  if (sameVersion.length > 0) {
    const linkedElsewhere = sameVersion.some((row) => !sameUuid(row.consultation_id, added.consultation_id));
    return { ok: false, reason: linkedElsewhere ? 'consultation_mismatch' : 'duplicate_version' };
  }
  const sameConsultation = versions.some((row) =>
    sameUuid(row.consultation_id, added.consultation_id) && !sameUuid(row.person_id, added.person_id));
  if (sameConsultation) return { ok: false, reason: 'person_mismatch' };
  return { ok: true, versions: [...versions, added] };
}

// Lookup is only by consultation_id and record_version_id. Collection order does not select a version.
export function readRecordVersion(
  existing: readonly RecordVersion[],
  consultationId: string,
  versionId: string,
): RecordVersionLookup {
  const requestedConsultation = Id.parse(consultationId);
  const requestedVersion = Id.parse(versionId);
  const matches = versionsOf(existing).filter((row) => sameUuid(row.record_version_id, requestedVersion));
  if (matches.length === 0) return { found: false, reason: 'not_found' };
  if (matches.length > 1) return { found: false, reason: 'ambiguous_version' };
  const match = matches[0];
  if (!sameUuid(match.consultation_id, requestedConsultation)) {
    return { found: false, reason: 'consultation_mismatch' };
  }
  return { found: true, version: { ...match } };
}

export function createRecordReader(existing: readonly RecordVersion[]): RecordReader {
  const snapshot = versionsOf(existing);
  return {
    async getVersion(consultationId: string, versionId: string): Promise<RecordVersion | null> {
      const requestedConsultation = Id.safeParse(consultationId);
      const requestedVersion = Id.safeParse(versionId);
      if (!requestedConsultation.success || !requestedVersion.success) return null;
      const found = readRecordVersion(snapshot, requestedConsultation.data, requestedVersion.data);
      return found.found ? { ...found.version } : null;
    },
  };
}

// verified:false is not access. Role is not an input. AuthorizationPort is not called here.
function accessFailure(access: unknown): 'access_not_verified' | 'access_denied' | null {
  const decision = AccessDecision.parse(access);
  if (!decision.verified) return 'access_not_verified';
  if (!decision.allowed) return 'access_denied';
  return null;
}

export function readAuthorizedRecordVersion(
  existing: readonly RecordVersion[],
  consultationId: string,
  versionId: string,
  access: unknown,
): AuthorizedRecordRead {
  const failure = accessFailure(access);
  if (failure) return { ok: false, reason: failure };
  const found = readRecordVersion(existing, consultationId, versionId);
  if (!found.found) return { ok: false, reason: found.reason };
  return { ok: true, version: found.version };
}

// The source is the BE3 SourceVersion shape. Analysis text is not written back onto a stored version.
export function selectAnalysisSource(
  existing: readonly RecordVersion[],
  consultationId: string,
  versionId: string,
  personId: string,
  access: unknown,
): AnalysisSourceSelection {
  const read = readAuthorizedRecordVersion(existing, consultationId, versionId, access);
  if (!read.ok) return read;
  const requestedPerson = Id.parse(personId);
  if (!sameUuid(read.version.person_id, requestedPerson)) {
    return { ok: false, reason: 'person_mismatch' };
  }
  return {
    ok: true,
    source: {
      consultation_id: read.version.consultation_id,
      record_version_id: read.version.record_version_id,
      text: read.version.text,
    },
  };
}
