export const healthTypes=Object.freeze({farriery:'Ferrure / parage',deworming:'Vermifuge',vaccine:'Vaccination',dental:'Dentiste',osteopathy:'Ostéopathe'});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function reminderOffsets(env){const offsets=String(env.HORSE_REMINDER_OFFSETS??'7,0').split(',').map(Number);if(!offsets.length||offsets.length>4||offsets.some(n=>!Number.isInteger(n)||n<0||n>365)||new Set(offsets).size!==offsets.length)throw fail('Configuration des rappels invalide',503);return offsets;}
export const healthDueSql=`(SELECT json_group_array(json_object('id',id,'type',type,'label',label,'performedOn',performed_on,'nextDueOn',next_due_on)) FROM
 (SELECT id,type,label,performed_on,next_due_on FROM horse_health_records WHERE horse_id=h.id AND is_current=1 AND deleted_at IS NULL AND next_due_on IS NOT NULL ORDER BY next_due_on,id LIMIT 30))`;
export function prepareHorseNotifications(env,horseId,day=today()){
 return env.DB.prepare(`INSERT OR IGNORE INTO horse_notifications(horse_id,record_id,record_version,user_id,owner_since,offset_days,scheduled_for)
 SELECT r.horse_id,r.id,r.version,o.user_id,o.created_at,j.value,
 CASE WHEN j.value=0 AND r.next_due_on<? THEN ? ELSE date(r.next_due_on,printf('-%d days',j.value)) END
 FROM horse_health_records r JOIN planning_horses h ON h.id=r.horse_id JOIN horse_owners o ON o.horse_id=h.id CROSS JOIN json_each(?) j
 WHERE h.id IN (SELECT value FROM json_each(?)) AND h.status='active' AND r.is_current=1 AND r.deleted_at IS NULL AND r.next_due_on IS NOT NULL
 AND (j.value=0 OR date(r.next_due_on,printf('-%d days',j.value))>=?)`)
 .bind(day,day,JSON.stringify(reminderOffsets(env)),JSON.stringify(Array.isArray(horseId)?horseId:[horseId]),day);
}
function date(value,optional=false){if(optional&&(value===null||value===''))return null;if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw fail('Date invalide');return value;}
export function validateHealth(input){
 if(!input||!Object.hasOwn(healthTypes,input.type))throw fail('Type d’intervention invalide');
 const label=String(input.label||healthTypes[input.type]).trim(),comment=String(input.comment||'').trim();
 if(!label||label.length>100||comment.length>1500)throw fail('Libellé ou commentaire trop long');
 const performedOn=date(input.performedOn),nextDueOn=date(input.nextDueOn,true);
 if(performedOn>today())throw fail('La date réalisée ne peut pas être future');
 if(nextDueOn&&nextDueOn<performedOn)throw fail('L’échéance doit suivre la date réalisée');
 return {type:input.type,label,seriesKey:label.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr').replace(/\s+/g,' '),performedOn,nextDueOn,comment};
}
const mailStatuses={pending:'Prévu',sending:'Envoi en cours / à vérifier',sent:'Envoyé',cancelled:'Annulé',failed:'Échec temporaire',uncertain:'À vérifier'};
const publicRecord=r=>({id:r.id,type:r.type,label:r.label,performedOn:r.performed_on,nextDueOn:r.next_due_on,comment:r.comment,isCurrent:Boolean(r.is_current),version:r.version});
async function createGroupHealth(request,env,{json,cors,readJson,isAdmin}){
 if(!isAdmin(request,env))throw fail('Non autorisé',401);
 if(request.method!=='POST')throw fail('Méthode non autorisée',405);
 const raw=await readJson(request),ids=raw?.horseIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>50||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)throw fail('Sélectionnez entre 1 et 50 chevaux distincts.');
 if(typeof raw.requestId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.requestId))throw fail('Identifiant d’enregistrement invalide');
 const input=validateHealth(raw),horseIds=[...ids].sort((a,b)=>a-b),idsJson=JSON.stringify(horseIds);
 const found=await env.DB.prepare('SELECT id FROM planning_horses WHERE id IN (SELECT value FROM json_each(?))').bind(idsJson).all();
 if(found.results.length!==horseIds.length)throw fail('Un cheval sélectionné n’existe plus. Rechargez la liste.',409);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({horseIds,...input})));
 const key='group:'+raw.requestId+':'+Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),now=new Date().toISOString();
 const result=await env.DB.batch([
  env.DB.prepare(`UPDATE horse_health_records AS r SET is_current=0,updated_at=?
   WHERE horse_id IN (SELECT value FROM json_each(?)) AND type=? AND series_key=? AND is_current=1 AND deleted_at IS NULL AND performed_on<=?
   AND NOT EXISTS(SELECT 1 FROM horse_health_records done WHERE done.creation_key=?||':'||r.horse_id)`)
   .bind(now,idsJson,input.type,input.seriesKey,input.performedOn,key),
  env.DB.prepare(`INSERT INTO horse_health_records(horse_id,type,label,series_key,performed_on,next_due_on,comment,is_current,creation_key,created_at,updated_at)
   SELECT j.value,?,?,?,?,?,?,NOT EXISTS(SELECT 1 FROM horse_health_records r WHERE r.horse_id=j.value AND r.type=? AND r.series_key=? AND r.is_current=1 AND r.deleted_at IS NULL),?||':'||j.value,?,?
   FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM horse_health_records done WHERE done.creation_key=?||':'||j.value)`)
   .bind(input.type,input.label,input.seriesKey,input.performedOn,input.nextDueOn,input.comment,input.type,input.seriesKey,key,now,now,idsJson,key),
  prepareHorseNotifications(env,horseIds),
  env.DB.prepare("SELECT id,horse_id FROM horse_health_records WHERE creation_key IN (SELECT ?||':'||value FROM json_each(?)) ORDER BY horse_id").bind(key,idsJson)
 ]);
 return json({count:result[3].results.length,records:result[3].results.map(r=>({id:r.id,horseId:r.horse_id}))},201,cors);
}

