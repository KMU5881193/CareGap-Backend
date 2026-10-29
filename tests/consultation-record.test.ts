import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { validateDraft } from '../src/modules/be3-intelligence/analysis.js';
import {
  ConsultationRecordVersion,
  appendRecordVersion,
  createRecordReader,
  readAuthorizedRecordVersion,
  readRecordVersion,
  reviseRecordVersion,
  selectAnalysisSource,
} from '../src/modules/be2-consultations/consultation-record.js';
import type { RecordReader, RecordVersion } from '../src/shared/contracts.js';

const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherConsultationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const revisionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherPersonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const originalText = '합성 기록: 이번 주에는 산책을 두 번 했습니다.';
const revisedText = '합성 수정본: 산책 횟수만 따로 적습니다.';
const otherText = '다른 상담의 합성 문장입니다.';

function version(overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    consultation_id: consultationId,
    record_version_id: versionId,
    person_id: personId,
    text: originalText,
    ...overrides,
  };
}

function withoutText(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(originalText);
  expect(JSON.stringify(value)).not.toContain(revisedText);
  expect(JSON.stringify(value)).not.toContain(otherText);
}

describe('consultation record validation', () => {
  it('accepts a record version and preserves identifier case', async () => {
    const input = version({
      consultation_id: consultationId.toUpperCase(),
      record_version_id: versionId.toUpperCase(),
      person_id: personId.toUpperCase(),
    });
    const parsed = ConsultationRecordVersion.parse(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    const stored: RecordVersion = parsed;
    expect(stored.consultation_id).toBe(consultationId.toUpperCase());
    const reader: RecordReader = createRecordReader([parsed]);
    await expect(reader.getVersion(consultationId, versionId)).resolves.toMatchObject({
      consultation_id: consultationId.toUpperCase(),
      text: originalText,
    });
  });

  it('rejects a bad id, a missing field, and an unknown field', () => {
    expect(() => ConsultationRecordVersion.parse(version({ consultation_id: 'consultation-1' }))).toThrow(ZodError);
    expect(() => ConsultationRecordVersion.parse({
      consultation_id: consultationId,
      record_version_id: versionId,
      person_id: personId,
    })).toThrow(ZodError);
    expect(() => ConsultationRecordVersion.parse({ ...version(), kind: 'original' })).toThrow(ZodError);
    try {
      ConsultationRecordVersion.parse(version({ record_version_id: 'version-1' }));
    } catch (error) {
      withoutText(error);
    }
  });
});

describe('consultation record versions', () => {
  it('keeps the source version unchanged when a revision is created', () => {
    const source = Object.freeze(version());
    const revised = reviseRecordVersion(source, { record_version_id: revisionId, text: revisedText });
    expect(source.text).toBe(originalText);
    expect(revised).toEqual({
      ok: true,
      version: { ...version(), record_version_id: revisionId, text: revisedText },
    });
    expect(revised.ok && revised.version).not.toBe(source);
    expect(reviseRecordVersion(source, { record_version_id: versionId.toUpperCase(), text: revisedText })).toEqual({
      ok: false,
      reason: 'duplicate_version',
    });
    expect(source.text).toBe(originalText);
    expect(() => reviseRecordVersion(source, {
      record_version_id: revisionId,
      text: revisedText,
      consultation_id: otherConsultationId,
    })).toThrow(ZodError);
  });

  it('appends a version without modifying the input collection', () => {
    const source = Object.freeze(version());
    const existing = Object.freeze([source]);
    const revised = reviseRecordVersion(source, { record_version_id: revisionId, text: revisedText });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const appended = appendRecordVersion(existing, revised.version);
    expect(existing).toHaveLength(1);
    expect(existing[0]).toBe(source);
    expect(source.text).toBe(originalText);
    expect(appended).toEqual({
      ok: true,
      versions: [version(), revised.version],
    });
    if (appended.ok) appended.versions[0].text = 'changed-after-return';
    expect(source.text).toBe(originalText);
  });

  it('rejects a duplicate version id and does not choose among ambiguous rows', () => {
    const source = version();
    const duplicate = appendRecordVersion([source], version({ text: revisedText }));
    expect(duplicate).toEqual({ ok: false, reason: 'duplicate_version' });
    withoutText(duplicate);
    expect(appendRecordVersion([source], version({ record_version_id: versionId.toUpperCase(), text: revisedText }))).toEqual({
      ok: false,
      reason: 'duplicate_version',
    });
    const ambiguous = readRecordVersion([
      version({ text: originalText }),
      version({ consultation_id: otherConsultationId, text: otherText }),
    ], consultationId, versionId);
    expect(ambiguous).toEqual({ found: false, reason: 'ambiguous_version' });
    withoutText(ambiguous);
  });

  it('does not attach a version id to another consultation or person', () => {
    const source = version();
    const otherConsultation = appendRecordVersion(
      [source],
      version({ consultation_id: otherConsultationId, text: otherText }),
    );
    expect(otherConsultation).toEqual({ ok: false, reason: 'consultation_mismatch' });
    withoutText(otherConsultation);
    const otherPerson = appendRecordVersion(
      [source],
      version({
        consultation_id: consultationId.toUpperCase(),
        record_version_id: revisionId,
        person_id: otherPersonId,
        text: otherText,
      }),
    );
    expect(otherPerson).toEqual({ ok: false, reason: 'person_mismatch' });
    withoutText(otherPerson);
    const samePerson = appendRecordVersion(
      [source],
      version({
        consultation_id: consultationId.toUpperCase(),
        record_version_id: revisionId,
        person_id: personId.toUpperCase(),
        text: revisedText,
      }),
    );
    expect(samePerson.ok).toBe(true);
    const foreign = readRecordVersion([source], otherConsultationId, versionId);
    expect(foreign).toEqual({ found: false, reason: 'consultation_mismatch' });
    withoutText(foreign);
  });

  it('reports a missing version without source text', () => {
    const missing = readRecordVersion([version()], consultationId, revisionId);
    expect(missing).toEqual({ found: false, reason: 'not_found' });
    withoutText(missing);
  });

  it('reads a version by id when the collection order is reversed', () => {
    const original = version();
    const revision = version({ record_version_id: revisionId, text: revisedText });
    const reversed = [revision, original];
    expect(readRecordVersion(reversed, consultationId, versionId)).toEqual({ found: true, version: original });
    expect(readRecordVersion(reversed, consultationId.toUpperCase(), revisionId)).toEqual({ found: true, version: revision });
  });
});

describe('record reader and analysis source', () => {
  it('matches RecordReader and withholds a version from another consultation', async () => {
    const source = version();
    const collection = [source, version({
      consultation_id: otherConsultationId,
      record_version_id: revisionId,
      text: otherText,
    })];
    const reader: RecordReader = createRecordReader(collection);
    collection.push(version({ record_version_id: '11111111-1111-4111-8111-111111111111', text: revisedText }));
    await expect(reader.getVersion(consultationId, versionId)).resolves.toEqual(source);
    await expect(reader.getVersion(consultationId, revisionId)).resolves.toBeNull();
    await expect(reader.getVersion(consultationId, '11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
    await expect(reader.getVersion(consultationId, 'cccccccc-cccc-4ccc-8ccc-cccccccccccd')).resolves.toBeNull();
    const returned = await reader.getVersion(consultationId, versionId);
    expect(returned).not.toBe(source);
    if (returned) returned.text = 'changed-after-read';
    await expect(reader.getVersion(consultationId, versionId)).resolves.toEqual(source);
  });

  it('keeps stored text when the caller later edits the input or a returned copy', async () => {
    const source = version();
    const collection = [source];
    const reader: RecordReader = createRecordReader(collection);
    const appended = appendRecordVersion(collection, version({ record_version_id: revisionId, text: revisedText }));
    source.text = '입력에서 바꾼 문장';
    collection[0] = version({ text: otherText });
    await expect(reader.getVersion(consultationId, versionId)).resolves.toEqual(version());
    expect(appended).toEqual({
      ok: true,
      versions: [version(), version({ record_version_id: revisionId, text: revisedText })],
    });
    const returned = await reader.getVersion(consultationId, versionId);
    expect(returned).not.toBeNull();
    if (!returned) return;
    returned.text = '반환본에서 바꾼 문장';
    await expect(reader.getVersion(consultationId, versionId)).resolves.toEqual(version());
    const stored = version();
    const first = readRecordVersion([stored], consultationId, versionId);
    expect(first.found).toBe(true);
    if (!first.found) return;
    first.version.text = '조회 결과에서 바꾼 문장';
    expect(stored.text).toBe(originalText);
    expect(readRecordVersion([stored], consultationId, versionId)).toEqual({ found: true, version: version() });
  });

  it('selects one source version for analysis and leaves that version unchanged', () => {
    const source = Object.freeze(version());
    const allowed = { verified: true, allowed: true } as const;
    const selected = selectAnalysisSource([source], consultationId, versionId, personId, allowed);
    expect(selected).toEqual({
      ok: true,
      source: {
        consultation_id: consultationId,
        record_version_id: versionId,
        text: originalText,
      },
    });
    if (!selected.ok) return;
    expect(validateDraft({
      status: 'draft',
      findings: [{
        text: '주간 산책 기록',
        change: 'unknown',
        evidence: [{ consultation_id: consultationId, record_version_id: versionId, quote: '산책을 두 번' }],
      }],
      questions: [],
    }, [selected.source]).findings[0].change).toBe('unknown');
    const revised = reviseRecordVersion(source, { record_version_id: revisionId, text: revisedText });
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    const appended = appendRecordVersion([source], revised.version);
    expect(appended.ok).toBe(true);
    expect(source.text).toBe(originalText);
    expect(readRecordVersion(appended.ok ? appended.versions : [], consultationId, versionId)).toEqual({
      found: true,
      version: source,
    });
    const wrongPerson = selectAnalysisSource([source], consultationId, versionId, otherPersonId, allowed);
    expect(wrongPerson).toEqual({ ok: false, reason: 'person_mismatch' });
    withoutText(wrongPerson);
    const wrongConsultation = selectAnalysisSource([source], otherConsultationId, versionId, personId, allowed);
    expect(wrongConsultation).toEqual({ ok: false, reason: 'consultation_mismatch' });
    withoutText(wrongConsultation);
  });

  it('does not treat an unverified decision or a role as access', () => {
    const source = version();
    const unverified = readAuthorizedRecordVersion([source], consultationId, versionId, { verified: false });
    expect(unverified).toEqual({ ok: false, reason: 'access_not_verified' });
    withoutText(unverified);
    const denied = selectAnalysisSource([source], consultationId, versionId, personId, { verified: true, allowed: false });
    expect(denied).toEqual({ ok: false, reason: 'access_denied' });
    withoutText(denied);
    expect(() => readAuthorizedRecordVersion([source], consultationId, versionId, { role: 'staff' })).toThrow(ZodError);
    expect(() => selectAnalysisSource(
      [source],
      consultationId,
      versionId,
      personId,
      { verified: true, allowed: true, role: 'admin' },
    )).toThrow(ZodError);
    try {
      readAuthorizedRecordVersion([source], consultationId, versionId, { role: 'admin' });
    } catch (error) {
      withoutText(error);
    }
  });
});
