import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  createFollowUp,
  reviseFollowUp,
  transitionFollowUp,
  type FollowUpCreatePolicy,
  type FollowUpTask,
} from '../src/modules/be2-consultations/follow-up.js';
import type { RecordVersion } from '../src/shared/contracts.js';

const consultationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherConsultationId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const versionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherVersionId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const personId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const otherPersonId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const followUpId = '11111111-1111-4111-8111-111111111111';
const otherFollowUpId = '22222222-2222-4222-8222-222222222222';
const assigneeId = '33333333-3333-4333-8333-333333333333';
const sourceText = '합성 기록: 대상자가 서류 준비를 아직 마치지 못했습니다.';
const title = '다음 상담에서 서류 준비 여부를 확인';
const allowed = { verified: true, allowed: true } as const;
const stated: FollowUpCreatePolicy = { source: 'unset', assignee: 'unset', due: 'unset' };

function version(overrides: Partial<RecordVersion> = {}): RecordVersion {
  return {
    consultation_id: consultationId,
    record_version_id: versionId,
    person_id: personId,
    text: sourceText,
    ...overrides,
  };
}

function draft(overrides: Record<string, string> = {}) {
  return {
    follow_up_id: followUpId,
    person_id: personId,
    title,
    status: 'fixture-open',
    consultation_id: consultationId,
    record_version_id: versionId,
    assignee_user_id: assigneeId,
    due_at: '2026-11-02T00:00:00Z',
    ...overrides,
  };
}

function withoutText(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(sourceText);
  expect(JSON.stringify(value)).not.toContain(title);
}