export async function handleHorseHealth(request,env,{json,cors,readJson,isAdmin,authenticatedUser}){
 const url=new URL(request.url),match=url.pathname.match(/^\/api\/(admin|me)\/horses\/(\d+)\/health(?:\/(\d+))?$/);const group=url.pathname==='/api/admin/horses/health-batch';if(!match&&!group)return null;
 try{
  if(group)return await createGroupHealth(request,env,{json,cors,readJson,isAdmin});
  const admin=match[1]==='admin',horseId=Number(match[2]),recordId=match[3]?Number(match[3]):null;
  let viewer;if(admin){if(!isAdmin(request,env))throw fail('Non autorisé',401);}else{viewer=await authenticatedUser(request,env);if(!viewer)throw fail('Non autorisé',401);}
  const horse=await env.DB.prepare(`SELECT h.id,h.status FROM planning_horses h WHERE h.id=?${admin?'':' AND EXISTS(SELECT 1 FROM horse_owners o WHERE o.horse_id=h.id AND o.user_id=?)'}`).bind(horseId,...(admin?[]:[viewer.id])).first();
  if(!horse)throw fail('Cheval introuvable',404);
  if(request.method==='GET'&&!recordId){
   const cursor=Number(url.searchParams.get('cursor')||Number.MAX_SAFE_INTEGER);if(!Number.isSafeInteger(cursor)||cursor<1)throw fail('Curseur invalide');
   const result=await env.DB.prepare(`SELECT r.*${admin?`,(SELECT json_group_array(json_object('status',status,'count',total)) FROM (SELECT status,COUNT(*) total FROM horse_notifications WHERE record_id=r.id GROUP BY status)) AS notifications_json`:''} FROM horse_health_records r WHERE horse_id=? AND deleted_at IS NULL AND id<? ORDER BY id DESC LIMIT 51`).bind(horseId,cursor).all();
   return json({records:result.results.slice(0,50).map(r=>({...publicRecord(r),...(admin?{notificationStatus:JSON.parse(r.notifications_json||'[]').map(n=>`${mailStatuses[n.status]} (${n.count})`).join(' · ')}:{})})),nextCursor:result.results.length>50?result.results[49].id:null,types:healthTypes},200,cors);
  }
  const raw=await readJson(request),now=new Date().toISOString();
  let old;if(recordId){old=await env.DB.prepare('SELECT * FROM horse_health_records WHERE id=? AND horse_id=? AND deleted_at IS NULL').bind(recordId,horseId).first();if(!old)throw fail('Intervention introuvable',404);if(raw?.version!==old.version)throw fail('Intervention modifiée ailleurs. Rechargez.',409);}
  if(request.method==='DELETE'&&old){
   const result=await env.DB.prepare(`UPDATE horse_health_records SET deleted_at=?,is_current=0,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id`).bind(now,now,recordId,old.version).all();
   if(!result.results.length)throw fail('Intervention modifiée ailleurs',409);return json({deleted:true},200,cors);
  }
  if(!['POST','PATCH'].includes(request.method)||Boolean(recordId)!==(request.method==='PATCH'))throw fail('Méthode non autorisée',405);
  const input=validateHealth(raw),statements=[];
  if(old){
   if(input.type!==old.type||input.seriesKey!==old.series_key)throw fail('Pour changer de suivi, ajoutez une nouvelle intervention');
   statements.push(env.DB.prepare(`UPDATE horse_health_records SET label=?,performed_on=?,next_due_on=?,comment=?,updated_at=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=? RETURNING *`).bind(input.label,input.performedOn,input.nextDueOn,input.comment,now,old.version,recordId));
  }else{
   statements.push(env.DB.prepare(`UPDATE horse_health_records SET is_current=0,updated_at=? WHERE horse_id=? AND type=? AND series_key=? AND is_current=1 AND deleted_at IS NULL AND performed_on<=?`).bind(now,horseId,input.type,input.seriesKey,input.performedOn));
   statements.push(env.DB.prepare(`INSERT INTO horse_health_records(horse_id,type,label,series_key,performed_on,next_due_on,comment,is_current,creation_key,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,NOT EXISTS(SELECT 1 FROM horse_health_records WHERE horse_id=? AND type=? AND series_key=? AND is_current=1 AND deleted_at IS NULL),?,?,?) RETURNING *`)
    .bind(horseId,input.type,input.label,input.seriesKey,input.performedOn,input.nextDueOn,input.comment,horseId,input.type,input.seriesKey,crypto.randomUUID(),now,now));
  }
  statements.push(prepareHorseNotifications(env,horseId));const result=await env.DB.batch(statements),record=result[old?0:1].results[0];
  if(!record)throw fail('Intervention modifiée ailleurs',409);
  return json({record:publicRecord(record)},old?200:201,cors);
 }catch(error){if(error.status)return json({error:error.message},error.status,cors);if(/HEALTH_SEND_IN_PROGRESS/.test(error.message))return json({error:'Un rappel est en cours d’envoi. Réessayez dans quelques instants.'},409,cors);if(/UNIQUE|NOT NULL/.test(error.message))return json({error:'Le suivi a changé. Rechargez la fiche.'},409,cors);console.error('horse-health',String(error.message));return json({error:'Impossible de charger ou enregistrer le suivi sanitaire'},500,cors);}
}
// Fresh data is resolved at send time, never captured in a pending notification.
const validNotification=`SELECT n.*,h.name AS horse_name,r.label,r.next_due_on,u.email,u.first_name
 FROM horse_notifications n JOIN horse_health_records r ON r.id=n.record_id JOIN planning_horses h ON h.id=n.horse_id
 JOIN horse_owners o ON o.horse_id=h.id AND o.user_id=n.user_id AND o.created_at=n.owner_since JOIN users u ON u.id=o.user_id
 WHERE r.version=n.record_version AND r.deleted_at IS NULL AND r.is_current=1 AND h.status='active' AND u.status='active'`;
