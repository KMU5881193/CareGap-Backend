import { z } from 'zod';
export const Id=z.uuid();
export const Actor=z.object({user_id:Id, role:z.enum(['patient','family','staff','admin'])});
export type Actor=z.infer<typeof Actor>;
// BE1 must supply current relationship checks; role alone never grants record access.
export interface AuthorizationPort { canAccess(actor:Actor, personId:string, action:'read'|'write'|'analyze'):Promise<boolean> }
export interface RecordVersion { consultation_id:string; record_version_id:string; person_id:string; text:string }
export interface RecordReader { getVersion(consultationId:string, versionId:string):Promise<RecordVersion | null> }
