import {healthDueSql,prepareHorseNotifications} from './horse-health.js';
import { AwsClient } from 'aws4fetch';

const statuses = new Set(['active', 'departed', 'archived']);
const activityLabels = Object.freeze({travail:'Travail',longe:'Longe',repos:'Repos',concours:'Concours',cours:'Cours',proprietaire:'Propriétaire',autre:'Autre'});
const clientActivityTypes = new Set(Object.keys(activityLabels).filter(type=>type!=='proprietaire'&&type!=='cours'));
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const placeholders = ids => ids.map(() => '?').join(',');
export function validateHorse(input) {
  if (!input || typeof input !== 'object') throw fail('Fiche invalide');
  const name = String(input.name || '').trim();
  const status = input.status || 'active';
  const birthDate = input.birthDate || null;
  if (!name || name.length > 80 || !statuses.has(status)) throw fail('Nom ou statut invalide');
  if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(Date.parse(birthDate)) || new Date(birthDate).toISOString().slice(0,10) !== birthDate)) throw fail('Date de naissance invalide');
  const publicNotes = String(input.publicNotes || '').trim(), adminNotes = String(input.adminNotes || '').trim();
  if (publicNotes.length > 1000 || adminNotes.length > 4000) throw fail('Remarques trop longues');
  if (!Array.isArray(input.ownerIds) || input.ownerIds.length > 50 || input.ownerIds.some(id => !Number.isSafeInteger(id) || id < 1)) throw fail('Propriétaires invalides');
  return { name, status, birthDate, publicNotes, adminNotes, ownerIds: [...new Set(input.ownerIds)] };
}