describe('follow-up tasks', () => {
  it('creates a task linked to a record version and preserves identifier case', () => {
    const created = createFollowUp([], [version()], draft({
      follow_up_id: followUpId.toUpperCase(),
      person_id: personId.toUpperCase(),
    }), stated, allowed);
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    expect(created.task).toMatchObject({
      follow_up_id: followUpId.toUpperCase(),
      person_id: personId.toUpperCase(),
      consultation_id: consultationId,
      record_version_id: versionId,
      title,
      status: 'fixture-open',
    });
    expect(created.task).not.toHaveProperty('notification');
    expect(created.task).not.toHaveProperty('welfare');
    expect(created).not.toHaveProperty('candidate');
    expect(JSON.stringify(created)).not.toContain(sourceText);
  });

  it('rejects a bad id, a missing field, and an unknown field', () => {
    expect(() => createFollowUp([], [version()], draft({ follow_up_id: 'task-1' }), stated, allowed)).toThrow(ZodError);
    expect(() => createFollowUp([], [version()], {
      follow_up_id: followUpId,
      person_id: personId,
      status: 'fixture-open',
    }, stated, allowed)).toThrow(ZodError);
    expect(() => createFollowUp([], [version()], { ...draft(), text: sourceText }, stated, allowed)).toThrow(ZodError);
    try {
      createFollowUp([], [version()], draft({ person_id: 'person-1' }), stated, allowed);
    } catch (error) {
      withoutText(error);
    }
  });

  it('rejects a version that is missing, foreign, ambiguous, or for another person', () => {
    const versions = [version()];
    expect(createFollowUp([], versions, draft({ record_version_id: otherVersionId }), stated, allowed)).toEqual({
      outcome: 'rejected',
      reason: 'version_not_found',
    });
    const foreign = createFollowUp([], versions, draft({ consultation_id: otherConsultationId }), stated, allowed);
    expect(foreign).toEqual({ outcome: 'rejected', reason: 'consultation_mismatch' });
    withoutText(foreign);
    const otherPerson = createFollowUp([], versions, draft({ person_id: otherPersonId }), stated, allowed);
    expect(otherPerson).toEqual({ outcome: 'rejected', reason: 'person_mismatch' });
    withoutText(otherPerson);
    const ambiguous = createFollowUp([], [
      version(),
      version({ consultation_id: otherConsultationId, text: '다른 상담의 합성 문장입니다.' }),
    ], draft(), stated, allowed);
    expect(ambiguous).toEqual({ outcome: 'rejected', reason: 'ambiguous_version' });
    withoutText(ambiguous);
    const { record_version_id: _ignored, ...partial } = draft();
    expect(createFollowUp([], versions, partial, stated, allowed)).toEqual({
      outcome: 'rejected',
      reason: 'source_incomplete',
    });
  });

  it('rejects a repeated task id and allows another task from the same source', () => {
    const first = createFollowUp([], [version()], draft(), stated, allowed);
    expect(first.outcome).toBe('created');
    if (first.outcome !== 'created') return;
    const duplicate = createFollowUp(first.tasks, [version()], draft({
      follow_up_id: followUpId.toUpperCase(),
      title: '다른 문장',
    }), stated, allowed);
    expect(duplicate).toEqual({ outcome: 'rejected', reason: 'duplicate_task' });
    expect(first.tasks).toHaveLength(1);
    expect(first.tasks[0]?.title).toBe(title);
    const second = createFollowUp(first.tasks, [version()], draft({ follow_up_id: otherFollowUpId }), stated, allowed);
    expect(second.outcome).toBe('created');
    if (second.outcome !== 'created') return;
    expect(second.tasks.map((task) => task.follow_up_id)).toEqual([followUpId, otherFollowUpId]);
    expect(second.tasks.every((task) => task.record_version_id === versionId)).toBe(true);
  });

  it('changes status only through injected rules', () => {
    const created = createFollowUp([], [version()], draft(), stated, allowed);
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    const unset = transitionFollowUp(created.tasks, followUpId, 'advance', [], allowed);
    expect(unset).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    expect(created.tasks[0]?.status).toBe('fixture-open');
    const moved = transitionFollowUp(created.tasks, followUpId, 'advance', [
      { from: 'fixture-open', action: 'advance', to: 'fixture-done' },
    ], allowed);
    expect(moved.outcome).toBe('transitioned');
    if (moved.outcome !== 'transitioned') return;
    expect(moved.task.status).toBe('fixture-done');
    expect(moved.task.record_version_id).toBe(versionId);
    const illegal = transitionFollowUp(moved.tasks, followUpId, 'advance', [
      { from: 'fixture-open', action: 'advance', to: 'fixture-done' },
    ], allowed);
    expect(illegal).toEqual({ outcome: 'rejected', reason: 'illegal_transition' });
    withoutText(illegal);
  });

  it('does not create a task when an absent field has no policy', () => {
    const versions = [version()];
    const missing = createFollowUp([], versions, {
      follow_up_id: followUpId,
      person_id: personId,
      title,
      status: 'fixture-open',
    }, stated, allowed);
    expect(missing).toEqual({ outcome: 'rejected', reason: 'policy_unset' });
    const chosen: FollowUpCreatePolicy = { source: 'optional', assignee: 'optional', due: 'optional' };
    const manual = createFollowUp([], versions, {
      follow_up_id: followUpId,
      person_id: personId,
      title,
      status: 'fixture-open',
    }, chosen, allowed);
    expect(manual.outcome).toBe('created');
    if (manual.outcome !== 'created') return;
    expect(manual.task).not.toHaveProperty('consultation_id');
    expect(manual.task).not.toHaveProperty('assignee_user_id');
    expect(manual.task).not.toHaveProperty('due_at');
  });

  it('does not share returned task objects with the input or each other', () => {
    const input = Object.freeze(draft());
    const versions = Object.freeze([Object.freeze(version())]);
    const existing = Object.freeze<FollowUpTask[]>([]);
    const created = createFollowUp(existing, versions, input, stated, allowed);
    expect(existing).toHaveLength(0);
    expect(input.title).toBe(title);
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    created.task.title = '반환 업무에서 바꾼 문장';
    expect(created.tasks[0]?.title).toBe(title);
    expect(versions[0].text).toBe(sourceText);
    const listed: { title: string } = created.tasks[0] as FollowUpTask;
    listed.title = '목록에서 바꾼 문장';
    expect(created.task.title).toBe('반환 업무에서 바꾼 문장');
  });

  it('does not treat an unverified decision or a role as permission to change a task', () => {
    const created = createFollowUp([], [version()], draft(), stated, allowed);
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    const hidden = createFollowUp([], [version()], draft({ record_version_id: otherVersionId }), stated, { verified: false });
    expect(hidden).toEqual({ outcome: 'rejected', reason: 'access_not_verified' });
    withoutText(hidden);
    expect(transitionFollowUp(created.tasks, followUpId, 'advance', [
      { from: 'fixture-open', action: 'advance', to: 'fixture-done' },
    ], { verified: true, allowed: false })).toEqual({ outcome: 'rejected', reason: 'access_denied' });
    expect(created.tasks[0]?.status).toBe('fixture-open');
    expect(() => createFollowUp([], [version()], draft(), stated, { role: 'staff' })).toThrow(ZodError);
    expect(() => transitionFollowUp(created.tasks, followUpId, 'advance', [], { role: 'admin' })).toThrow(ZodError);
  });

  it('updates the title without changing the source version', () => {
    const created = createFollowUp([], [version()], draft(), stated, allowed);
    expect(created.outcome).toBe('created');
    if (created.outcome !== 'created') return;
    const revised = reviseFollowUp(created.tasks, followUpId.toUpperCase(), {
      title: '서류 제출 여부만 다시 확인',
    }, allowed);
    expect(revised.outcome).toBe('updated');
    if (revised.outcome !== 'updated') return;
    expect(revised.task.title).toBe('서류 제출 여부만 다시 확인');
    expect(revised.task.record_version_id).toBe(versionId);
    expect(revised.task.consultation_id).toBe(consultationId);
    expect(revised.task.status).toBe('fixture-open');
    expect(created.tasks[0]?.record_version_id).toBe(versionId);
    expect(() => reviseFollowUp(created.tasks, followUpId, {
      title: '바꾸기',
      record_version_id: otherVersionId,
    }, allowed)).toThrow(ZodError);
    expect(reviseFollowUp(created.tasks, followUpId, {}, allowed)).toEqual({
      outcome: 'rejected',
      reason: 'empty_patch',
    });
    expect(created.tasks[0]?.title).toBe(title);
  });
});