export async function resolveHealthMail(env,id,token){
 if(!Number.isSafeInteger(id)||id<1||typeof token!=='string'||!/^[a-f0-9-]{36}$/.test(token))return null;
 return env.DB.prepare(validNotification+` AND n.id=? AND n.claim_token=? AND n.status='sending' AND n.claimed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes')`).bind(id,token).first();
}
export async function processHorseReminders(env,now=new Date(),send=sendHealthMail){
 if(env.HORSE_HEALTH_MAIL_ENABLED!=='true')return {disabled:true};
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const limit=Number(env.HORSE_REMINDER_BATCH_SIZE||50);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('Lot de rappels invalide');
 const result=await env.DB.prepare(validNotification+` AND n.status IN ('pending','failed') AND n.scheduled_for<=? AND n.attempt_count<3 ORDER BY n.scheduled_for,n.id LIMIT ?`).bind(day,limit).all();
 let sent=0,failed=0,uncertain=0;
 for(const n of result.results){
  if(n.offset_days>0&&n.next_due_on<=day){await env.DB.prepare("UPDATE horse_notifications SET status='cancelled' WHERE id=? AND status IN ('pending','failed')").bind(n.id).run();continue;}
  const token=crypto.randomUUID(),claimedAt=new Date().toISOString();
  const claim=await env.DB.prepare(`UPDATE horse_notifications SET status='sending',claimed_at=?,claim_token=?,attempt_count=attempt_count+1,last_error=NULL
   WHERE id=? AND status IN ('pending','failed') AND EXISTS(SELECT 1 FROM (${validNotification}) valid WHERE valid.id=horse_notifications.id) RETURNING id`).bind(claimedAt,token,n.id).all();
  if(!claim.results.length)continue;
  let outcome;try{outcome=await send(env,{id:n.id,token});}catch{outcome={uncertain:true,error:'Réponse du service mail incertaine'};}
  const status=outcome.sent||outcome.duplicate?'sent':outcome.definitelyNotSent?'failed':'uncertain';
  await env.DB.prepare(`UPDATE horse_notifications SET status=?,sent_at=?,last_error=? WHERE id=? AND status='sending' AND claim_token=?`)
   .bind(status,status==='sent'?new Date().toISOString():null,status==='sent'?null:String(outcome.error||'Envoi à vérifier').slice(0,300),n.id,token).run();
  if(status==='sent')sent++;else if(status==='failed')failed++;else uncertain++;
 }
 return {selected:result.results.length,sent,failed,uncertain};
}
async function sendHealthMail(env,{id,token}){
 if(!env.MAILER_ENDPOINT)return {definitelyNotSent:true,error:'Service mail non configuré'};
 const response=await fetch(env.MAILER_ENDPOINT,{method:'POST',headers:{'content-type':'text/plain;charset=UTF-8'},body:JSON.stringify({type:'horse_health_reminder',notificationId:id,token}),signal:AbortSignal.timeout(25000)});
 const data=await response.json();return {sent:data.ok&&data.sent,duplicate:data.ok&&data.duplicate,definitelyNotSent:data.definitelyNotSent===true,error:data.error};
}
