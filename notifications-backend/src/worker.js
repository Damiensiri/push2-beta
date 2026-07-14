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

      if(url.pathname.startsWith("/api/admin/")){
        if(!isAdmin(request,env))return json({error:"Non autorisé"},401,cors);

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

function corsHeaders(request,env){
  const origin=request.headers.get("origin")||"";
  const origins=String(env.ALLOWED_ORIGIN||"").split(",").map(value=>value.trim());
  const allowed=origins.includes(origin)?origin:"";
  return{
    "access-control-allow-origin":allowed,
    "access-control-allow-methods":"GET,POST,PATCH,DELETE,OPTIONS",
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

export{compatibleAlert,validateAlert,parisNow,isPushEnabled,sendRequestedPush,plainTextMessage};
