const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

export default{
  async fetch(request,env){
    const url=new URL(request.url);
    const cors=corsHeaders(request,env);

    if(request.method==="OPTIONS"){
      return new Response(null,{status:204,headers:cors});
    }

    try{
      if(request.method==="GET"&&url.pathname==="/api/health"){
        return json({ok:true,environment:env.ENVIRONMENT||"unknown",pushEnabled:isPushEnabled(env)},200,cors);
      }

      if(request.method==="GET"&&url.pathname==="/api/notifications"){
        const result=await env.DB.prepare(`
          SELECT id,date,heure,categorie,titre,message,epingle,active
          FROM alerts
          ORDER BY id ASC
        `).all();

        const alerts=result.results.map(compatibleAlert);
        return json(alerts,200,{...cors,"cache-control":"public, max-age=15"});
      }

      if(request.method==="GET"&&url.pathname==="/api/statuses"){
        const statuses=await loadPublicStatuses(env);
        return json(statuses,200,{...cors,"cache-control":"public, max-age=5"});
      }

      if(request.method==="GET"&&url.pathname==="/api/schedules"){
        const result=await env.DB.prepare(`
          SELECT day,opens_at,closes_at FROM general_schedules ORDER BY day
        `).all();
        return json(result.results.map(publicSchedule),200,{...cors,"cache-control":"public, max-age=15"});
      }

      if(request.method==="GET"&&url.pathname==="/api/exceptions"){
        const result=await env.DB.prepare(`
          SELECT date,message FROM schedule_exceptions ORDER BY date
        `).all();
        return json(result.results,200,{...cors,"cache-control":"public, max-age=15"});
      }

      if(request.method==="GET"&&url.pathname==="/api/realtime"){
        if(request.headers.get("upgrade")!=="websocket")return json({error:"WebSocket requis"},426,cors);
        return realtimeStub(env).fetch(request);
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/login"){
        const input=await readJson(request);
        const email=normalizeEmail(input?.email);
        const password=String(input?.password||"");
        const user=await env.DB.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
        if(!user||user.status!=="active"||!await verifyPassword(password,user)){
          return json({error:"Identifiants incorrects"},401,cors);
        }
        const session=await createSession(env,user.id);
        await env.DB.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?")
          .bind(session.createdAt,session.createdAt,user.id).run();
        return json({token:session.token,expiresAt:session.expiresAt,user:publicUser(user)},200,cors);
      }

      if(url.pathname==="/api/auth/me"){
        const session=await authenticatedUser(request,env);
        if(!session)return json({error:"Non autorisé"},401,cors);
        if(request.method==="GET")return json({user:publicUser(session)},200,cors);
        if(request.method==="PATCH"){
          const input=await readJson(request);
          const profile=validateUserProfile(input,session);
          if(profile.error)return json({error:profile.error},400,cors);
          let passwordFields=null;
          if(input?.newPassword){
            if(!await verifyPassword(String(input.currentPassword||""),session)){
              return json({error:"Mot de passe actuel incorrect"},400,cors);
            }
            const passwordError=validatePassword(input.newPassword);
            if(passwordError)return json({error:passwordError},400,cors);
            passwordFields=await hashPassword(input.newPassword);
          }
          const now=new Date().toISOString();
          if(passwordFields){
            await env.DB.prepare(`UPDATE users SET first_name=?,last_name=?,card_number=?,
              password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,updated_at=? WHERE id=?`)
              .bind(profile.firstName,profile.lastName,profile.cardNumber,passwordFields.hash,
                passwordFields.salt,passwordFields.iterations,now,session.id).run();
          }else{
            await env.DB.prepare("UPDATE users SET first_name=?,last_name=?,card_number=?,updated_at=? WHERE id=?")
              .bind(profile.firstName,profile.lastName,profile.cardNumber,now,session.id).run();
          }
          const updated=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(session.id).first();
          return json({user:publicUser(updated)},200,cors);
        }
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/logout"){
        const token=bearerToken(request);
        if(token)await env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE token_hash=?")
          .bind(new Date().toISOString(),await sha256(token)).run();
        return json({loggedOut:true},200,cors);
      }

      if(url.pathname.startsWith("/api/admin/")){
        if(!isAdmin(request,env))return json({error:"Non autorisé"},401,cors);

        if(request.method==="GET"&&url.pathname==="/api/admin/operations"){
          return json(await loadOperations(env),200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/users"){
          const result=await env.DB.prepare(`SELECT id,email,first_name,last_name,card_number,role,status,
            must_change_password,created_at,updated_at,last_login_at FROM users ORDER BY last_name,first_name`).all();
          return json(result.results.map(publicUser),200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/users"){
          const input=await readJson(request);
          const validated=validateNewUser(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const password=String(input.temporaryPassword||"");
          const passwordError=validatePassword(password);
          if(passwordError)return json({error:passwordError},400,cors);
          const encoded=await hashPassword(password);
          const now=new Date().toISOString();
          try{
            const result=await env.DB.prepare(`INSERT INTO users(email,first_name,last_name,card_number,role,status,
              password_hash,password_salt,password_iterations,must_change_password,created_at,updated_at)
              VALUES(?,?,?,?,?,'active',?,?,?,1,?,?)`).bind(validated.email,validated.firstName,
              validated.lastName,validated.cardNumber,validated.role,encoded.hash,encoded.salt,
              encoded.iterations,now,now).run();
            const created=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(result.meta.last_row_id).first();
            return json({user:publicUser(created)},201,cors);
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cette adresse existe déjà"},409,cors);
            throw error;
          }
        }

        const userMatch=url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
        if(request.method==="PATCH"&&userMatch){
          const current=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(Number(userMatch[1])).first();
          if(!current)return json({error:"Utilisateur introuvable"},404,cors);
          const input=await readJson(request);
          const status=input.status===undefined?current.status:String(input.status);
          if(!["active","disabled"].includes(status))return json({error:"Statut invalide"},400,cors);
          const role=input.role===undefined?current.role:String(input.role);
          if(!["client","staff","admin"].includes(role))return json({error:"Rôle invalide"},400,cors);
          const now=new Date().toISOString();
          if(input.temporaryPassword){
            const passwordError=validatePassword(input.temporaryPassword);
            if(passwordError)return json({error:passwordError},400,cors);
            const encoded=await hashPassword(input.temporaryPassword);
            await env.DB.batch([
              env.DB.prepare(`UPDATE users SET status=?,role=?,password_hash=?,password_salt=?,
                password_iterations=?,must_change_password=1,updated_at=? WHERE id=?`)
                .bind(status,role,encoded.hash,encoded.salt,encoded.iterations,now,current.id),
              env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,current.id)
            ]);
          }else{
            await env.DB.prepare("UPDATE users SET status=?,role=?,updated_at=? WHERE id=?")
              .bind(status,role,now,current.id).run();
            if(status==="disabled")await env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL")
              .bind(now,current.id).run();
          }
          const updated=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(current.id).first();
          return json({user:publicUser(updated)},200,cors);
        }

        const spaceMatch=url.pathname.match(/^\/api\/admin\/spaces\/([a-z0-9-]+)$/);
        if(request.method==="PUT"&&spaceMatch){
          const input=await readJson(request);
          const validated=validateSpace(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const exists=await env.DB.prepare("SELECT slug FROM spaces WHERE slug=?").bind(spaceMatch[1]).first();
          if(!exists)return json({error:"Espace introuvable"},404,cors);
          const now=parisNow().iso;
          await env.DB.prepare(`
            UPDATE spaces SET manual_status=?,liberte=?,longe=?,info=?,special_hours=?,updated_at=?
            WHERE slug=?
          `).bind(validated.manualStatus,validated.liberte,validated.longe,validated.info,
            validated.specialHours,now,spaceMatch[1]).run();
          await notifyRealtime(env,"statuses");
          return json({saved:true,space:spaceMatch[1]},200,cors);
        }

        const schedulesMatch=url.pathname.match(/^\/api\/admin\/spaces\/([a-z0-9-]+)\/schedules$/);
        if(request.method==="PUT"&&schedulesMatch){
          const input=await readJson(request);
          const schedules=validateSchedules(input?.schedules);
          if(schedules.error)return json({error:schedules.error},400,cors);
          const exists=await env.DB.prepare("SELECT slug FROM spaces WHERE slug=?").bind(schedulesMatch[1]).first();
          if(!exists)return json({error:"Espace introuvable"},404,cors);
          await env.DB.batch(schedules.rows.map(row=>env.DB.prepare(`
            INSERT INTO space_schedules(space_slug,day,opens_at,closes_at) VALUES(?,?,?,?)
            ON CONFLICT(space_slug,day) DO UPDATE SET opens_at=excluded.opens_at,closes_at=excluded.closes_at
          `).bind(schedulesMatch[1],row.day,row.opensAt,row.closesAt)));
          await notifyRealtime(env,"statuses");
          return json({saved:true,space:schedulesMatch[1]},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/general-schedules"){
          const input=await readJson(request);
          const schedules=validateSchedules(input?.schedules);
          if(schedules.error)return json({error:schedules.error},400,cors);
          const now=parisNow().iso;
          await env.DB.batch(schedules.rows.map(row=>env.DB.prepare(`
            INSERT INTO general_schedules(day,opens_at,closes_at,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(day) DO UPDATE SET opens_at=excluded.opens_at,closes_at=excluded.closes_at,updated_at=excluded.updated_at
          `).bind(row.day,row.opensAt,row.closesAt,now)));
          await notifyRealtime(env,"schedules");
          return json({saved:true},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/exceptions"){
          const input=await readJson(request);
          const date=String(input?.date||"").trim();
          const message=String(input?.message||"").trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"Date invalide"},400,cors);
          if(!message||message.length>500)return json({error:"Texte d’exception invalide"},400,cors);
          const now=parisNow().iso;
          await env.DB.prepare(`
            INSERT INTO schedule_exceptions(date,message,created_at,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(date) DO UPDATE SET message=excluded.message,updated_at=excluded.updated_at
          `).bind(date,message,now,now).run();
          await notifyRealtime(env,"exceptions");
          return json({saved:true},200,cors);
        }

        const exceptionMatch=url.pathname.match(/^\/api\/admin\/exceptions\/(\d+)$/);
        if(request.method==="DELETE"&&exceptionMatch){
          const result=await env.DB.prepare("DELETE FROM schedule_exceptions WHERE id=?")
            .bind(Number(exceptionMatch[1])).run();
          if(!result.meta.changes)return json({error:"Exception introuvable"},404,cors);
          await notifyRealtime(env,"exceptions");
          return json({deleted:true},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/home-alert"){
          const input=await readJson(request);
          const message=String(input?.message||"").trim();
          if(message.length>500)return json({error:"Texte d’alerte trop long"},400,cors);
          const urgent=normalizeYesNo(input?.urgent,false);
          const now=parisNow().iso;
          await env.DB.prepare(`
            INSERT INTO home_alert(id,message,urgent,updated_at) VALUES(1,?,?,?)
            ON CONFLICT(id) DO UPDATE SET message=excluded.message,urgent=excluded.urgent,updated_at=excluded.updated_at
          `).bind(message,urgent,now).run();
          await notifyRealtime(env,"home-alert");
          return json({saved:true},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/notifications"){
          const result=await env.DB.prepare(`
            SELECT id,date,heure,categorie,titre,message,epingle,active,
                   push_requested,push_sent_at,created_at,updated_at
            FROM alerts ORDER BY id DESC
          `).all();
          return json(result.results,200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/notifications"){
          const input=await readJson(request);
          const validated=validateAlert(input);
          if(validated.error)return json({error:validated.error},400,cors);

          const now=parisNow();
          const result=await env.DB.prepare(`
            INSERT INTO alerts(
              date,heure,categorie,titre,message,epingle,active,
              push_requested,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
          `).bind(
            now.date,now.time,validated.categorie,validated.titre,
            validated.message,validated.epingle,validated.active,
            validated.pushRequested,now.iso,now.iso
          ).run();

          const created=await env.DB.prepare(`
            SELECT id,date,heure,categorie,titre,message,epingle,active,
                   push_requested,push_sent_at,created_at,updated_at
            FROM alerts WHERE id=?
          `).bind(result.meta.last_row_id).first();

          const push=await sendRequestedPush(env,created);
          if(push.status==="sent"){
            await markPushSent(env,created.id,push.sentAt);
            created.push_sent_at=push.sentAt;
          }

          return json({alert:created,push},201,cors);
        }

        const match=url.pathname.match(/^\/api\/admin\/notifications\/(\d+)$/);
        if(request.method==="DELETE"&&match){
          const result=await env.DB.prepare("DELETE FROM alerts WHERE id=?")
            .bind(Number(match[1])).run();
          if(!result.meta.changes)return json({error:"Alerte introuvable"},404,cors);
          return json({deleted:true,id:Number(match[1])},200,cors);
        }

        if(request.method==="PATCH"&&match){
          const current=await env.DB.prepare("SELECT * FROM alerts WHERE id=?")
            .bind(Number(match[1])).first();
          if(!current)return json({error:"Alerte introuvable"},404,cors);

          const input=await readJson(request);
          const validated=validateAlert({
            categorie:input.categorie??current.categorie,
            titre:input.titre??current.titre,
            message:input.message??current.message,
            epingle:input.epingle??current.epingle,
            active:input.active??current.active,
            pushRequested:input.pushRequested??Boolean(current.push_requested)
          });
          if(validated.error)return json({error:validated.error},400,cors);

          const now=parisNow();
          await env.DB.prepare(`
            UPDATE alerts SET categorie=?,titre=?,message=?,epingle=?,active=?,
              push_requested=?,updated_at=? WHERE id=?
          `).bind(
            validated.categorie,validated.titre,validated.message,
            validated.epingle,validated.active,validated.pushRequested,
            now.iso,Number(match[1])
          ).run();

          const updated=await env.DB.prepare(`
            SELECT id,date,heure,categorie,titre,message,epingle,active,
                   push_requested,push_sent_at,created_at,updated_at
            FROM alerts WHERE id=?
          `).bind(Number(match[1])).first();
          const push=await sendRequestedPush(env,updated);
          if(push.status==="sent"){
            await markPushSent(env,updated.id,push.sentAt);
            updated.push_sent_at=push.sentAt;
          }
          return json({alert:updated,push},200,cors);
        }
      }

      return json({error:"Route introuvable"},404,cors);
    }catch(error){
      return json({error:"Erreur interne",detail:String(error?.message||error)},500,cors);
    }
  }
};

function compatibleAlert(row){
  return{
    id:row.id,
    date:row.date,
    heure:row.heure,
    categorie:row.categorie||"",
    titre:row.titre,
    message:row.message,
    epingle:row.epingle||"",
    expire:"",
    active:row.active
  };
}

const DAY_NAMES=["","lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];

async function loadPublicStatuses(env,date=new Date()){
  const [spacesResult,schedulesResult,alert]=await Promise.all([
    env.DB.prepare("SELECT * FROM spaces ORDER BY position").all(),
    env.DB.prepare("SELECT * FROM space_schedules ORDER BY space_slug,day").all(),
    env.DB.prepare("SELECT message,urgent FROM home_alert WHERE id=1").first()
  ]);
  const paris=parisClock(date);
  const scheduleMap=new Map(schedulesResult.results.map(row=>[`${row.space_slug}:${row.day}`,row]));
  const rows=spacesResult.results.map(space=>{
    const schedule=scheduleMap.get(`${space.slug}:${paris.day}`)||null;
    return publicSpace(space,schedule,paris.minutes);
  });
  rows.push({
    espace:"accueil",statut_manuel:"",statut_auto:"ferme",liberte:"",longe:"",info:"",
    alerte:alert?.message||"",horaire_special:"",horaire_affiche:"",urgent:alert?.urgent||"non"
  });
  return rows;
}

function publicSpace(space,schedule,minutes){
  const normalHours=schedule?`${schedule.opens_at} - ${schedule.closes_at}`:"";
  const status=calculateStatus(space.manual_status,schedule,minutes);
  const hidesHours=status==="ferme"||status==="hors-service";
  return{
    espace:space.slug,
    statut_manuel:space.manual_status,
    statut_auto:status,
    liberte:space.liberte||"",
    longe:space.longe||"",
    info:space.info||"",
    alerte:"",
    horaire_special:hidesHours?"":space.special_hours||"",
    horaire_affiche:hidesHours?"":normalHours,
    urgent:""
  };
}

function calculateStatus(manualStatus,schedule,minutes){
  if(["ferme","prevision","hors-service"].includes(manualStatus))return manualStatus;
  if(!schedule)return"prevision";
  const opens=timeToMinutes(schedule.opens_at);
  const closes=timeToMinutes(schedule.closes_at);
  if(opens===null||closes===null)return"prevision";
  const open=closes>opens?minutes>=opens&&minutes<closes:minutes>=opens||minutes<closes;
  return open?"ouvert":"prevision";
}

function publicSchedule(row){
  return{jour:DAY_NAMES[row.day],ouvert:row.opens_at,ferme:row.closes_at};
}

async function loadOperations(env){
  const [spaces,schedules,general,exceptions,homeAlert]=await Promise.all([
    env.DB.prepare("SELECT * FROM spaces ORDER BY position").all(),
    env.DB.prepare("SELECT * FROM space_schedules ORDER BY space_slug,day").all(),
    env.DB.prepare("SELECT * FROM general_schedules ORDER BY day").all(),
    env.DB.prepare("SELECT * FROM schedule_exceptions ORDER BY date DESC").all(),
    env.DB.prepare("SELECT * FROM home_alert WHERE id=1").first()
  ]);
  return{spaces:spaces.results,spaceSchedules:schedules.results,
    generalSchedules:general.results,exceptions:exceptions.results,homeAlert:homeAlert||{message:"",urgent:"non"}};
}

function validateSpace(input){
  const manualStatus=String(input?.manualStatus||"").trim().toLowerCase();
  if(!["ouvert","prevision","ferme","hors-service"].includes(manualStatus))return{error:"Statut invalide"};
  const info=String(input?.info||"").trim();
  const specialHours=String(input?.specialHours||"").trim();
  if(info.length>500||specialHours.length>120)return{error:"Texte trop long"};
  return{manualStatus,liberte:normalizeYesNo(input?.liberte,true),longe:normalizeYesNo(input?.longe,true),info,specialHours};
}

function validateSchedules(value){
  if(!Array.isArray(value)||value.length!==7)return{error:"Les sept jours sont obligatoires"};
  const rows=[];
  for(const item of value){
    const day=Number(item?.day);
    const opensAt=String(item?.opensAt||"");
    const closesAt=String(item?.closesAt||"");
    if(day<1||day>7||!/^\d{2}:\d{2}$/.test(opensAt)||!/^\d{2}:\d{2}$/.test(closesAt)){
      return{error:"Horaire invalide"};
    }
    if(timeToMinutes(opensAt)===null||timeToMinutes(closesAt)===null)return{error:"Horaire invalide"};
    rows.push({day,opensAt,closesAt});
  }
  if(new Set(rows.map(row=>row.day)).size!==7)return{error:"Chaque jour doit être présent une seule fois"};
  return{rows:rows.sort((a,b)=>a.day-b.day)};
}

function normalizeYesNo(value,allowEmpty){
  const normalized=String(value??"").trim().toLowerCase();
  if(normalized==="oui"||value===true)return"oui";
  if(normalized==="non"||value===false)return"non";
  return allowEmpty?"":"non";
}

function timeToMinutes(value){
  const match=String(value||"").match(/^(\d{2}):(\d{2})$/);
  if(!match)return null;
  const hours=Number(match[1]);
  const minutes=Number(match[2]);
  if(hours>23||minutes>59)return null;
  return hours*60+minutes;
}

function parisClock(date=new Date()){
  const values={};
  new Intl.DateTimeFormat("en-GB",{
    timeZone:"Europe/Paris",weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(date).forEach(part=>{if(part.type!=="literal")values[part.type]=part.value;});
  const days={Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7};
  return{day:days[values.weekday],minutes:Number(values.hour)*60+Number(values.minute)};
}

function isPushEnabled(env){
  return String(env.PUSH_ENABLED).toLowerCase()==="true"&&
    Boolean(env.ONESIGNAL_APP_ID)&&Boolean(env.ONESIGNAL_REST_API_KEY);
}

async function sendRequestedPush(env,alert){
  if(!alert.push_requested)return{enabled:isPushEnabled(env),status:"not-requested"};
  if(alert.push_sent_at)return{enabled:isPushEnabled(env),status:"already-sent",sentAt:alert.push_sent_at};
  if(alert.active!=="oui")return{enabled:isPushEnabled(env),status:"inactive-alert"};
  if(!isPushEnabled(env))return{enabled:false,status:"disabled-in-beta"};

  const detailUrl=`https://damiensiri.github.io/push2-beta/detail.html?id=${encodeURIComponent(alert.id)}`;
  try{
    const response=await fetch("https://api.onesignal.com/notifications",{
      method:"POST",
      headers:{
        "authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`,
        "content-type":"application/json; charset=utf-8"
      },
      body:JSON.stringify({
        app_id:env.ONESIGNAL_APP_ID,
        included_segments:["All"],
        headings:{fr:alert.titre,en:alert.titre},
        contents:{fr:plainTextMessage(alert.message),en:plainTextMessage(alert.message)},
        url:detailUrl
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.errors){
      const detail=Array.isArray(data.errors)?data.errors.join(", "):data.errors||`HTTP ${response.status}`;
      return{enabled:true,status:"failed",error:String(detail)};
    }
    return{enabled:true,status:"sent",id:data.id||null,sentAt:new Date().toISOString()};
  }catch(error){
    return{enabled:true,status:"failed",error:String(error?.message||error)};
  }
}

async function markPushSent(env,id,sentAt){
  await env.DB.prepare("UPDATE alerts SET push_sent_at=?,updated_at=? WHERE id=?")
    .bind(sentAt,sentAt,id).run();
}

function validateAlert(input){
  const titre=String(input?.titre||"").trim();
  const message=String(input?.message||"").trim();
  if(!titre)return{error:"Le titre est obligatoire"};
  if(!message)return{error:"Le message est obligatoire"};
  if(titre.length>160)return{error:"Le titre est trop long"};
  if(message.length>5000)return{error:"Le message est trop long"};
  if(/[<>]/.test(titre+message+String(input?.categorie||""))){
    return{error:"Les balises HTML ne sont pas autorisées"};
  }

  return{
    categorie:String(input?.categorie||"").trim().slice(0,80),
    titre,
    message,
    epingle:input?.epingle===true||String(input?.epingle).toLowerCase()==="oui"?"oui":"",
    active:input?.active===false||String(input?.active).toLowerCase()==="non"?"non":"oui",
    pushRequested:input?.pushRequested===true?1:0
  };
}

function plainTextMessage(value){
  return String(value||"")
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^\s)]+\)/gi,"$1")
    .replace(/\*\*([^*\n]+)\*\*/g,"$1")
    .replace(/__([^_\n]+)__/g,"$1");
}

function parisNow(){
  const date=new Date();
  const parts={};
  new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(date).forEach(part=>{
    if(part.type!=="literal")parts[part.type]=part.value;
  });
  return{
    date:`${parts.year}-${parts.month}-${parts.day}`,
    time:`${parts.hour}:${parts.minute}`,
    iso:date.toISOString()
  };
}

function isAdmin(request,env){
  if(!env.ADMIN_TOKEN)return false;
  const value=request.headers.get("authorization")||"";
  return value===`Bearer ${String(env.ADMIN_TOKEN).trim()}`;
}

const PASSWORD_ITERATIONS=210000;
const SESSION_DURATION_MS=30*24*60*60*1000;

function normalizeEmail(value){
  return String(value||"").trim().toLowerCase();
}

function validatePassword(value){
  const password=String(value||"");
  if(password.length<12)return"Le mot de passe doit contenir au moins 12 caractères";
  if(password.length>200)return"Le mot de passe est trop long";
  return"";
}

function validateNewUser(input){
  const email=normalizeEmail(input?.email);
  const firstName=String(input?.firstName||"").trim();
  const lastName=String(input?.lastName||"").trim();
  const cardNumber=String(input?.cardNumber||"").trim();
  const role=String(input?.role||"client");
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>160)return{error:"Adresse email invalide"};
  if(!firstName||firstName.length>60||!lastName||lastName.length>80)return{error:"Prénom ou nom invalide"};
  if(cardNumber.length>80)return{error:"Numéro de carte trop long"};
  if(!["client","staff","admin"].includes(role))return{error:"Rôle invalide"};
  return{email,firstName,lastName,cardNumber,role};
}

function validateUserProfile(input,current){
  const firstName=String(input?.firstName??current.first_name).trim();
  const lastName=String(input?.lastName??current.last_name).trim();
  const cardNumber=String(input?.cardNumber??current.card_number??"").trim();
  if(!firstName||firstName.length>60||!lastName||lastName.length>80)return{error:"Prénom ou nom invalide"};
  if(cardNumber.length>80)return{error:"Numéro de carte trop long"};
  return{firstName,lastName,cardNumber};
}

function publicUser(user){
  return{id:Number(user.id),email:user.email,firstName:user.first_name,lastName:user.last_name,
    cardNumber:user.card_number||"",role:user.role,status:user.status,
    mustChangePassword:Boolean(user.must_change_password),createdAt:user.created_at,
    updatedAt:user.updated_at,lastLoginAt:user.last_login_at||null};
}

function bytesToBase64(bytes){
  let value="";
  for(const byte of bytes)value+=String.fromCharCode(byte);
  return btoa(value);
}

function base64ToBytes(value){
  const decoded=atob(value);
  return Uint8Array.from(decoded,char=>char.charCodeAt(0));
}

async function hashPassword(password,saltBytes=crypto.getRandomValues(new Uint8Array(16)),iterations=PASSWORD_ITERATIONS){
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(String(password)),"PBKDF2",false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt:saltBytes,iterations},material,256);
  return{hash:bytesToBase64(new Uint8Array(bits)),salt:bytesToBase64(saltBytes),iterations};
}

async function verifyPassword(password,user){
  const encoded=await hashPassword(password,base64ToBytes(user.password_salt),Number(user.password_iterations));
  return timingSafeEqual(encoded.hash,user.password_hash);
}

function timingSafeEqual(left,right){
  const a=new TextEncoder().encode(String(left));
  const b=new TextEncoder().encode(String(right));
  let difference=a.length^b.length;
  const length=Math.max(a.length,b.length);
  for(let index=0;index<length;index++)difference|=(a[index%a.length]||0)^(b[index%b.length]||0);
  return difference===0;
}

async function sha256(value){
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(value)));
  return bytesToBase64(new Uint8Array(digest));
}

function bearerToken(request){
  const match=(request.headers.get("authorization")||"").match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim()||"";
}

async function createSession(env,userId){
  const token=bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const createdAt=new Date().toISOString();
  const expiresAt=new Date(Date.now()+SESSION_DURATION_MS).toISOString();
  await env.DB.prepare("INSERT INTO user_sessions(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)")
    .bind(userId,await sha256(token),createdAt,expiresAt).run();
  return{token,createdAt,expiresAt};
}

async function authenticatedUser(request,env){
  const token=bearerToken(request);
  if(!token)return null;
  return env.DB.prepare(`SELECT u.* FROM user_sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active'`)
    .bind(await sha256(token),new Date().toISOString()).first();
}

function corsHeaders(request,env){
  const origin=request.headers.get("origin")||"";
  const origins=String(env.ALLOWED_ORIGIN||"").split(",").map(value=>value.trim());
  const allowed=origins.includes(origin)?origin:"";
  return{
    "access-control-allow-origin":allowed,
    "access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":"authorization,content-type",
    "vary":"Origin"
  };
}

async function readJson(request){
  const type=request.headers.get("content-type")||"";
  if(!type.includes("application/json"))throw new Error("Corps JSON requis");
  return request.json();
}

function json(value,status,headers={}){
  return new Response(JSON.stringify(value),{
    status,
    headers:{...JSON_HEADERS,...headers}
  });
}

function realtimeStub(env){
  return env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("pwa-beta"));
}

async function notifyRealtime(env,type){
  await realtimeStub(env).fetch("https://realtime.internal/broadcast",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({type,updatedAt:new Date().toISOString()})
  });
}

export class RealtimeHub{
  constructor(state){
    this.state=state;
  }

  async fetch(request){
    const url=new URL(request.url);
    if(request.method==="POST"&&url.pathname==="/broadcast"){
      const message=await request.text();
      for(const socket of this.state.getWebSockets()){
        try{socket.send(message);}catch(error){}
      }
      return new Response(null,{status:204});
    }
    if(request.headers.get("upgrade")!=="websocket")return new Response("WebSocket requis",{status:426});
    const pair=new WebSocketPair();
    const [client,server]=Object.values(pair);
    this.state.acceptWebSocket(server);
    return new Response(null,{status:101,webSocket:client});
  }

  webSocketMessage(socket,message){
    if(message==="ping")socket.send("pong");
  }

  webSocketClose(socket,code,reason){
    socket.close(code,reason);
  }
}

export{
  compatibleAlert,validateAlert,parisNow,isPushEnabled,sendRequestedPush,plainTextMessage,
  calculateStatus,publicSpace,publicSchedule,validateSpace,validateSchedules,timeToMinutes,parisClock,
  normalizeEmail,validatePassword,validateNewUser,hashPassword,verifyPassword,publicUser
};
