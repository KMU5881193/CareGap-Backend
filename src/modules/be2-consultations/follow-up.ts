import { z } from 'zod';
import { Id, type RecordVersion } from '../../shared/contracts.js';
import { UtcInstant } from './availability.js';
import { readRecordVersion } from './consultation-record.js';

const FieldPolicy = z.enum(['unset', 'optional', 'required']);

export const FollowUpCreatePolicy = z.object({
  source: FieldPolicy,
  assignee: FieldPolicy,
  due: FieldPolicy,
}).strict();

export type FollowUpCreatePolicy = z.infer<typeof FollowUpCreatePolicy>;

export const FollowUpCreateInput = z.object({
  follow_up_id: Id,
  person_id: Id,
  title: z.string(),
  status: z.string().min(1),
  consultation_id: Id.optional(),
  record_version_id: Id.optional(),
  assignee_user_id: Id.optional(),
  due_at: UtcInstant.optional(),
  created_at: UtcInstant.optional(),
  updated_at: UtcInstant.optional(),
}).strict();

export type FollowUpCreateInput = z.infer<typeof FollowUpCreateInput>;

export const FollowUpPatch = z.object({
  title: z.string().optional(),
  assignee_user_id: Id.optional(),
  due_at: UtcInstant.optional(),
  updated_at: UtcInstant.optional(),
}).strict();

export const FollowUpTransitionRule = z.object({
  from: z.string().min(1),
  action: z.string().min(1),
  to: z.string().min(1),
}).strict();

export type FollowUpTransitionRule = z.infer<typeof FollowUpTransitionRule>;

export type FollowUpTask = {
  follow_up_id: string;
  person_id: string;
  title: string;
  status: string;
  consultation_id?: string;
  record_version_id?: string;
  assignee_user_id?: string;
  due_at?: string;
  created_at?: string;
  updated_at?: string;
};

const AccessDecision = z.union([
  z.object({ verified: z.literal(false) }).strict(),
  z.object({ verified: z.literal(true), allowed: z.boolean() }).strict(),
]);

export type FollowUpRejectReason =
  | 'access_not_verified'
  | 'access_denied'
  | 'duplicate_task'
  | 'task_not_found'
  | 'version_not_found'
  | 'consultation_mismatch'
  | 'ambiguous_version'
  | 'person_mismatch'
  | 'source_incomplete'
  | 'source_required'
  | 'assignee_required'
  | 'due_required'
  | 'policy_unset'
  | 'empty_patch'
  | 'illegal_transition';

export type FollowUpWrite =
  | { outcome: 'created' | 'updated' | 'transitioned'; task: FollowUpTask; tasks: FollowUpTask[] }
  | { outcome: 'rejected'; reason: FollowUpRejectReason };

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function copyTask(task: FollowUpTask): FollowUpTask {
  return {
    follow_up_id: task.follow_up_id,
    person_id: task.person_id,
    title: task.title,
    status: task.status,
    ...(task.consultation_id !== undefined ? { consultation_id: task.consultation_id } : {}),
    ...(task.record_version_id !== undefined ? { record_version_id: task.record_version_id } : {}),
    ...(task.assignee_user_id !== undefined ? { assignee_user_id: task.assignee_user_id } : {}),
    ...(task.due_at !== undefined ? { due_at: task.due_at } : {}),
    ...(task.created_at !== undefined ? { created_at: task.created_at } : {}),
    ...(task.updated_at !== undefined ? { updated_at: task.updated_at } : {}),
  };
}

function reject(reason: FollowUpRejectReason): FollowUpWrite {
  return { outcome: 'rejected', reason };
}

function accessFailure(access: unknown): 'access_not_verified' | 'access_denied' | null {
  const decision = AccessDecision.parse(access);
  if (!decision.verified) return 'access_not_verified';
  if (!decision.allowed) return 'access_denied';
  return null;
}

function storedTasks(tasks: readonly FollowUpTask[]): FollowUpTask[] {
  return tasks.map((task) => copyTask(task));
}

function taskFromInput(input: FollowUpCreateInput): FollowUpTask {
  return copyTask({
    follow_up_id: input.follow_up_id,
    person_id: input.person_id,
    title: input.title,
    status: input.status,
    consultation_id: input.consultation_id,
    record_version_id: input.record_version_id,
    assignee_user_id: input.assignee_user_id,
    due_at: input.due_at,
    created_at: input.created_at,
    updated_at: input.updated_at,
  });
}