export function photoConfig(env) {
  const ttl = Number(env.HORSE_PHOTO_TTL_SECONDS ?? 600);
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 3600) throw fail('Durée photo invalide (60 à 3600 secondes)', 503);
  const ready = Boolean(env.R2_ACCOUNT_ID && env.R2_HORSE_ACCESS_KEY_ID && env.R2_HORSE_SECRET_ACCESS_KEY && env.HORSE_PHOTO_BUCKET);
  return { ttl, ready };
}
export async function signedHorsePhoto(env, key, now = new Date()) {
  if (!key) return null;
  const { ttl, ready } = photoConfig(env);
  if (!ready) return null;
  if (!/^horses\/\d+\/[a-zA-Z0-9-]+\.(jpg|png|webp)$/.test(key)) throw fail('Référence photo invalide', 500);
  const client = new AwsClient({ accessKeyId: env.R2_HORSE_ACCESS_KEY_ID, secretAccessKey: env.R2_HORSE_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const url = new URL(`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.HORSE_PHOTO_BUCKET}/${key}`);
  url.searchParams.set('X-Amz-Expires', String(ttl));
  url.searchParams.set('X-Amz-Date', now.toISOString().replace(/[:-]|\.\d{3}/g, ''));
  url.searchParams.set('response-cache-control', `private, max-age=${ttl}, must-revalidate`);
  const signed = await client.sign(url, { method: 'GET', aws: { signQuery: true } });
  return { url: signed.url, expiresAt: new Date(now.getTime() + ttl * 1000).toISOString() };
}
async function publicHorse(env, row, admin = false) {
  const horse = { id: Number(row.id), name: row.name, status: row.status, birthDate: row.birth_date,
    publicNotes: row.public_notes,healthDue:JSON.parse(row.health_due_json||'[]'), photo: await signedHorsePhoto(env, row.photo_key), ...(!admin?{photoVersion:row.version}:{}) };
  if (admin) Object.assign(horse, { adminNotes: row.admin_notes, version: row.version, updatedAt: row.updated_at });
  return horse;
}
async function ownersFor(env, id) {
  return (await env.DB.prepare(`SELECT u.id,u.first_name AS firstName,u.last_name AS lastName,u.email,u.status
    FROM horse_owners o JOIN users u ON u.id=o.user_id WHERE o.horse_id=? ORDER BY u.last_name,u.first_name,u.id`).bind(id).all()).results;
}
async function validOwners(env, ids) {
  if (!ids.length) return;
  const result = await env.DB.prepare(`SELECT id FROM users WHERE role='client' AND id IN (${placeholders(ids)})`).bind(...ids).all();
  if (result.results.length !== ids.length) throw fail('Tous les propriétaires doivent être des comptes clients existants');
}

function validWeek(value) {
  const week=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week))return '';
  const date=new Date(week+'T12:00:00Z');
  return !Number.isNaN(date.getTime())&&date.getUTCDay()===1?week:'';
}
function dateParts(value) {
  const date=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw fail('Date invalide');
  const parsed=new Date(date+'T12:00:00Z');
  if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw fail('Date invalide');
  const dayIndex=(parsed.getUTCDay()+6)%7;
  parsed.setUTCDate(parsed.getUTCDate()-dayIndex);
  return {date,weekStart:parsed.toISOString().slice(0,10),dayIndex};
}
function dateFor(week,dayIndex){const date=new Date(week+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+Number(dayIndex));return date.toISOString().slice(0,10);}
function validClock(value,label){
  const clock=String(value||'').trim()||null;
  if(clock&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock))throw fail(`${label} invalide`);
  return clock;
}
function validateClientActivity(input,current={}){
  const value=key=>input&&Object.prototype.hasOwnProperty.call(input,key)?input[key]:current[key];
  const {date,weekStart,dayIndex}=dateParts(value('date'));
  const type=String(value('type')??'');
  const description=String(value('description')??'').trim();
  const startsAt=validClock(value('startsAt'),'Heure de début');
  const endsAt=validClock(value('endsAt'),'Heure de fin');
  if(!clientActivityTypes.has(type))throw fail('Type d’activité invalide');
  if(type==='autre'&&!description)throw fail('Le commentaire est obligatoire pour cette activité');
  if(description.length>300)throw fail('Commentaire trop long');
  if(endsAt&&!startsAt)throw fail('Ajoutez une heure de début avant l’heure de fin');
  if(startsAt&&endsAt&&endsAt<=startsAt)throw fail('L’heure de fin doit suivre l’heure de début');
  return {date,weekStart,dayIndex,type,description,startsAt,endsAt};
}
export function planningEvent(row,viewerId){
  const source=row.source||'backstage';
  return {id:`task:${row.id}`,sourceId:Number(row.id),horseId:Number(row.horse_id),date:dateFor(row.week_start,row.day_index),
    startsAt:row.starts_at||null,endsAt:row.ends_at||null,type:row.type,label:activityLabels[row.type]||row.type,
    description:row.description||'',source,canEdit:source==='client'&&Number(row.created_by_user_id)===Number(viewerId)};
}
async function horseEvents(env,horseId,viewerId,week){
  const rows=await env.DB.prepare(`SELECT * FROM (
    SELECT id,horse_id,week_start,day_index,type,description,starts_at,ends_at,source,created_by_user_id,
      date(week_start,printf('+%d days',day_index)) AS event_date,position
    FROM planning_tasks WHERE horse_id=? AND week_start=?
      AND (source='client' OR type IN ('cours','concours') OR (type='paddock' AND request_id IS NOT NULL) OR pwa_visible=1)
    UNION ALL
    SELECT r.id,bh.horse_id,?,CAST(julianday(r.date)-julianday(?) AS INTEGER),'paddock',
      CASE r.paddock WHEN 'maison' THEN 'Maison' WHEN 'grande' THEN 'Grande voie' ELSE 'Beudot' END,
      r.time,substr(time(r.time,printf('+%d minutes',r.duration)),1,5),'paddock_booking',NULL,r.date,0
    FROM paddock_booking_horses bh JOIN paddock_reservations r ON r.id=bh.booking_id
    WHERE bh.horse_id=? AND r.date>=? AND r.date<=date(?,'+6 days')
  ) ORDER BY event_date,COALESCE(starts_at,'99:99'),position,source,id`).bind(horseId,week,week,week,horseId,week,week).all();
  return rows.results.map(row=>row.source==='paddock_booking'?{
    id:`paddock:${row.id}`,sourceId:Number(row.id),horseId:Number(row.horse_id),date:row.event_date,
    startsAt:row.starts_at,endsAt:row.ends_at,type:'paddock',label:'Paddock · '+row.description,
    description:'',source:'paddock_booking',canEdit:false
  }:planningEvent(row,viewerId));
}

