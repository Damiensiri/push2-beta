import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import worker, {instrumentD1,createRequestDiagnostics,loadPlanning} from '../src/worker.js';
import {photoConfig,signedHorsePhoto,readPhoto} from '../src/horses.js';

const read = name => readFile(new URL('../migrations/'+name,import.meta.url),'utf8');
const split = sql => sql.replace(/--[^\n]*/g,'').split(';').map(s=>s.trim()).filter(Boolean);
async function execute(db,sql){return db.batch(split(sql).map(s=>db.prepare(s)));}
const payload={name:'Tornado',status:'active',birthDate:null,publicNotes:'Visible',adminNotes:'Secret administratif',ownerIds:[1,2]};
const config={HORSE_PHOTO_TTL_SECONDS:'600',HORSE_PHOTO_BUCKET:'ecurie-products-beta',R2_ACCOUNT_ID:'test',R2_HORSE_ACCESS_KEY_ID:'test',R2_HORSE_SECRET_ACCESS_KEY:'test'};

test('fondations chevaux sur D1 : migration, permissions, conservation, concurrence et budgets',async t=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:{DB:'horses-test'},r2Buckets:['PRODUCT_IMAGES'],compatibilityDate:'2026-07-14'});
 t.after(()=>mf.dispose());const DB=await mf.getD1Database('DB'), PRODUCT_IMAGES=await mf.getR2Bucket('PRODUCT_IMAGES');
 for(const name of ['0001_users.sql','0002_paddocks.sql','0004_paddock_requests.sql','0015_stable_planning.sql','0016_staff_planning.sql','0018_planning_task_employees.sql'])await execute(DB,await read(name));
 await execute(DB,`INSERT INTO users(id,email,first_name,last_name,password_hash,password_salt,password_iterations,created_at,updated_at) VALUES(1,'one@test.invalid','One','Client','x','x',1,'now','now'),(2,'two@test.invalid','Two','Client','x','x',1,'now','now'),(3,'three@test.invalid','Three','Client','x','x',1,'now','now');
 INSERT INTO planning_horses(id,name,active,created_at,updated_at) VALUES(12,'Tornado',1,'now','now'),(18,'Utah',0,'now','now'),(99,'Supprimé',1,'now','now'); DELETE FROM planning_horses WHERE id=99;
 INSERT INTO planning_week_horses VALUES('2026-09-07',12,0);
 INSERT INTO planning_tasks(id,week_start,horse_id,day_index,type,created_at,updated_at) VALUES(50,'2026-09-07',12,0,'travail','now','now');`);
 const before=(await DB.prepare('SELECT * FROM planning_tasks').all()).results;
 await execute(DB,await read('0023_horse_foundations.sql'));
 await execute(DB,await read('0024_horse_planning.sql'));
 const afterPlanning=(await DB.prepare('SELECT * FROM planning_tasks').all()).results;
 assert.deepEqual(afterPlanning.map(({source,created_by_user_id,...row})=>row),before);
 assert.equal(afterPlanning[0].source,'backstage');assert.equal(afterPlanning[0].created_by_user_id,null);
 assert.equal((await DB.prepare('SELECT COUNT(*) n FROM planning_week_horses').first()).n,1);
 assert.equal((await DB.prepare('SELECT status,active FROM planning_horses WHERE id=18').first()).status,'archived');
 assert.deepEqual((await DB.prepare('PRAGMA foreign_key_check').all()).results,[]);
 for(const id of [1,2,3]){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('client'+id)));let binary='';for(const byte of digest)binary+=String.fromCharCode(byte);const hash=btoa(binary);await DB.prepare("INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,'now','2099-01-01')").bind(id,hash).run();}
 const REALTIME_HUB={idFromName:()=>({}),get:()=>({fetch:async()=>new Response(null,{status:204})})};
 const env={DB,PRODUCT_IMAGES,REALTIME_HUB,ADMIN_TOKEN:'admin',...config};
 const call=async(path,{method='GET',body,token='admin',headers={}}={})=>{const pending=[];const response=await worker.fetch(new Request('https://test.invalid'+path,{method,headers:{authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil:p=>pending.push(p)});await Promise.all(pending);return {status:response.status,data:await response.json()};};
 const created=await call('/api/admin/horses',{method:'POST',body:payload});assert.equal(created.status,201);const id=created.data.id;assert.ok(id>99);
 assert.deepEqual((await DB.prepare('SELECT horse_id,user_id FROM horse_owners ORDER BY user_id').all()).results,[{horse_id:id,user_id:1},{horse_id:id,user_id:2}]);
 await t.test('aucune fusion des homonymes et pas de création partielle pour propriétaire invalide',async()=>{assert.equal((await call('/api/admin/horses',{method:'POST',body:payload})).status,201);const n=(await DB.prepare('SELECT COUNT(*) n FROM planning_horses').first()).n;assert.equal((await call('/api/admin/horses',{method:'POST',body:{...payload,ownerIds:[1,999]}})).status,400);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM planning_horses').first()).n,n);});
 await t.test('lecture client cloisonnée sans données privées',async()=>{const own=await call('/api/me/horses/'+id,{token:'client1'});assert.equal(own.status,200);assert.equal(own.data.horse.publicNotes,'Visible');for(const field of ['adminNotes','owners','photo_key','version'])assert.equal(field in own.data.horse,false);assert.equal((await call('/api/me/horses/'+id,{token:'client3'})).status,404);assert.equal((await call('/api/admin/horses/'+id,{token:'client1'})).status,401);assert.equal((await call('/api/me/horses/'+id,{method:'PATCH',body:payload,token:'client1'})).status,403);});
 await t.test('statuts et retrait de vue conservent les événements ; création hors vue',async()=>{assert.equal((await call('/api/admin/planning/weeks/2026-09-07/horses/12',{method:'DELETE'})).status,200);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM planning_tasks WHERE id=50').first()).n,1);const taskCreated=await call('/api/admin/planning/tasks',{method:'POST',body:{weekStart:'2026-09-07',horseId:12,dayIndex:1,type:'repos'}});assert.equal(taskCreated.status,201,JSON.stringify(taskCreated.data));const edit=await call('/api/admin/horses/12',{method:'PATCH',body:{...payload,status:'departed',version:1}});assert.equal(edit.status,200);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM planning_tasks WHERE horse_id=12').first()).n,2);assert.equal((await DB.prepare('SELECT active FROM planning_horses WHERE id=12').first()).active,0);assert.equal((await call('/api/admin/horses/12',{method:'PATCH',body:{...payload,status:'archived',version:2}})).status,200);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM planning_tasks WHERE horse_id=12').first()).n,2);});
 await t.test('modification obsolète refusée sans perte des propriétaires',async()=>{assert.equal((await call('/api/admin/horses/'+id,{method:'PATCH',body:{...payload,ownerIds:[2],version:1}})).status,200);assert.equal((await call('/api/admin/horses/'+id,{method:'PATCH',body:{...payload,ownerIds:[3],version:1}})).status,409);assert.equal((await call('/api/me/horses/'+id,{token:'client1'})).status,404);assert.equal((await call('/api/me/horses/'+id,{token:'client2'})).status,200);});
 await t.test('planning client agrégé, horaires facultatifs et droits selon la source',async()=>{
  const initial=await call('/api/me/horses/'+id+'?week=2026-09-07',{token:'client2'});assert.equal(initial.status,200);assert.equal(initial.data.events.length,0);
  const createdActivity=await call('/api/me/horses/'+id+'/planning/tasks',{method:'POST',token:'client2',body:{date:'2026-09-08',type:'travail',startsAt:'14:00',endsAt:'15:00',description:'Séance légère'}});
  assert.equal(createdActivity.status,201);assert.equal(createdActivity.data.event.source,'client');assert.equal(createdActivity.data.event.canEdit,true);
  const taskId=createdActivity.data.event.sourceId;
  const detail=await call('/api/me/horses/'+id+'?week=2026-09-07',{token:'client2'});assert.equal(detail.data.events.length,1);assert.equal(detail.data.events[0].date,'2026-09-08');
  assert.equal((await call('/api/me/horses/'+id+'/planning/tasks/'+taskId,{method:'PATCH',token:'client1',body:{description:'Interdit'}})).status,404);
  const changed=await call('/api/me/horses/'+id+'/planning/tasks/'+taskId,{method:'PATCH',token:'client2',body:{endsAt:null,description:'Travail à pied'}});assert.equal(changed.status,200);assert.equal(changed.data.event.endsAt,null);
  assert.equal((await call('/api/me/horses/'+id+'/planning/tasks',{method:'POST',token:'client2',body:{date:'2026-09-09',type:'travail',endsAt:'15:00'}})).status,400);
  const backstage=await call('/api/admin/planning/tasks',{method:'POST',body:{weekStart:'2026-09-07',horseId:id,dayIndex:3,type:'repos'}});assert.equal(backstage.status,201);assert.equal(backstage.data.task.source,'backstage');
  const timed=await call('/api/admin/planning/tasks',{method:'POST',body:{weekStart:'2026-09-07',horseId:id,dayIndex:4,type:'travail',startsAt:'13:30'}});assert.equal(timed.status,201);assert.equal(timed.data.task.startsAt,'13:30');assert.equal(timed.data.task.endsAt,'');
  assert.equal((await call('/api/me/horses/'+id+'/planning/tasks/'+backstage.data.task.id,{method:'DELETE',token:'client2'})).status,404);
  assert.equal((await call('/api/me/horses/'+id+'/planning/tasks/'+taskId,{method:'DELETE',token:'client2'})).status,200);
  assert.equal((await call('/api/admin/planning/horses',{method:'POST',body:{weekStart:'2026-09-07',horseId:id}})).status,201);
  const filtered=await call('/api/admin/planning?week=2026-09-07&horse_ids='+id);assert.equal(filtered.status,200);assert.deepEqual(filtered.data.horses.map(h=>h.id),[id]);assert.ok(filtered.data.tasks.every(task=>task.horseId===id));
 });
 await t.test('D1 compte les vrais appels first/all/batch et leurs métadonnées',async()=>{const request=new Request('https://test/api/admin/planning');const d=createRequestDiagnostics(request,new URL(request.url));const db=instrumentD1(DB,d);await db.prepare('SELECT id FROM planning_horses LIMIT 1').first();await db.batch([db.prepare('SELECT id FROM planning_horses'),db.prepare('SELECT horse_id FROM horse_owners')]);assert.equal(d.d1Count,3);assert.equal(d.metadataComplete,true);assert.ok(d.rowsRead>0);assert.equal(d.rowsWritten,0);const p=createRequestDiagnostics(request,new URL(request.url));await loadPlanning({DB:instrumentD1(DB,p)},'2026-09-07',true);assert.equal(p.d1Count,6);});
 await t.test('photo : remplacement, refus concurrent et échec D1 préservent les objets référencés',async()=>{
  const put=async(bytes,version,customEnv=env)=>worker.fetch(new Request(`https://test/api/admin/horses/${id}/photo`,{method:'PUT',headers:{authorization:'Bearer admin','content-type':'image/jpeg','if-match':String(version)},body:new Uint8Array(bytes)}),customEnv,{waitUntil(){}});
  let r=await put([255,216,255,224,1],2);assert.equal(r.status,200);const first=(await DB.prepare('SELECT photo_key FROM planning_horses WHERE id=?').bind(id).first()).photo_key;assert.ok(await PRODUCT_IMAGES.get(first));
  assert.equal((await put([255,216,255,224,2],2)).status,409);assert.ok(await PRODUCT_IMAGES.get(first));
  const brokenDB=new Proxy(DB,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('UPDATE planning_horses SET photo_key'))return stmt;return {bind(){return {all:async()=>{throw Error('D1 unavailable');}}}};};return typeof target[key]==='function'?target[key].bind(target):target[key];}});
  assert.equal((await put([255,216,255,224,3],3,{...env,DB:brokenDB})).status,503);assert.equal((await DB.prepare('SELECT photo_key FROM planning_horses WHERE id=?').bind(id).first()).photo_key,first);assert.ok(await PRODUCT_IMAGES.get(first));
  r=await put([255,216,255,224,4],3);assert.equal(r.status,200);assert.equal(await PRODUCT_IMAGES.get(first),null);
  const ownerPut=token=>worker.fetch(new Request(`https://test/api/me/horses/${id}/photo`,{method:'PUT',headers:{authorization:'Bearer '+token,'content-type':'image/jpeg','if-match':'4'},body:new Uint8Array([255,216,255,224,5])}),env,{waitUntil(){}});
  assert.equal((await ownerPut('client3')).status,404);
  assert.equal((await ownerPut('client2')).status,200);
  assert.equal((await ownerPut('client2')).status,409);

 });
});

test('durée signée configurable, URL privée sans accès réseau et validation images',async()=>{
 assert.equal(photoConfig({...config,HORSE_PHOTO_TTL_SECONDS:'900'}).ttl,900);
 assert.throws(()=>photoConfig({...config,HORSE_PHOTO_TTL_SECONDS:'0'}));
 const p=await signedHorsePhoto({...config,HORSE_PHOTO_TTL_SECONDS:'900'},'horses/12/abc.jpg',new Date('2026-09-06T10:00:00Z'));
 assert.equal(new URL(p.url).searchParams.get('X-Amz-Expires'),'900');assert.equal(p.expiresAt,'2026-09-06T10:15:00.000Z');
 assert.equal(await signedHorsePhoto({},'horses/12/abc.jpg'),null);
 await assert.rejects(()=>readPhoto(new Request('https://test',{method:'PUT',headers:{'content-type':'image/png'},body:'not an image'})));
 await assert.rejects(()=>readPhoto(new Request('https://test',{method:'PUT',headers:{'content-type':'image/jpeg','content-length':'4000000'},body:'x'})));
});