function fieldGap(policy: FollowUpCreatePolicy, input: FollowUpCreateInput): FollowUpRejectReason | null {
  const sourceAbsent = input.consultation_id === undefined && input.record_version_id === undefined;
  if (sourceAbsent && policy.source === 'unset') return 'policy_unset';
  if (sourceAbsent && policy.source === 'required') return 'source_required';
  if (input.assignee_user_id === undefined && policy.assignee === 'unset') return 'policy_unset';
  if (input.assignee_user_id === undefined && policy.assignee === 'required') return 'assignee_required';
  if (input.due_at === undefined && policy.due === 'unset') return 'policy_unset';
  if (input.due_at === undefined && policy.due === 'required') return 'due_required';
  return null;
}

// Creating a task does not read analysis events and does not send a notification.
// verified:true is a caller-supplied flag, not proof that AuthorizationPort ran.
export function createFollowUp(
  tasks: readonly FollowUpTask[],
  versions: readonly RecordVersion[],
  input: unknown,
  policy: unknown,
  access: unknown,
): FollowUpWrite {
  const draft = FollowUpCreateInput.parse(input);
  const rules = FollowUpCreatePolicy.parse(policy);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const existing = storedTasks(tasks);
  if (existing.some((task) => sameUuid(task.follow_up_id, draft.follow_up_id))) return reject('duplicate_task');
  const hasConsultation = draft.consultation_id !== undefined;
  const hasVersion = draft.record_version_id !== undefined;
  if (hasConsultation !== hasVersion) return reject('source_incomplete');
  if (hasConsultation && hasVersion && draft.consultation_id !== undefined && draft.record_version_id !== undefined) {
    const version = readRecordVersion(versions, draft.consultation_id, draft.record_version_id);
    if (!version.found) {
      return reject(version.reason === 'not_found' ? 'version_not_found' : version.reason);
    }
    if (!sameUuid(version.version.person_id, draft.person_id)) return reject('person_mismatch');
  }
  const gap = fieldGap(rules, draft);
  if (gap) return reject(gap);
  const task = taskFromInput(draft);
  return { outcome: 'created', task: copyTask(task), tasks: [...existing, copyTask(task)] };
}

export function reviseFollowUp(
  tasks: readonly FollowUpTask[],
  followUpId: string,
  patch: unknown,
  access: unknown,
): FollowUpWrite {
  const requestedId = Id.parse(followUpId);
  const change = FollowUpPatch.parse(patch);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const existing = storedTasks(tasks);
  const index = existing.findIndex((task) => sameUuid(task.follow_up_id, requestedId));
  if (index < 0) return reject('task_not_found');
  const current = existing[index];
  if (current === undefined) return reject('task_not_found');
  const next = copyTask(current);
  let changed = false;
  if (change.title !== undefined) {
    next.title = change.title;
    changed = true;
  }
  if (change.assignee_user_id !== undefined) {
    next.assignee_user_id = change.assignee_user_id;
    changed = true;
  }
  if (change.due_at !== undefined) {
    next.due_at = change.due_at;
    changed = true;
  }
  if (change.updated_at !== undefined) {
    next.updated_at = change.updated_at;
    changed = true;
  }
  if (!changed) return reject('empty_patch');
  const updated = copyTask(next);
  return {
    outcome: 'updated',
    task: copyTask(updated),
    tasks: existing.map((task, taskIndex) => taskIndex === index ? copyTask(updated) : task),
  };
}

// Status names and who may change them are not fixed here. An empty rule list is not approval.
export function transitionFollowUp(
  tasks: readonly FollowUpTask[],
  followUpId: string,
  action: unknown,
  rules: unknown,
  access: unknown,
): FollowUpWrite {
  const requestedId = Id.parse(followUpId);
  const requestedAction = z.string().min(1).parse(action);
  const transitionRules = z.array(FollowUpTransitionRule).parse(rules);
  const failure = accessFailure(access);
  if (failure) return reject(failure);
  const existing = storedTasks(tasks);
  const index = existing.findIndex((task) => sameUuid(task.follow_up_id, requestedId));
  if (index < 0) return reject('task_not_found');
  const current = existing[index];
  if (current === undefined) return reject('task_not_found');
  if (transitionRules.length === 0) return reject('policy_unset');
  const matched = transitionRules.filter((rule) => rule.from === current.status && rule.action === requestedAction);
  if (matched.length === 0) return reject('illegal_transition');
  const nextStatus = matched[0]?.to;
  if (nextStatus === undefined || matched.some((rule) => rule.to !== nextStatus)) return reject('illegal_transition');
  const updated = copyTask({ ...current, status: nextStatus });
  return {
    outcome: 'transitioned',
    task: copyTask(updated),
    tasks: existing.map((task, taskIndex) => taskIndex === index ? copyTask(updated) : task),
  };
}