export async function handleHorses(request, env, { json, cors, readJson, isAdmin, authenticatedUser }) {
  const url = new URL(request.url);
  const admin = url.pathname.startsWith('/api/admin/horses');
  const base = admin ? '/api/admin/horses' : '/api/me/horses';
  if (url.pathname !== base && !url.pathname.startsWith(base + '/')) return null;
  try {
    let viewer;
    if (admin) { if (!isAdmin(request, env)) throw fail('Non autorisé', 401); }
    else { viewer = await authenticatedUser(request, env); if (!viewer) throw fail('Non autorisé', 401); }
    const method = request.method;
    if (!admin && method !== 'GET' && !url.pathname.includes('/planning/tasks') && !(/^\/api\/me\/horses\/\d+\/photo$/.test(url.pathname)&&method==='PUT')) throw fail('Lecture uniquement', 403);
    if (admin && url.pathname === base + '/owner-options' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().slice(0,80);
      const rows = await env.DB.prepare(`SELECT id,first_name AS firstName,last_name AS lastName,email,status FROM users
        WHERE role='client' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ?) ORDER BY last_name,first_name,id LIMIT 30`)
        .bind(`${q}%`,`${q}%`,`${q}%`).all();
      return json({ users: rows.results }, 200, cors);
    }
    if (url.pathname === base && method === 'GET') {
      const cursor = Number(url.searchParams.get('cursor') || 0);
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw fail('Curseur invalide');
      const state = url.searchParams.get('status') || 'all';
      if (state !== 'all' && !statuses.has(state)) throw fail('Statut invalide');
      const where = admin ? '' : ' AND EXISTS(SELECT 1 FROM horse_owners o WHERE o.horse_id=h.id AND o.user_id=?)';
      const rows = await env.DB.prepare(`SELECT h.id,h.name,h.status,h.photo_key,
        (SELECT COUNT(*) FROM horse_owners o WHERE o.horse_id=h.id) AS owner_count
        FROM planning_horses h WHERE h.id>? AND (?='all' OR h.status=?)${where} ORDER BY h.id LIMIT 51`)
        .bind(cursor,state,state,...(admin ? [] : [viewer.id])).all();
      const page = rows.results.slice(0,50);
      return json({ horses: await Promise.all(page.map(async r => ({ id:r.id,name:r.name,status:r.status,hasPhoto:Boolean(r.photo_key),...(admin?{ownerCount:r.owner_count}:{photo:await signedHorsePhoto(env,r.photo_key)}) }))),
        nextCursor: rows.results.length > 50 ? page.at(-1).id : null, ...(admin ? { photosReady: photoConfig(env).ready } : {}) }, 200, cors);
    }
    if (admin && url.pathname === base && method === 'POST') {
      const input = validateHorse(await readJson(request));
      await validOwners(env, input.ownerIds);
      const now = new Date().toISOString();
      // Single bulk owners insert; last_insert_rowid belongs to this atomic batch.
      const statements = [env.DB.prepare(`INSERT INTO planning_horses(name,status,birth_date,public_notes,admin_notes,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?) RETURNING id`).bind(input.name,input.status,input.birthDate,input.publicNotes,input.adminNotes,now,now)];
      if (input.ownerIds.length) statements.push(env.DB.prepare(`INSERT INTO horse_owners(horse_id,user_id,created_at)
        WITH inserted AS MATERIALIZED (SELECT last_insert_rowid() AS id) SELECT inserted.id,u.id,? FROM users u CROSS JOIN inserted WHERE u.id IN (${placeholders(input.ownerIds)})`).bind(now,...input.ownerIds));
      const result = await env.DB.batch(statements);
      return json({ id: result[0].results[0].id, version:1 }, 201, cors);
    }
    const taskMatch=url.pathname.slice(base.length).match(/^\/(\d+)\/planning\/tasks(?:\/(\d+))?$/);
    const match = url.pathname.slice(base.length).match(/^\/(\d+)(\/photo)?$/);
    if(!admin&&taskMatch){
      const id=Number(taskMatch[1]),taskId=taskMatch[2]?Number(taskMatch[2]):null;
      const horse=await env.DB.prepare(`SELECT id FROM planning_horses h WHERE h.id=? AND h.status='active'
        AND EXISTS(SELECT 1 FROM horse_owners o WHERE o.horse_id=h.id AND o.user_id=?)`).bind(id,viewer.id).first();
      if(!horse)throw fail('Cheval introuvable',404);
      if(!taskId&&method==='POST'){
        const input=validateClientActivity(await readJson(request));const now=new Date().toISOString();
        const result=await env.DB.prepare(`INSERT INTO planning_tasks(week_start,horse_id,day_index,type,description,paddock,starts_at,ends_at,
          request_id,employee_id,position,source,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,'',?,?,NULL,NULL,0,'client',?,?,?) RETURNING id`)
          .bind(input.weekStart,id,input.dayIndex,input.type,input.description,input.startsAt,input.endsAt,viewer.id,now,now).all();
        return json({event:planningEvent({id:result.results[0].id,horse_id:id,week_start:input.weekStart,day_index:input.dayIndex,
          type:input.type,description:input.description,starts_at:input.startsAt,ends_at:input.endsAt,source:'client',created_by_user_id:viewer.id},viewer.id)},201,cors);
      }
      if(taskId&&method==='PATCH'){
        const current=await env.DB.prepare(`SELECT id,horse_id,week_start,day_index,type,description,starts_at,ends_at,source,created_by_user_id
          FROM planning_tasks WHERE id=? AND horse_id=? AND source='client' AND created_by_user_id=?`).bind(taskId,id,viewer.id).first();
        if(!current)throw fail('Activité modifiable introuvable',404);
        const input=validateClientActivity(await readJson(request),{date:dateFor(current.week_start,current.day_index),type:current.type,
          description:current.description,startsAt:current.starts_at,endsAt:current.ends_at});
        await env.DB.prepare(`UPDATE planning_tasks SET week_start=?,day_index=?,type=?,description=?,starts_at=?,ends_at=?,updated_at=?
          WHERE id=? AND horse_id=? AND source='client' AND created_by_user_id=?`).bind(input.weekStart,input.dayIndex,input.type,input.description,
            input.startsAt,input.endsAt,new Date().toISOString(),taskId,id,viewer.id).run();
        return json({event:planningEvent({...current,week_start:input.weekStart,day_index:input.dayIndex,type:input.type,
          description:input.description,starts_at:input.startsAt,ends_at:input.endsAt},viewer.id)},200,cors);
      }
      if(taskId&&method==='DELETE'){
        const deleted=await env.DB.prepare(`DELETE FROM planning_tasks WHERE id=? AND horse_id=? AND source='client' AND created_by_user_id=? RETURNING id`)
          .bind(taskId,id,viewer.id).all();
        if(!deleted.results.length)throw fail('Activité modifiable introuvable',404);
        return json({deleted:true},200,cors);
      }
      throw fail('Méthode non autorisée',405);
    }
    if (!match) throw fail('Route introuvable', 404);
    const id = Number(match[1]);
    const row = await env.DB.prepare(`SELECT h.*,${healthDueSql} AS health_due_json FROM planning_horses h WHERE h.id=?${admin ? '' : ' AND EXISTS(SELECT 1 FROM horse_owners o WHERE o.horse_id=h.id AND o.user_id=?)'}`)
      .bind(id,...(admin ? [] : [viewer.id])).first();
    if (!row) throw fail('Cheval introuvable',404);
    if (!match[2] && method === 'GET') {
      const horse = await publicHorse(env,row,admin);
      if (admin) horse.owners = await ownersFor(env,id);
      if(!admin&&url.searchParams.has('week')){
        const week=validWeek(url.searchParams.get('week'));if(!week)throw fail('Semaine invalide');
        return json({horse,weekStart:week,events:await horseEvents(env,id,viewer.id,week),activityTypes:Object.entries(activityLabels).filter(([value])=>clientActivityTypes.has(value)).map(([value,label])=>({value,label}))},200,cors);
      }
      return json({ horse,...(admin ? {photosReady:photoConfig(env).ready}: {}) },200,cors);
    }
    if (admin && !match[2] && method === 'PATCH') {
      const raw = await readJson(request), input = validateHorse(raw);
      if (raw.version !== row.version) throw fail('Fiche modifiée ailleurs. Rechargez-la.',409);
      await validOwners(env,input.ownerIds);
      const now = new Date().toISOString();
      // Owners change before the version update, guarded by the same expected version.
      const result = await env.DB.batch([
        env.DB.prepare(`DELETE FROM horse_owners WHERE horse_id=? AND user_id NOT IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM planning_horses WHERE id=? AND version=?)`).bind(id,JSON.stringify(input.ownerIds),id,row.version),
        ...(input.ownerIds.length ? [env.DB.prepare(`INSERT OR IGNORE INTO horse_owners(horse_id,user_id,created_at)
          SELECT ?,u.id,? FROM users u WHERE u.id IN (${placeholders(input.ownerIds)}) AND EXISTS(SELECT 1 FROM planning_horses WHERE id=? AND version=?)`).bind(id,now,...input.ownerIds,id,row.version)] : []),
        env.DB.prepare(`UPDATE planning_horses SET name=?,status=?,birth_date=?,public_notes=?,admin_notes=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING version`)
          .bind(input.name,input.status,input.birthDate,input.publicNotes,input.adminNotes,now,id,row.version),
        prepareHorseNotifications(env,id)
      ]);
      if (!result.at(-2).results.length) throw fail('Fiche modifiée ailleurs. Rechargez-la.',409);
      return json({ saved:true,version:row.version+1 },200,cors);
    }
    if (match[2] && (admin ? ['PUT','DELETE'].includes(method) : method==='PUT')) {
      if (Number(request.headers.get('if-match')) !== row.version) throw fail('Fiche modifiée ailleurs. Rechargez-la.',409);
      let newKey = null;
      if (method === 'PUT') {
        if (!photoConfig(env).ready) throw fail('Configurer la signature R2 avant d’ajouter une photo',503);
        const data = await readPhoto(request);
        newKey = `horses/${id}/${crypto.randomUUID()}.${data.extension}`;
        await env.PRODUCT_IMAGES.put(newKey,data.bytes,{httpMetadata:{contentType:data.type,cacheControl:'private, no-store'}});
      }
      let update;
      try {
        update = await env.DB.prepare('UPDATE planning_horses SET photo_key=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING version')
          .bind(newKey,new Date().toISOString(),id,row.version).all();
      } catch (error) {
        // A D1 timeout may hide a committed write: never delete the new object
        // without proving it is unreferenced. Keep both objects on uncertainty.
        throw fail('Enregistrement photo incertain. Rechargez la fiche avant de réessayer.',503);
      }
      if (!update.results.length) {
        if (newKey) await env.PRODUCT_IMAGES.delete(newKey);
        throw fail('Fiche modifiée ailleurs. Rechargez-la.',409);
      }
      let cleanupPending = false;
      if (row.photo_key) { try { await env.PRODUCT_IMAGES.delete(row.photo_key); } catch { cleanupPending=true; console.warn(JSON.stringify({type:'horse-photo-cleanup',horseId:id,key:row.photo_key})); } }
      return json({ saved:true,version:row.version+1,photo:await signedHorsePhoto(env,newKey),cleanupPending },200,cors);
    }
    throw fail('Méthode non autorisée',405);
  } catch (error) {
    if(String(error.message).includes('HEALTH_SEND_IN_PROGRESS'))return json({error:'Un rappel sanitaire est en cours d’envoi. Réessayez dans quelques instants.'},409,cors);
    if (error.status) return json({error:error.message},error.status,cors);
    console.error(JSON.stringify({type:'horses-error',message:String(error.message)}));
    return json({error:'Impossible d’enregistrer ou charger la fiche'},500,cors);
  }
}

export async function readPhoto(request) {
  const type = (request.headers.get('content-type') || '').split(';')[0].toLowerCase();
  const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  if (!extensions[type]) throw fail('Format attendu : JPEG, PNG ou WebP');
  const limit = 3 * 1024 * 1024;
  if (Number(request.headers.get('content-length')) > limit) throw fail('Photo limitée à 3 Mo',413);
  if (!request.body) throw fail('Photo vide');
  const reader = request.body.getReader(), chunks=[]; let length=0;
  while (true) { const {done,value}=await reader.read(); if(done)break; length+=value.length; if(length>limit){await reader.cancel();throw fail('Photo limitée à 3 Mo',413);} chunks.push(value); }
  const bytes=new Uint8Array(length); let offset=0; for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const ascii=(start,end)=>String.fromCharCode(...bytes.slice(start,end));
  const valid=type==='image/jpeg' ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 : type==='image/png' ? [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v) : ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  if (!valid) throw fail('Le contenu ne correspond pas au format image');
  return {bytes,type,extension:extensions[type]};
}
