import type {Express,Response} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {RecordVersion} from './shared/contracts.js';
import {createFollowUp,transitionFollowUp,type FollowUpTask} from './modules/be2-consultations/follow-up.js';
import {acceptNotification,markNotificationRead,type Notification} from './modules/be2-consultations/notification.js';
import {applyTransition} from './modules/be2-consultations/appointment-transition.js';
export function mountFinalBe2(app:Express,records:Map<string,RecordVersion>,appointments:Map<string,any>,access:(res:Response,id:string)=>void){
 const fail=(code:string,status=409):never=>{throw Object.assign(new Error(code),{code,status});};
 let tasks:FollowUpTask[]=[];let notices:Notification[]=[];
 const verified={verified:true,allowed:true};
 app.post('/api/appointments/:id/actions',(req,res)=>{
  const b=z.object({action:z.enum(['complete','cancel']),expected_status:z.string()}).strict().parse(req.body);
  const row=appointments.get(req.params.id as string);if(!row) return fail('NOT_FOUND',404);access(res,row.person_id);
  if(row.status!==b.expected_status)fail('CONFLICT');
  const result=applyTransition(row,b.action,res.locals.actor.role,[{from:'scheduled',action:'complete',to:'completed',actors:['staff']},{from:'scheduled',action:'cancel',to:'cancelled',actors:['staff']}]);
  if(!result.ok)return fail('ILLEGAL_TRANSITION');row.status=result.status;res.json({data:row});
 });
 app.post('/api/records/:id/versions',(req,res)=>{
  const b=z.object({expected_record_version_id:z.uuid(),text:z.string().min(1).max(100000)}).strict().parse(req.body);
  const history=[...records.values()].filter(r=>r.consultation_id===req.params.id);const last=history.at(-1);if(!last)return fail('NOT_FOUND',404);access(res,last.person_id);
  if(last.record_version_id!==b.expected_record_version_id)fail('CONFLICT');
  const data={...last,record_version_id:randomUUID(),text:b.text};records.set(data.record_version_id,data);res.status(201).json({data});
 });
 app.post('/api/follow-ups',(req,res)=>{
  const b=z.object({person_id:z.uuid(),title:z.string().min(1).max(500),consultation_id:z.uuid().optional(),record_version_id:z.uuid().optional()}).strict().parse(req.body);access(res,b.person_id);
  const result=createFollowUp(tasks,[...records.values()],{...b,follow_up_id:randomUUID(),status:'open',assignee_user_id:res.locals.actor.user_id},{source:'optional',assignee:'required',due:'optional'},verified);
  if(result.outcome==='rejected')return fail(result.reason);tasks=result.tasks;res.status(201).json({data:result.task});
 });
 app.get('/api/follow-ups',(req,res)=>{const id=z.uuid().parse(req.query.person_id);access(res,id);res.json({data:tasks.filter(t=>t.person_id===id)});});
 app.post('/api/follow-ups/:id/actions',(req,res)=>{
  const b=z.object({action:z.enum(['complete','cancel']),expected_status:z.string()}).strict().parse(req.body);const task=tasks.find(t=>t.follow_up_id===req.params.id);if(!task)return fail('NOT_FOUND',404);access(res,task.person_id);if(task.status!==b.expected_status)fail('CONFLICT');
  const result=transitionFollowUp(tasks,task.follow_up_id,b.action,[{from:'open',action:'complete',to:'completed'},{from:'open',action:'cancel',to:'cancelled'}],verified);if(result.outcome==='rejected')return fail(result.reason);tasks=result.tasks;res.json({data:result.task});
 });
 app.post('/api/notifications',(req,res)=>{
  const b=z.object({title:z.string().min(1).max(500),body:z.string().max(2000)}).strict().parse(req.body);
  const result=acceptNotification(notices,{...b,notification_id:randomUUID(),recipient_user_id:res.locals.actor.user_id,kind:'manual'},{event:'optional',subject:'optional',event_repeat:'reject'},verified);
  if(result.outcome!=='accepted')return fail('CONFLICT');notices=result.notifications;res.status(201).json({data:result.notification});
 });
 app.get('/api/notifications',(_req,res)=>res.json({data:notices.filter(n=>n.recipient_user_id===res.locals.actor.user_id)}));
 app.post('/api/notifications/:id/read',(req,res)=>{const result=markNotificationRead(notices,req.params.id as string,new Date().toISOString(),res.locals.actor.user_id,verified);if(result.outcome==='rejected')return fail('NOT_FOUND',404);notices=result.notifications;res.json({data:result.notification});});
}
