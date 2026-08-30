const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

export default{
  async scheduled(controller,env,ctx){
    ctx.waitUntil(processPaddockPushReminders(env,new Date(controller.scheduledTime)));
    ctx.waitUntil(processScheduledNotifications(env,new Date(controller.scheduledTime)));
  },
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
        const statuses=await loadPublicStatuses(env,undefined,validIsoDate(url.searchParams.get("date")));
        return json(statuses,200,{...cors,"cache-control":"public, max-age=5"});
      }

      if(request.method==="GET"&&url.pathname==="/api/schedules"){
        const dateList=parseDateList(url.searchParams.get("dates"));
        if(dateList.length){
          const schedules=await loadEffectiveGeneralSchedulesByDate(env,dateList);
          return json(schedules,200,{...cors,"cache-control":"public, max-age=15"});
        }
        const schedules=await loadEffectiveGeneralSchedules(env,validIsoDate(url.searchParams.get("date")));
        return json(schedules.map(publicSchedule),200,{...cors,"cache-control":"public, max-age=15"});
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

      if(url.pathname==="/api/planning"&&request.method==="GET"){
        const device=await kioskDevice(request,env);
        if(!device)return json({error:"Tablette non autorisée"},401,cors);
        const week=validWeekStart(url.searchParams.get("week"));
        if(!week)return json({error:"Semaine invalide"},400,cors);
        await env.DB.prepare("UPDATE planning_kiosk_devices SET last_seen_at=?,updated_at=? WHERE id=?")
          .bind(new Date().toISOString(),new Date().toISOString(),device.id).run();
        return json(await loadPlanning(env,week),200,cors);
      }

      const kioskTask=url.pathname.match(/^\/api\/planning\/tasks\/(\d+)\/complete$/);
      if(kioskTask&&request.method==="POST"){
        const device=await kioskDevice(request,env);
        if(!device)return json({error:"Tablette non autorisée"},401,cors);
        const task=await env.DB.prepare("SELECT * FROM planning_tasks WHERE id=?").bind(Number(kioskTask[1])).first();
        if(!task)return json({error:"Tâche introuvable"},404,cors);
        if(task.completed_at)return json({task:publicPlanningTask(task),duplicate:true},200,cors);
        if(task.request_id)await completePaddockRequest(env,Number(task.request_id),"Réalisée depuis le planning");
        const now=new Date().toISOString();
        await env.DB.prepare("UPDATE planning_tasks SET completed_at=?,completed_by=?,updated_at=? WHERE id=? AND completed_at IS NULL")
          .bind(now,`tablette:${device.id}`,now,task.id).run();
        const updated=await env.DB.prepare("SELECT * FROM planning_tasks WHERE id=?").bind(task.id).first();
        await notifyRealtime(env,"planning");
        return json({task:publicPlanningTask(updated)},200,cors);
      }

      const catalogImageMatch=url.pathname.match(/^\/api\/catalog\/images\/([A-Za-z0-9._-]+)$/);
      if(request.method==="GET"&&catalogImageMatch){
        const object=await env.PRODUCT_IMAGES.get(catalogImageMatch[1]);
        if(!object)return json({error:"Image introuvable"},404,cors);
        const headers={...cors,"content-type":object.httpMetadata?.contentType||"image/webp",
          "cache-control":"public, max-age=31536000, immutable","etag":object.httpEtag};
        return new Response(object.body,{headers});
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/login"){
        const input=await readJson(request);
        const email=normalizeEmail(input?.email);
        const password=String(input?.password||"");
        const user=await env.DB.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
        if(user?.approval_status==="pending"&&await verifyPassword(password,user)){
          return json({error:"Votre demande de compte est en attente de validation par l’écurie."},403,cors);
        }
        if(!user||user.status!=="active"||!await verifyPassword(password,user)){
          return json({error:"Identifiants incorrects"},401,cors);
        }
        const session=await createSession(env,user.id);
        await env.DB.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE id=?")
          .bind(session.createdAt,session.createdAt,user.id).run();
        return json({token:session.token,expiresAt:session.expiresAt,user:publicUser(user)},200,cors);
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/register"){
        const input=await readJson(request);
        const validated=validateNewUser({...input,cardNumber:"",role:"client"});
        if(validated.error)return json({error:validated.error},400,cors);
        const passwordError=validatePassword(input?.password);
        if(passwordError)return json({error:passwordError},400,cors);
        const encoded=await hashPassword(input.password);
        const now=new Date().toISOString();
        try{
          await env.DB.prepare(`INSERT INTO users(email,first_name,last_name,card_number,role,status,approval_status,
            password_hash,password_salt,password_iterations,must_change_password,created_at,updated_at)
            VALUES(?,?,?,'','client','disabled','pending',?,?,?,0,?,?)`).bind(validated.email,validated.firstName,
              validated.lastName,encoded.hash,encoded.salt,encoded.iterations,now,now).run();
          await sendAdminEventPush(env,"Nouvelle demande de compte",`${validated.firstName} ${validated.lastName} attend votre validation.`,"users.html");
          return json({registered:true,pending:true},201,cors);
        }catch(error){
          if(String(error?.message||error).includes("UNIQUE"))return json({error:"Une demande ou un compte existe déjà avec cette adresse email."},409,cors);
          throw error;
        }
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/password-reset/request"){
        const input=await readJson(request);const email=normalizeEmail(input?.email);
        const user=await env.DB.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE AND status='active' AND approval_status='approved'").bind(email).first();
        if(user){
          const recent=await env.DB.prepare("SELECT id FROM password_reset_tokens WHERE user_id=? AND created_at>? ORDER BY id DESC LIMIT 1")
            .bind(user.id,new Date(Date.now()-5*60*1000).toISOString()).first();
          if(!recent){
            const token=crypto.randomUUID()+crypto.randomUUID();const createdAt=new Date().toISOString();
            const expiresAt=new Date(Date.now()+30*60*1000).toISOString();
            await env.DB.prepare("INSERT INTO password_reset_tokens(user_id,token_hash,created_at,expires_at) VALUES(?,?,?,?)")
              .bind(user.id,await sha256(token),createdAt,expiresAt).run();
            await sendPasswordResetEmail(env,user,token,expiresAt);
          }
        }
        return json({requested:true,message:"Si cette adresse correspond à un compte actif, un lien vient d’être envoyé."},200,cors);
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/password-reset/confirm"){
        const input=await readJson(request);const token=String(input?.token||"");
        if(token.length<40||token.length>200)return json({error:"Lien de réinitialisation invalide ou expiré"},400,cors);
        const passwordError=validatePassword(input?.newPassword);if(passwordError)return json({error:passwordError},400,cors);
        const reset=await env.DB.prepare(`SELECT t.id,t.user_id FROM password_reset_tokens t JOIN users u ON u.id=t.user_id
          WHERE t.token_hash=? AND t.used_at IS NULL AND t.expires_at>? AND u.status='active' LIMIT 1`)
          .bind(await sha256(token),new Date().toISOString()).first();
        if(!reset)return json({error:"Lien de réinitialisation invalide ou expiré"},400,cors);
        const encoded=await hashPassword(input.newPassword);const now=new Date().toISOString();
        await env.DB.batch([
          env.DB.prepare(`UPDATE users SET password_hash=?,password_salt=?,password_iterations=?,must_change_password=0,updated_at=? WHERE id=?`)
            .bind(encoded.hash,encoded.salt,encoded.iterations,now,reset.user_id),
          env.DB.prepare("UPDATE password_reset_tokens SET used_at=? WHERE id=? AND used_at IS NULL").bind(now,reset.id),
          env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,reset.user_id)
        ]);
        return json({reset:true},200,cors);
      }

      if(url.pathname==="/api/auth/me"){
        const session=await authenticatedUser(request,env);
        if(!session)return json({error:"Non autorisé"},401,cors);
        if(request.method==="GET")return json({user:publicUser(session)},200,cors);
        if(request.method==="PATCH"){
          const input=await readJson(request);
          const profile=validateUserProfile(input,session);
          if(profile.error)return json({error:profile.error},400,cors);
          const email=input?.newEmail===undefined?session.email:normalizeEmail(input.newEmail);
          if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>160)return json({error:"Adresse email invalide"},400,cors);
          const emailChanged=email!==normalizeEmail(session.email);
          let passwordFields=null;
          if(input?.newPassword||emailChanged){
            if(!await verifyPassword(String(input.currentPassword||""),session)){
              return json({error:"Mot de passe actuel incorrect"},400,cors);
            }
          }
          if(input?.newPassword){
            const passwordError=validatePassword(input.newPassword);
            if(passwordError)return json({error:passwordError},400,cors);
            passwordFields=await hashPassword(input.newPassword);
          }
          const now=new Date().toISOString();
          try{
            const update=passwordFields
              ?env.DB.prepare(`UPDATE users SET email=?,first_name=?,last_name=?,card_number=?,password_hash=?,password_salt=?,
                password_iterations=?,must_change_password=0,updated_at=? WHERE id=?`).bind(email,profile.firstName,profile.lastName,
                  profile.cardNumber,passwordFields.hash,passwordFields.salt,passwordFields.iterations,now,session.id)
              :env.DB.prepare("UPDATE users SET email=?,first_name=?,last_name=?,card_number=?,updated_at=? WHERE id=?")
                .bind(email,profile.firstName,profile.lastName,profile.cardNumber,now,session.id);
            if(emailChanged)await env.DB.batch([
              update,
              env.DB.prepare("UPDATE paddock_reservations SET email=? WHERE user_id=?").bind(email,session.id),
              env.DB.prepare("UPDATE paddock_requests SET email=? WHERE user_id=?").bind(email,session.id),
              env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,session.id)
            ]);
            else await update.run();
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cette adresse email est déjà utilisée"},409,cors);
            throw error;
          }
          const updated=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(session.id).first();
          return json({user:publicUser(updated),reauthRequired:emailChanged},200,cors);
        }
      }

      if(url.pathname==="/api/auth/profile-photo"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const key=`profiles/${viewer.id}.jpg`;
        if(request.method==="GET"){
          const object=await env.PRODUCT_IMAGES.get(key);
          if(!object)return json({error:"Photo introuvable"},404,cors);
          return new Response(object.body,{headers:{...cors,"content-type":object.httpMetadata?.contentType||"image/jpeg",
            "cache-control":"private, no-store","etag":object.httpEtag}});
        }
        if(request.method==="PUT"){
          const contentType=String(request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
          if(!["image/jpeg","image/png","image/webp"].includes(contentType))return json({error:"Format d’image invalide"},400,cors);
          const data=await request.arrayBuffer();
          if(!data.byteLength||data.byteLength>3*1024*1024)return json({error:"La photo doit peser moins de 3 Mo"},400,cors);
          await env.PRODUCT_IMAGES.put(key,data,{httpMetadata:{contentType}});
          return json({saved:true},200,cors);
        }
        if(request.method==="DELETE"){
          await env.PRODUCT_IMAGES.delete(key);
          return json({deleted:true},200,cors);
        }
      }

      if(url.pathname==="/api/push/subscription"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        if(request.method==="PUT"||request.method==="DELETE"){
          const input=await readJson(request);const subscriptionId=String(input?.subscriptionId||"").trim();
          const installationId=String(input?.installationId||"").trim();
          if(!isValidPushSubscriptionId(subscriptionId))return json({error:"Abonnement push invalide"},400,cors);
          if(request.method==="PUT"&&!isValidPushInstallationId(installationId))return json({error:"Installation push invalide"},400,cors);
          if(request.method==="PUT"){
            const now=new Date().toISOString();
            await env.DB.batch([
              env.DB.prepare("DELETE FROM user_push_subscriptions WHERE user_id=? AND installation_id IS NULL").bind(viewer.id),
              env.DB.prepare("DELETE FROM user_push_subscriptions WHERE user_id=? AND installation_id=? AND subscription_id<>?")
                .bind(viewer.id,installationId,subscriptionId),
              env.DB.prepare(`INSERT INTO user_push_subscriptions(subscription_id,user_id,installation_id,created_at,updated_at)
                VALUES(?,?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET user_id=excluded.user_id,
                installation_id=excluded.installation_id,updated_at=excluded.updated_at`)
                .bind(subscriptionId,viewer.id,installationId,now,now)
            ]);
            return json({registered:true},200,cors);
          }
          await env.DB.prepare("DELETE FROM user_push_subscriptions WHERE subscription_id=? AND user_id=?")
            .bind(subscriptionId,viewer.id).run();
          return json({deleted:true},200,cors);
        }
      }

      if(request.method==="POST"&&url.pathname==="/api/auth/logout"){
        const token=bearerToken(request);
        if(token)await env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE token_hash=?")
          .bind(new Date().toISOString(),await sha256(token)).run();
        return json({loggedOut:true},200,cors);
      }

      if(request.method==="GET"&&url.pathname==="/api/catalog"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const category=String(url.searchParams.get("category")||"");
        if(!["services","soins","laverie"].includes(category))return json({error:"Catalogue invalide"},400,cors);
        const result=await env.DB.prepare(`SELECT id,category,name,description,price_cents,image_url,badge,featured,position
          FROM catalog_products WHERE category=? AND active=1 ORDER BY position,id`).bind(category).all();
        return json({products:result.results.map(publicProduct)},200,{...cors,"cache-control":"private, max-age=30"});
      }

      if(request.method==="GET"&&url.pathname==="/api/orders"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        return json({orders:await loadOrders(env,"WHERE o.user_id=?",[viewer.id])},200,cors);
      }

      if(request.method==="POST"&&url.pathname==="/api/orders"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const input=await readJson(request);
        const source=String(input?.source||"panier");
        if(!["services","soins","laverie","panier"].includes(source))return json({error:"Origine invalide"},400,cors);
        const requested=Array.isArray(input?.items)?input.items:[];
        if(!requested.length||requested.length>50)return json({error:"Panier invalide"},400,cors);
        const quantities=new Map();
        for(const item of requested){
          const id=String(item?.productId||"").trim();const quantity=Number(item?.quantity);
          if(!id||!Number.isInteger(quantity)||quantity<1||quantity>99)return json({error:"Article invalide"},400,cors);
          quantities.set(id,(quantities.get(id)||0)+quantity);
        }
        const products=await Promise.all([...quantities.keys()].map(id=>env.DB.prepare(
          "SELECT id,name,price_cents,category FROM catalog_products WHERE id=? AND active=1").bind(id).first()));
        if(products.some(product=>!product))return json({error:"Un article n’est plus disponible"},409,cors);
        const items=products.map(product=>({productId:product.id,name:product.name,quantity:quantities.get(product.id),
          unitPriceCents:Number(product.price_cents),lineTotalCents:Number(product.price_cents)*quantities.get(product.id)}));
        const totalCents=items.reduce((sum,item)=>sum+item.lineTotalCents,0);
        const now=new Date().toISOString();const publicId=String(Date.now())+String(Math.floor(Math.random()*900)+100);
        const result=await env.DB.prepare(`INSERT INTO orders(public_id,user_id,source,status,comment,total_cents,billed,created_at,updated_at)
          VALUES(?,?,?,'pending','',?,0,?,?)`).bind(publicId,viewer.id,source,totalCents,now,now).run();
        try{
          await env.DB.batch(items.map(item=>env.DB.prepare(`INSERT INTO order_items(order_id,product_id,name,unit_price_cents,quantity,line_total_cents)
            VALUES(?,?,?,?,?,?)`).bind(result.meta.last_row_id,item.productId,item.name,item.unitPriceCents,item.quantity,item.lineTotalCents)));
        }catch(error){await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(result.meta.last_row_id).run();throw error;}
        const order=(await loadOrders(env,"WHERE o.id=?",[result.meta.last_row_id]))[0];
        await notifyRealtime(env,"orders");
        const email=await sendOrderEmail(env,"order_confirmation",order,viewer);
        await sendAdminEventPush(env,"Nouvelle commande",`${viewer.first_name} — ${order.items.length} article(s), ${order.total.toFixed(2).replace(".",",")} €`,"orders.html");
        return json({order,email},201,cors);
      }

      if(url.pathname==="/api/paddocks/planning"&&request.method==="GET"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const [reservationResult,hours,datedHours,restrictionResult,requestExceptionResult]=await Promise.all([
          env.DB.prepare(`SELECT id,user_id,name,paddock,date,time,duration FROM paddock_reservations
            WHERE date>=date('now') ORDER BY date,time`).all(),
          loadEffectivePaddockHours(env,parisNow().date),
          loadEffectivePaddockHoursByDate(env,14),
          env.DB.prepare("SELECT date,block_grande_90,block_beudot_90 FROM paddock_restrictions WHERE date>=date('now')").all(),
          env.DB.prepare("SELECT date,is_open,comment FROM paddock_request_exceptions WHERE date>=date('now')").all()
        ]);
        const restrictions={};
        for(const row of restrictionResult.results)restrictions[row.date]={blockGrande90:Boolean(row.block_grande_90),blockBeudot90:Boolean(row.block_beudot_90)};
        const requestExceptions={};
        for(const row of requestExceptionResult.results)requestExceptions[row.date]={open:Boolean(row.is_open),comment:row.comment||""};
        return json({
          reservations:reservationResult.results.map(row=>({id:String(row.id),name:row.name,paddock:row.paddock,
            date:row.date,time:row.time,duration:Number(row.duration),mine:Number(row.user_id)===Number(viewer.id)})),
          horaires:hours,horairesParDate:datedHours,restrictions,requestExceptions,
          viewer:{firstName:viewer.first_name,email:viewer.email,role:viewer.role}
        },200,cors);
      }

      if(url.pathname==="/api/paddocks/reservations"&&request.method==="GET"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const result=await env.DB.prepare(`SELECT id,name,paddock,date,time,duration,created_at
          FROM paddock_reservations WHERE user_id=? AND date>=date('now','-3 days')
          ORDER BY date DESC,time DESC,id DESC`).bind(viewer.id).all();
        return json({reservations:result.results.map(row=>({id:String(row.id),name:row.name,paddock:row.paddock,
          date:row.date,time:row.time,duration:Number(row.duration),createdAt:row.created_at}))},200,cors);
      }

      if(url.pathname==="/api/paddocks/reservations"&&request.method==="POST"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const input=await readJson(request);
        const booking=validatePaddockBooking(input);
        if(booking.error)return json({error:booking.error},400,cors);
        const policyError=await paddockBookingPolicyError(env,booking);
        if(policyError)return json({error:policyError},409,cors);
        const conflict=await env.DB.prepare(`SELECT id FROM paddock_reservations WHERE date=? AND paddock=?
          AND (? < (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER)+duration))
          AND (?+? > (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER))) LIMIT 1`)
          .bind(booking.date,booking.paddock,booking.startMinutes,booking.startMinutes,booking.duration).first();
        if(conflict)return json({error:"Ce créneau vient d’être réservé"},409,cors);
        if(viewer.role==="client"){
          const existing=await env.DB.prepare("SELECT id FROM paddock_reservations WHERE user_id=? AND date=? LIMIT 1")
            .bind(viewer.id,booking.date).first();
          if(existing)return json({error:"Vous avez déjà une réservation ce jour"},409,cors);
        }
        const now=new Date().toISOString();
        const lockKey=crypto.randomUUID();
        try{
          await env.DB.batch([
            env.DB.prepare(`INSERT INTO paddock_reservations(lock_key,user_id,name,email,paddock,date,time,duration,created_at)
              VALUES(?,?,?,?,?,?,?,?,?)`).bind(lockKey,viewer.id,viewer.first_name,viewer.email,booking.paddock,
              booking.date,booking.time,booking.duration,now),
            ...paddockLockStatements(env,{lockKey,date:booking.date,paddock:booking.paddock,startMinutes:booking.startMinutes,duration:booking.duration})
          ]);
        }catch(error){
          if(String(error?.message||error).includes("UNIQUE"))return json({error:"Ce créneau vient d’être réservé"},409,cors);
          throw error;
        }
        const created=await env.DB.prepare("SELECT id FROM paddock_reservations WHERE lock_key=?").bind(lockKey).first();
        await notifyRealtime(env,"paddocks");
        await sendAdminEventPush(env,"Nouvelle réservation paddock",`${viewer.first_name} — ${booking.date} à ${booking.time}`,"paddocks.html");
        return json({reservation:{id:String(created.id),name:viewer.first_name,paddock:booking.paddock,
          date:booking.date,time:booking.time,duration:booking.duration,mine:true},
          confirmationRequested:Boolean(input.confirmationRequested),email:viewer.email},201,cors);
      }

      if(url.pathname==="/api/paddocks/requests"&&request.method==="GET"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const result=await env.DB.prepare(`SELECT id,date,status,comment,created_at,updated_at
          FROM paddock_requests WHERE user_id=? AND date>=date('now','-3 days')
          ORDER BY date DESC,id DESC`).bind(viewer.id).all();
        return json({requests:result.results.map(publicPaddockRequest)},200,cors);
      }

      if(url.pathname==="/api/paddocks/card"&&request.method==="GET"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const account=await loadPaddockAccount(env,viewer.id);
        const offer=await env.DB.prepare("SELECT name,description,price_cents,units,active FROM paddock_card_product WHERE id=1").first();
        const pending=await env.DB.prepare(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
          WHERE o.user_id=? AND o.billed=0 AND o.status NOT IN ('refused','cancelled') AND oi.product_id='paddock-card' LIMIT 1`).bind(viewer.id).first();
        return json({...account,offer:offer?{name:offer.name,description:offer.description||"",price:Number(offer.price_cents)/100,
          units:Number(offer.units),active:Boolean(offer.active)}:null,cardRequestPending:Boolean(pending)},200,cors);
      }

      if(url.pathname==="/api/paddocks/card/request"&&request.method==="POST"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const [offer,card,pending,usageResult]=await Promise.all([
          env.DB.prepare("SELECT * FROM paddock_card_product WHERE id=1 AND active=1").first(),
          env.DB.prepare("SELECT remaining FROM paddock_cards WHERE user_id=?").bind(viewer.id).first(),
          env.DB.prepare(`SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
            WHERE o.user_id=? AND o.billed=0 AND o.status NOT IN ('refused','cancelled') AND oi.product_id='paddock-card' LIMIT 1`).bind(viewer.id).first(),
          env.DB.prepare("SELECT id FROM paddock_usages WHERE user_id=? AND mode='invoice' ORDER BY usage_date,id").bind(viewer.id).all()
        ]);
        if(!offer)return json({error:"Aucune carte n’est disponible actuellement"},409,cors);
        if(card&&Number(card.remaining)>0)return json({error:"Votre carte actuelle possède encore des mises"},409,cors);
        if(pending)return json({error:"Une carte est déjà en attente de facturation"},409,cors);
        const units=Number(offer.units),absorbed=Math.min(units,usageResult.results.length),remaining=Math.max(0,units-absorbed);
        const now=new Date().toISOString(),publicId=`C${Date.now()}${Math.floor(Math.random()*900)+100}`;
        const statements=[
          env.DB.prepare("DELETE FROM paddock_usages WHERE user_id=? AND mode='card'").bind(viewer.id),
          env.DB.prepare(`INSERT INTO paddock_cards(user_id,total,remaining,created_at,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET total=excluded.total,remaining=excluded.remaining,created_at=excluded.created_at,updated_at=excluded.updated_at`)
            .bind(viewer.id,units,remaining,now,now),
          env.DB.prepare(`INSERT INTO orders(public_id,user_id,source,status,comment,total_cents,billed,created_at,updated_at)
            VALUES(?,?,?,'validated',?,?,0,?,?)`).bind(publicId,viewer.id,"panier",offer.description||"",Number(offer.price_cents),now,now),
          env.DB.prepare(`INSERT INTO order_items(order_id,product_id,name,unit_price_cents,quantity,line_total_cents)
            SELECT id,'paddock-card',?,?,1,? FROM orders WHERE public_id=?`).bind(offer.name,Number(offer.price_cents),Number(offer.price_cents),publicId)
        ];
        for(const usage of usageResult.results.slice(0,absorbed))statements.push(env.DB.prepare("UPDATE paddock_usages SET mode='card' WHERE id=? AND user_id=? AND mode='invoice'").bind(usage.id,viewer.id));
        await env.DB.batch(statements);
        const order=(await loadOrders(env,"WHERE o.public_id=?",[publicId]))[0];
        await notifyRealtime(env,"paddock-accounts");await notifyRealtime(env,"orders");
        const email=await sendOrderEmail(env,"order_confirmation",order,viewer);
        await sendAdminEventPush(env,"Nouvelle carte paddock",`${viewer.first_name} — ${units} mises, ${(Number(offer.price_cents)/100).toFixed(2).replace(".",",")} €`,"billing.html");
        return json({card:{total:units,remaining},absorbed,surplus:Math.max(0,usageResult.results.length-units),order,email},201,cors);
      }

      if(url.pathname==="/api/paddocks/requests"&&request.method==="POST"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const input=await readJson(request);
        const date=String(input?.date||"");
        const requestException=await env.DB.prepare("SELECT is_open,comment FROM paddock_request_exceptions WHERE date=?").bind(date).first();
        const dateError=validatePaddockRequestDate(date,{exception:requestException&&{open:Boolean(requestException.is_open),comment:requestException.comment||""}});
        if(dateError)return json({error:dateError},400,cors);
        const now=new Date().toISOString();
        try{
          const result=await env.DB.prepare(`INSERT INTO paddock_requests(user_id,name,email,date,status,comment,created_at,updated_at)
            VALUES(?,?,?,?,'pending','',?,?)`).bind(viewer.id,viewer.first_name,viewer.email,date,now,now).run();
          const created=await env.DB.prepare(`SELECT id,date,status,comment,created_at,updated_at
            FROM paddock_requests WHERE id=?`).bind(result.meta.last_row_id).first();
          await notifyRealtime(env,"paddock-requests");
          await sendAdminEventPush(env,"Nouvelle demande de mise au paddock",`${viewer.first_name} — ${date}`,"liberte.html");
          return json({request:publicPaddockRequest(created),email:viewer.email},201,cors);
        }catch(error){
          if(String(error?.message||error).includes("UNIQUE"))return json({error:"Vous avez déjà une demande pour ce jour"},409,cors);
          throw error;
        }
      }

      const paddockReservationMatch=url.pathname.match(/^\/api\/paddocks\/reservations\/(\d+)$/);
      if(paddockReservationMatch&&request.method==="DELETE"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const reservation=await env.DB.prepare("SELECT id,user_id,lock_key FROM paddock_reservations WHERE id=?")
          .bind(Number(paddockReservationMatch[1])).first();
        if(!reservation)return json({error:"Réservation introuvable"},404,cors);
        if(viewer.role!=="admin"&&Number(reservation.user_id)!==Number(viewer.id))return json({error:"Action interdite"},403,cors);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM paddock_slot_locks WHERE reservation_key=?").bind(reservation.lock_key),
          env.DB.prepare("DELETE FROM paddock_reservations WHERE id=?").bind(reservation.id)
        ]);
        await notifyRealtime(env,"paddocks");
        await sendAdminEventPush(env,"Réservation paddock annulée",`${viewer.first_name} a annulé sa réservation.`,"paddocks.html");
        return json({deleted:true},200,cors);
      }

      if(url.pathname.startsWith("/api/admin/")){
        if(!isAdmin(request,env))return json({error:"Non autorisé"},401,cors);

        if(request.method==="GET"&&url.pathname==="/api/admin/theme"){
          return json(await readThemeConfig(env),200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/theme"){
          const input=await readJson(request);
          const theme=String(input?.theme||"").trim().toLowerCase();
          const result=await publishThemeConfig(env,theme);
          return json(result,200,cors);
        }

        if(url.pathname==="/api/admin/push/subscription"&&(request.method==="PUT"||request.method==="DELETE")){
          const input=await readJson(request);const subscriptionId=String(input?.subscriptionId||"").trim();
          if(!isValidPushSubscriptionId(subscriptionId))return json({error:"Abonnement push invalide"},400,cors);
          if(request.method==="PUT"){
            const now=new Date().toISOString();
            await env.DB.prepare(`INSERT INTO admin_push_subscriptions(subscription_id,created_at,updated_at) VALUES(?,?,?)
              ON CONFLICT(subscription_id) DO UPDATE SET updated_at=excluded.updated_at`).bind(subscriptionId,now,now).run();
            return json({registered:true},200,cors);
          }
          await env.DB.prepare("DELETE FROM admin_push_subscriptions WHERE subscription_id=?").bind(subscriptionId).run();
          return json({deleted:true},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/operations"){
          return json(await loadOperations(env),200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/planning"){
          const week=validWeekStart(url.searchParams.get("week"));
          if(!week)return json({error:"Semaine invalide"},400,cors);
          const planning=await loadPlanning(env,week);
          const requests=await env.DB.prepare(`SELECT id,user_id,name,email,date,status,comment FROM paddock_requests
            WHERE date>=? AND date<=date(?, '+6 days') AND status='accepted' ORDER BY date,name`).bind(week,week).all();
          return json({...planning,requests:requests.results.map(publicPaddockRequest)},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/horses"){
          const input=await readJson(request);const week=validWeekStart(input?.weekStart);const name=String(input?.name||"").trim();
          if(!week||!name||name.length>80)return json({error:"Semaine ou nom du cheval invalide"},400,cors);
          const now=new Date().toISOString();
          await env.DB.prepare(`INSERT INTO planning_horses(name,active,created_at,updated_at) VALUES(?,1,?,?)
            ON CONFLICT(name) DO UPDATE SET active=1,updated_at=excluded.updated_at`).bind(name,now,now).run();
          const horse=await env.DB.prepare("SELECT id FROM planning_horses WHERE name=? COLLATE NOCASE").bind(name).first();
          const pos=await env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM planning_week_horses WHERE week_start=?").bind(week).first();
          await env.DB.prepare(`INSERT OR IGNORE INTO planning_week_horses(week_start,horse_id,position) VALUES(?,?,?)`).bind(week,horse.id,pos.n).run();
          await notifyRealtime(env,"planning");
          return json(await loadPlanning(env,week),201,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/duplicate-horses"){
          const input=await readJson(request);const from=validWeekStart(input?.fromWeek);const to=validWeekStart(input?.toWeek);
          if(!from||!to||from===to)return json({error:"Semaines invalides"},400,cors);
          await env.DB.prepare(`INSERT OR IGNORE INTO planning_week_horses(week_start,horse_id,position)
            SELECT ?,horse_id,position FROM planning_week_horses WHERE week_start=?`).bind(to,from).run();
          await notifyRealtime(env,"planning");return json(await loadPlanning(env,to),200,cors);
        }

        const adminWeekHorse=url.pathname.match(/^\/api\/admin\/planning\/weeks\/(\d{4}-\d{2}-\d{2})\/horses\/(\d+)$/);
        if(adminWeekHorse&&request.method==="DELETE"){
          await env.DB.batch([
            env.DB.prepare("DELETE FROM planning_tasks WHERE week_start=? AND horse_id=?").bind(adminWeekHorse[1],Number(adminWeekHorse[2])),
            env.DB.prepare("DELETE FROM planning_week_horses WHERE week_start=? AND horse_id=?").bind(adminWeekHorse[1],Number(adminWeekHorse[2]))
          ]);
          await notifyRealtime(env,"planning");return json({deleted:true},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/tasks"){
          const input=await readJson(request);const validated=validatePlanningTask(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const membership=await env.DB.prepare("SELECT 1 ok FROM planning_week_horses WHERE week_start=? AND horse_id=?")
            .bind(validated.weekStart,validated.horseId).first();
          if(!membership)return json({error:"Cheval absent de cette semaine"},409,cors);
          if(validated.requestId){const linked=await env.DB.prepare("SELECT id FROM paddock_requests WHERE id=? AND status='accepted'").bind(validated.requestId).first();if(!linked)return json({error:"Seule une demande acceptée peut être liée au planning"},409,cors);}
          const now=new Date().toISOString();
          if(validated.employeeId&&!await planningEmployeeAvailable(env,validated.employeeId,validated.weekStart,validated.dayIndex))
            return json({error:"Ce salarié ne travaille pas ce jour-là"},409,cors);
          try{const result=await env.DB.prepare(`INSERT INTO planning_tasks(week_start,horse_id,day_index,type,description,paddock,starts_at,ends_at,request_id,employee_id,position,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`).bind(validated.weekStart,validated.horseId,validated.dayIndex,validated.type,validated.description,validated.paddock,validated.startsAt,validated.endsAt,validated.requestId,validated.employeeId,now,now).run();
            const task=await env.DB.prepare("SELECT * FROM planning_tasks WHERE id=?").bind(result.meta.last_row_id).first();await notifyRealtime(env,"planning");return json({task:publicPlanningTask(task)},201,cors);
          }catch(error){if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cette demande est déjà liée au planning"},409,cors);throw error;}
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/tasks/batch"){
          const input=await readJson(request);const days=[...new Set((Array.isArray(input?.dayIndexes)?input.dayIndexes:[]).map(Number))].sort((a,b)=>a-b);
          if(!days.length||days.length>7||days.some(day=>!Number.isInteger(day)||day<0||day>6))return json({error:"Sélection de jours invalide"},400,cors);
          if(input?.requestId&&days.length>1)return json({error:"Une demande de mise au paddock ne peut être liée qu’à une seule journée"},409,cors);
          const tasks=days.map(dayIndex=>validatePlanningTask({...input,dayIndex}));const invalid=tasks.find(task=>task.error);
          if(invalid)return json({error:invalid.error},400,cors);
          const membership=await env.DB.prepare("SELECT 1 ok FROM planning_week_horses WHERE week_start=? AND horse_id=?")
            .bind(tasks[0].weekStart,tasks[0].horseId).first();
          if(!membership)return json({error:"Cheval absent de cette semaine"},409,cors);
          if(tasks[0].requestId){const linked=await env.DB.prepare("SELECT id FROM paddock_requests WHERE id=? AND status='accepted'").bind(tasks[0].requestId).first();if(!linked)return json({error:"Seule une demande acceptée peut être liée au planning"},409,cors);}
          if(tasks[0].employeeId){
            const availability=await Promise.all(tasks.map(task=>planningEmployeeAvailable(env,task.employeeId,task.weekStart,task.dayIndex)));
            if(availability.some(value=>!value))return json({error:"Ce salarié ne travaille pas tous les jours sélectionnés"},409,cors);
          }
          const now=new Date().toISOString();
          try{await env.DB.batch(tasks.map(task=>env.DB.prepare(`INSERT INTO planning_tasks(week_start,horse_id,day_index,type,description,paddock,starts_at,ends_at,request_id,employee_id,position,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?)`).bind(task.weekStart,task.horseId,task.dayIndex,task.type,task.description,task.paddock,
              task.startsAt,task.endsAt,task.requestId,task.employeeId,now,now)));}
          catch(error){if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cette demande est déjà liée au planning"},409,cors);throw error;}
          await notifyRealtime(env,"planning");return json({created:tasks.length,planning:await loadPlanning(env,tasks[0].weekStart)},201,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/reorder"){
          const input=await readJson(request);const week=validWeekStart(input?.weekStart);
          if(!week)return json({error:"Semaine invalide"},400,cors);
          if(Array.isArray(input?.horseIds)){
            const horseIds=input.horseIds.map(Number);
            if(horseIds.some(id=>!Number.isInteger(id)||id<1)||new Set(horseIds).size!==horseIds.length)return json({error:"Ordre des chevaux invalide"},400,cors);
            const statements=horseIds.map((id,position)=>env.DB.prepare(`UPDATE planning_week_horses SET position=?
              WHERE week_start=? AND horse_id=?`).bind(position,week,id));
            if(statements.length)await env.DB.batch(statements);
          }
          if(input?.task){
            const taskId=Number(input.task.id),horseId=Number(input.task.horseId),dayIndex=Number(input.task.dayIndex),position=Number(input.task.position||0);
            if(!Number.isInteger(taskId)||!Number.isInteger(horseId)||!Number.isInteger(dayIndex)||dayIndex<0||dayIndex>6||!Number.isInteger(position)||position<0)return json({error:"Déplacement de tâche invalide"},400,cors);
            const membership=await env.DB.prepare("SELECT 1 ok FROM planning_week_horses WHERE week_start=? AND horse_id=?").bind(week,horseId).first();
            if(!membership)return json({error:"Cheval absent de cette semaine"},409,cors);
            await env.DB.prepare("UPDATE planning_tasks SET horse_id=?,day_index=?,position=?,updated_at=? WHERE id=? AND week_start=?")
              .bind(horseId,dayIndex,position,new Date().toISOString(),taskId,week).run();
          }
          await notifyRealtime(env,"planning");return json(await loadPlanning(env,week),200,cors);
        }

        const adminTask=url.pathname.match(/^\/api\/admin\/planning\/tasks\/(\d+)$/);
        if(adminTask&&request.method==="DELETE"){
          await env.DB.prepare("DELETE FROM planning_tasks WHERE id=?").bind(Number(adminTask[1])).run();
          await notifyRealtime(env,"planning");return json({deleted:true},200,cors);
        }
        if(adminTask&&request.method==="PATCH"){
          const current=await env.DB.prepare("SELECT * FROM planning_tasks WHERE id=?").bind(Number(adminTask[1])).first();
          if(!current)return json({error:"Tâche introuvable"},404,cors);
          const input=await readJson(request);
          const edits=["horseId","dayIndex","type","description","paddock","startsAt","endsAt","requestId","employeeId"].some(key=>input[key]!==undefined);
          if(edits){
            const validated=validatePlanningTask({weekStart:current.week_start,horseId:input.horseId??current.horse_id,
              dayIndex:input.dayIndex??current.day_index,type:input.type??current.type,description:input.description??current.description,
              paddock:input.paddock??current.paddock,startsAt:input.startsAt??current.starts_at,endsAt:input.endsAt??current.ends_at,
              requestId:input.requestId===undefined?current.request_id:input.requestId,
              employeeId:input.employeeId===undefined?current.employee_id:input.employeeId});
            if(validated.error)return json({error:validated.error},400,cors);
            if(validated.requestId&&Number(validated.requestId)!==Number(current.request_id)){
              const linked=await env.DB.prepare("SELECT id FROM paddock_requests WHERE id=? AND status='accepted'").bind(validated.requestId).first();
              if(!linked)return json({error:"Seule une demande acceptée peut être liée au planning"},409,cors);
            }
            const assignmentChanged=Number(validated.employeeId||0)!==Number(current.employee_id||0)
              ||Number(validated.dayIndex)!==Number(current.day_index);
            if(assignmentChanged&&validated.employeeId&&!await planningEmployeeAvailable(env,validated.employeeId,validated.weekStart,validated.dayIndex))
              return json({error:"Ce salarié ne travaille pas ce jour-là"},409,cors);
            try{await env.DB.prepare(`UPDATE planning_tasks SET horse_id=?,day_index=?,type=?,description=?,paddock=?,starts_at=?,ends_at=?,request_id=?,employee_id=?,updated_at=? WHERE id=?`)
              .bind(validated.horseId,validated.dayIndex,validated.type,validated.description,validated.paddock,validated.startsAt,
                validated.endsAt,validated.requestId,validated.employeeId,new Date().toISOString(),current.id).run();}
            catch(error){if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cette demande est déjà liée au planning"},409,cors);throw error;}
          }
          if(input.completed===false){await env.DB.prepare("UPDATE planning_tasks SET completed_at=NULL,completed_by=NULL,updated_at=? WHERE id=?").bind(new Date().toISOString(),current.id).run();}
          else if(input.completed===true&&!current.completed_at){if(current.request_id)await completePaddockRequest(env,Number(current.request_id),"Réalisée depuis le planning");const now=new Date().toISOString();await env.DB.prepare("UPDATE planning_tasks SET completed_at=?,completed_by='backstage',updated_at=? WHERE id=?").bind(now,now,current.id).run();}
          await notifyRealtime(env,"planning");const updated=await env.DB.prepare("SELECT * FROM planning_tasks WHERE id=?").bind(current.id).first();return json({task:publicPlanningTask(updated)},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/planning/device-token"){
          const input=await readJson(request);const label=String(input?.label||"Tablette planning").trim().slice(0,80)||"Tablette planning";
          const token=crypto.randomUUID()+crypto.randomUUID();const now=new Date().toISOString();
          await env.DB.prepare("UPDATE planning_kiosk_devices SET active=0,updated_at=?").bind(now).run();
          await env.DB.prepare("INSERT INTO planning_kiosk_devices(label,token_hash,active,created_at,updated_at) VALUES(?,?,1,?,?)")
            .bind(label,await sha256(token),now,now).run();
          return json({token,label,createdAt:now},201,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/staff-planning"){
          const month=validStaffMonth(url.searchParams.get("month"));
          if(!month)return json({error:"Mois invalide"},400,cors);
          const range=staffMonthRange(month);
          const [employeeResult,shiftResult]=await Promise.all([
            env.DB.prepare(`SELECT id,name,color,active,position,created_at,updated_at
              FROM staff_employees WHERE active=1 ORDER BY position,name`).all(),
            env.DB.prepare(`SELECT id,employee_id,work_date,status,morning_start,morning_end,
              afternoon_start,afternoon_end,note,created_at,updated_at
              FROM staff_shifts WHERE work_date>=? AND work_date<=?
              ORDER BY work_date,employee_id`).bind(range.start,range.end).all()
          ]);
          return json({month,range,employees:employeeResult.results.map(publicStaffEmployee),
            shifts:shiftResult.results.map(publicStaffShift)},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/google-calendar/status"){
          const configured=googleCalendarIcalUrls(env).length>0;
          return json({configured,connected:configured,
            calendarName:configured?"Calendriers Damien Siri":""},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/google-calendar/events"){
          const month=validStaffMonth(url.searchParams.get("month"));
          if(!month)return json({error:"Mois invalide"},400,cors);
          const urls=googleCalendarIcalUrls(env);
          if(!urls.length)return json({configured:false,connected:false,events:[]},200,cors);
          const forceRefresh=url.searchParams.get("refresh")==="1";
          const colors=["#F28C28","#5B8DEF","#47A66A"];
          const calendars=await Promise.allSettled(urls.map(async(calendarUrl,index)=>{
            const separator=calendarUrl.includes("?")?"&":"?";
            const requestUrl=forceRefresh?`${calendarUrl}${separator}_refresh=${Date.now()}`:calendarUrl;
            const response=await fetch(requestUrl,{headers:{accept:"text/calendar",
              ...(forceRefresh?{"cache-control":"no-cache"}:{})},cf:{cacheTtl:forceRefresh?0:300}});
            if(!response.ok)throw new Error(`Calendrier iCal inaccessible (${response.status})`);
            return parseIcsCalendar(await response.text(),month,{index,color:colors[index%colors.length]});
          }));
          const available=calendars.filter(result=>result.status==="fulfilled");
          if(!available.length)throw new Error("Impossible de lire les calendriers iCal");
          const unique=new Map();
          for(const result of available){
            for(const event of result.value)unique.set(`${event.id}|${event.start}`,event);
          }
          const events=[...unique.values()].sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title,"fr"));
          return json({configured:true,connected:true,calendarName:"Calendriers Damien Siri",
            events,calendarCount:available.length,refreshed:forceRefresh},200,
            {...cors,"cache-control":forceRefresh?"private, no-store":"private, max-age=60"});
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/staff-planning/employees"){
          const input=await readJson(request);const name=String(input?.name||"").trim();
          const color=validStaffColor(input?.color);
          if(!name||name.length>80)return json({error:"Nom du salarié invalide"},400,cors);
          const now=new Date().toISOString();
          const position=await env.DB.prepare("SELECT COALESCE(MAX(position),-1)+1 AS n FROM staff_employees").first();
          try{
            const result=await env.DB.prepare(`INSERT INTO staff_employees(name,color,active,position,created_at,updated_at)
              VALUES(?,?,1,?,?,?)`).bind(name,color,Number(position?.n||0),now,now).run();
            const employee=await env.DB.prepare("SELECT * FROM staff_employees WHERE id=?").bind(result.meta.last_row_id).first();
            await notifyRealtime(env,"staff-planning");
            return json({employee:publicStaffEmployee(employee)},201,cors);
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Ce salarié existe déjà"},409,cors);
            throw error;
          }
        }

        const staffEmployee=url.pathname.match(/^\/api\/admin\/staff-planning\/employees\/(\d+)$/);
        if(staffEmployee&&request.method==="DELETE"){
          const employeeId=Number(staffEmployee[1]);
          const current=await env.DB.prepare("SELECT * FROM staff_employees WHERE id=? AND active=1").bind(employeeId).first();
          if(!current)return json({error:"Salarié introuvable"},404,cors);
          const activeCount=await env.DB.prepare("SELECT COUNT(*) AS n FROM staff_employees WHERE active=1").first();
          if(Number(activeCount?.n||0)<=1)return json({error:"Le planning doit conserver au moins un salarié"},409,cors);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM staff_shifts WHERE employee_id=?").bind(employeeId),
            env.DB.prepare("DELETE FROM staff_employees WHERE id=?").bind(employeeId)
          ]);
          await notifyRealtime(env,"staff-planning");
          return json({deleted:true},200,cors);
        }

        if(staffEmployee&&request.method==="PATCH"){
          const current=await env.DB.prepare("SELECT * FROM staff_employees WHERE id=?").bind(Number(staffEmployee[1])).first();
          if(!current)return json({error:"Salarié introuvable"},404,cors);
          const input=await readJson(request);
          const name=String(input?.name??current.name).trim();
          const color=validStaffColor(input?.color??current.color);
          const active=input?.active===undefined?Number(current.active):input.active?1:0;
          if(!name||name.length>80)return json({error:"Nom du salarié invalide"},400,cors);
          if(!active){
            const activeCount=await env.DB.prepare("SELECT COUNT(*) AS n FROM staff_employees WHERE active=1").first();
            if(Number(activeCount?.n||0)<=1)return json({error:"Le planning doit conserver au moins un salarié actif"},409,cors);
          }
          try{
            await env.DB.prepare("UPDATE staff_employees SET name=?,color=?,active=?,updated_at=? WHERE id=?")
              .bind(name,color,active,new Date().toISOString(),current.id).run();
            const employee=await env.DB.prepare("SELECT * FROM staff_employees WHERE id=?").bind(current.id).first();
            await notifyRealtime(env,"staff-planning");
            return json({employee:publicStaffEmployee(employee)},200,cors);
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Ce salarié existe déjà"},409,cors);
            throw error;
          }
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/staff-planning/copy-week"){
          const input=await readJson(request);
          const sourceStart=String(input?.sourceStart||"");
          const targetStart=String(input?.targetStart||"");
          if(!isStaffWeekStart(sourceStart)||!isStaffWeekStart(targetStart))
            return json({error:"Les semaines source et destination doivent commencer un lundi"},400,cors);
          if(sourceStart===targetStart)return json({error:"Choisissez deux semaines différentes"},400,cors);
          const sourceEnd=addIsoDays(sourceStart,6);const targetEnd=addIsoDays(targetStart,6);
          const delta=Math.round((Date.parse(targetStart+"T12:00:00Z")-Date.parse(sourceStart+"T12:00:00Z"))/86400000);
          const now=new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM staff_shifts WHERE work_date>=? AND work_date<=?
              AND employee_id IN (SELECT id FROM staff_employees WHERE active=1)`).bind(targetStart,targetEnd),
            env.DB.prepare(`INSERT INTO staff_shifts(employee_id,work_date,status,morning_start,morning_end,
              afternoon_start,afternoon_end,note,created_at,updated_at)
              SELECT s.employee_id,date(s.work_date,?),s.status,s.morning_start,s.morning_end,
                s.afternoon_start,s.afternoon_end,s.note,?,?
              FROM staff_shifts s JOIN staff_employees e ON e.id=s.employee_id
              WHERE e.active=1 AND s.work_date>=? AND s.work_date<=?`)
              .bind(`${delta>=0?"+":""}${delta} days`,now,now,sourceStart,sourceEnd)
          ]);
          await notifyRealtime(env,"staff-planning");
          return json({copied:true,sourceStart,targetStart},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/staff-planning/copy-month"){
          const input=await readJson(request);
          const sourceMonth=validStaffMonth(input?.sourceMonth);
          const targetMonth=validStaffMonth(input?.targetMonth);
          if(!sourceMonth||!targetMonth)return json({error:"Mois source ou destination invalide"},400,cors);
          if(sourceMonth===targetMonth)return json({error:"Choisissez deux mois différents"},400,cors);
          const now=new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare(`DELETE FROM staff_shifts
              WHERE work_date>=?||'-01' AND work_date<date(?||'-01','+1 month')
              AND employee_id IN (SELECT id FROM staff_employees WHERE active=1)`).bind(targetMonth,targetMonth),
            env.DB.prepare(`INSERT INTO staff_shifts(employee_id,work_date,status,morning_start,morning_end,
              afternoon_start,afternoon_end,note,created_at,updated_at)
              SELECT s.employee_id,?||substr(s.work_date,8,3),s.status,s.morning_start,s.morning_end,
                s.afternoon_start,s.afternoon_end,s.note,?,?
              FROM staff_shifts s JOIN staff_employees e ON e.id=s.employee_id
              WHERE e.active=1 AND s.work_date>=?||'-01' AND s.work_date<date(?||'-01','+1 month')
                AND CAST(substr(s.work_date,9,2) AS INTEGER)<=CAST(strftime('%d',date(?||'-01','+1 month','-1 day')) AS INTEGER)`)
              .bind(targetMonth,now,now,sourceMonth,sourceMonth,targetMonth)
          ]);
          await notifyRealtime(env,"staff-planning");
          return json({copied:true,sourceMonth,targetMonth},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/staff-planning/shift-range"){
          const input=await readJson(request);
          const employeeId=Number(input?.employeeId);
          const status=String(input?.status||"").toLowerCase();
          const startDate=String(input?.startDate||"");
          const endDate=String(input?.endDate||"");
          const note=String(input?.note||"").trim();
          if(!Number.isInteger(employeeId)||employeeId<1)return json({error:"Salarié invalide"},400,cors);
          if(!["leave","sick"].includes(status))return json({error:"La période doit être un congé ou un arrêt maladie"},400,cors);
          if(!isIsoDate(startDate)||!isIsoDate(endDate)||endDate<startDate)return json({error:"Période invalide"},400,cors);
          const dayCount=Math.round((Date.parse(endDate+"T12:00:00Z")-Date.parse(startDate+"T12:00:00Z"))/86400000)+1;
          if(dayCount>366)return json({error:"La période ne peut pas dépasser 366 jours"},400,cors);
          if(note.length>200)return json({error:"Note trop longue"},400,cors);
          const employee=await env.DB.prepare("SELECT id FROM staff_employees WHERE id=? AND active=1").bind(employeeId).first();
          if(!employee)return json({error:"Salarié introuvable"},404,cors);
          const now=new Date().toISOString();
          const statements=[];
          for(let date=startDate;date<=endDate;date=addIsoDays(date,1)){
            statements.push(env.DB.prepare(`INSERT INTO staff_shifts(employee_id,work_date,status,morning_start,morning_end,
              afternoon_start,afternoon_end,note,created_at,updated_at) VALUES(?,?,?,NULL,NULL,NULL,NULL,?,?,?)
              ON CONFLICT(employee_id,work_date) DO UPDATE SET status=excluded.status,morning_start=NULL,morning_end=NULL,
              afternoon_start=NULL,afternoon_end=NULL,note=excluded.note,updated_at=excluded.updated_at`)
              .bind(employeeId,date,status,note,now,now));
          }
          await env.DB.batch(statements);
          await notifyRealtime(env,"staff-planning");
          return json({saved:true,dayCount,startDate,endDate,status},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/staff-planning/shifts"){
          const input=await readJson(request);const shift=validateStaffShift(input);
          if(shift.error)return json({error:shift.error},400,cors);
          const employee=await env.DB.prepare("SELECT id FROM staff_employees WHERE id=? AND active=1").bind(shift.employeeId).first();
          if(!employee)return json({error:"Salarié introuvable"},404,cors);
          const now=new Date().toISOString();
          await env.DB.prepare(`INSERT INTO staff_shifts(employee_id,work_date,status,morning_start,morning_end,
            afternoon_start,afternoon_end,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(employee_id,work_date) DO UPDATE SET status=excluded.status,
              morning_start=excluded.morning_start,morning_end=excluded.morning_end,
              afternoon_start=excluded.afternoon_start,afternoon_end=excluded.afternoon_end,
              note=excluded.note,updated_at=excluded.updated_at`)
            .bind(shift.employeeId,shift.date,shift.status,shift.morningStart,shift.morningEnd,
              shift.afternoonStart,shift.afternoonEnd,shift.note,now,now).run();
          const saved=await env.DB.prepare("SELECT * FROM staff_shifts WHERE employee_id=? AND work_date=?")
            .bind(shift.employeeId,shift.date).first();
          await notifyRealtime(env,"staff-planning");
          return json({shift:publicStaffShift(saved)},200,cors);
        }

        const staffShift=url.pathname.match(/^\/api\/admin\/staff-planning\/shifts\/(\d+)\/(\d{4}-\d{2}-\d{2})$/);
        if(staffShift&&request.method==="DELETE"){
          await env.DB.prepare("DELETE FROM staff_shifts WHERE employee_id=? AND work_date=?")
            .bind(Number(staffShift[1]),staffShift[2]).run();
          await notifyRealtime(env,"staff-planning");
          return json({deleted:true},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/users"){
          const result=await env.DB.prepare(`SELECT id,email,first_name,last_name,card_number,role,status,approval_status,
            must_change_password,created_at,updated_at,last_login_at,
            (SELECT total FROM paddock_cards WHERE user_id=users.id) AS paddock_card_total,
            (SELECT remaining FROM paddock_cards WHERE user_id=users.id) AS paddock_card_remaining,
            (SELECT COUNT(*) FROM paddock_usages WHERE user_id=users.id AND mode='invoice') AS paddock_invoice_count,
            (SELECT COALESCE(SUM(total_cents),0) FROM orders WHERE user_id=users.id AND billed=0
              AND status NOT IN ('refused','cancelled')) AS order_due_cents
            FROM users ORDER BY last_name,first_name`).all();
          return json(result.results.map(row=>({...publicUser(row),paddockCard:row.paddock_card_total===null?null:{
            total:Number(row.paddock_card_total),remaining:Number(row.paddock_card_remaining)},paddockInvoiceCount:Number(row.paddock_invoice_count),
            orderDue:Number(row.order_due_cents)/100})),200,cors);
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

        if(request.method==="GET"&&url.pathname==="/api/admin/orders"){
          return json({orders:await loadOrders(env,"",[])},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/orders"){
          const input=await readJson(request);
          const userId=Number(input?.userId);
          const source=String(input?.source||"panier");
          const status=String(input?.status||"pending");
          const comment=String(input?.comment||"").trim();
          const billed=Boolean(input?.billed);
          const sendEmail=Boolean(input?.sendEmail);
          if(!Number.isInteger(userId)||userId<1)return json({error:"Client invalide"},400,cors);
          if(!["services","soins","laverie","panier"].includes(source))return json({error:"Origine invalide"},400,cors);
          if(!["pending","validated","refused","ready","completed","cancelled"].includes(status))return json({error:"Statut invalide"},400,cors);
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          const requested=Array.isArray(input?.items)?input.items:[];
          if(!requested.length||requested.length>50)return json({error:"Panier invalide"},400,cors);
          const user=await env.DB.prepare(`SELECT * FROM users WHERE id=? AND status='active'
            AND COALESCE(approval_status,'approved')='approved'`).bind(userId).first();
          if(!user)return json({error:"Client introuvable ou non validé"},404,cors);
          const quantities=new Map();
          for(const item of requested){
            const id=String(item?.productId||"").trim();
            const quantity=Number(item?.quantity);
            if(!id||!Number.isInteger(quantity)||quantity<1||quantity>99)return json({error:"Article invalide"},400,cors);
            quantities.set(id,(quantities.get(id)||0)+quantity);
          }
          const products=await Promise.all([...quantities.keys()].map(id=>env.DB.prepare(
            "SELECT id,name,price_cents,category FROM catalog_products WHERE id=? AND active=1").bind(id).first()));
          if(products.some(product=>!product))return json({error:"Un article n’est plus disponible"},409,cors);
          const items=products.map(product=>({productId:product.id,name:product.name,quantity:quantities.get(product.id),
            unitPriceCents:Number(product.price_cents),lineTotalCents:Number(product.price_cents)*quantities.get(product.id)}));
          const totalCents=items.reduce((sum,item)=>sum+item.lineTotalCents,0);
          const now=new Date().toISOString();
          const publicId=`M${Date.now()}${Math.floor(Math.random()*900)+100}`;
          const result=await env.DB.prepare(`INSERT INTO orders(public_id,user_id,source,status,comment,total_cents,billed,billed_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(publicId,user.id,source,status,comment,totalCents,billed?1:0,billed?now:null,now,now).run();
          try{
            await env.DB.batch(items.map(item=>env.DB.prepare(`INSERT INTO order_items(order_id,product_id,name,unit_price_cents,quantity,line_total_cents)
              VALUES(?,?,?,?,?,?)`).bind(result.meta.last_row_id,item.productId,item.name,item.unitPriceCents,item.quantity,item.lineTotalCents)));
          }catch(error){await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(result.meta.last_row_id).run();throw error;}
          const order=(await loadOrders(env,"WHERE o.id=?",[result.meta.last_row_id]))[0];
          await notifyRealtime(env,"orders");
          const email=sendEmail?await sendOrderEmail(env,"order_confirmation",order,user):{requested:false,sent:false};
          return json({order,email},201,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/billing"){
          const [usageResult,orders]=await Promise.all([
            env.DB.prepare(`SELECT pu.id,pu.user_id,pu.request_id,pu.usage_date,pu.created_at,
              u.first_name,u.last_name,u.email
              FROM paddock_usages pu JOIN users u ON u.id=pu.user_id
              WHERE pu.mode='invoice'
              ORDER BY u.last_name,u.first_name,pu.usage_date,pu.id`).all(),
            loadOrders(env,"WHERE o.billed=0 AND o.status NOT IN ('refused','cancelled')",[])
          ]);
          const customers=new Map();
          const ensureCustomer=(userId,customer)=>{
            const key=Number(userId);
            if(!customers.has(key))customers.set(key,{userId:key,customer,paddockUsages:[],orders:[],orderDue:0});
            return customers.get(key);
          };
          for(const row of usageResult.results){
            ensureCustomer(row.user_id,{firstName:row.first_name,lastName:row.last_name,email:row.email}).paddockUsages.push({
              id:String(row.id),requestId:String(row.request_id),date:row.usage_date,createdAt:row.created_at
            });
          }
          for(const order of orders){
            const customer=ensureCustomer(order.userId,order.customer);customer.orders.push(order);customer.orderDue+=order.total;
          }
          return json({customers:[...customers.values()].sort((a,b)=>
            `${a.customer.lastName} ${a.customer.firstName}`.localeCompare(`${b.customer.lastName} ${b.customer.firstName}`,"fr")
          )},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/catalog"){
          const result=await env.DB.prepare(`SELECT id,category,name,description,price_cents,image_url,badge,featured,active,position,updated_at
            FROM catalog_products ORDER BY category,position,id`).all();
          return json({products:result.results.map(row=>({...publicProduct(row),active:Boolean(row.active),updatedAt:row.updated_at}))},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/card-product"){
          const row=await env.DB.prepare("SELECT name,description,price_cents,units,active,updated_at FROM paddock_card_product WHERE id=1").first();
          return json({product:row?{name:row.name,description:row.description||"",price:Number(row.price_cents)/100,units:Number(row.units),active:Boolean(row.active),updatedAt:row.updated_at}:null},200,cors);
        }
        if(request.method==="PUT"&&url.pathname==="/api/admin/card-product"){
          const input=await readJson(request),name=String(input?.name||"").trim(),description=String(input?.description||"").trim();
          const price=Number(input?.price),units=Number(input?.units),active=Boolean(input?.active);
          if(!name||name.length>120||description.length>1000)return json({error:"Contenu de carte invalide"},400,cors);
          if(!Number.isFinite(price)||price<0||price>100000)return json({error:"Prix invalide"},400,cors);
          if(!Number.isInteger(units)||units<1||units>999)return json({error:"Nombre de mises invalide"},400,cors);
          const now=new Date().toISOString();
          await env.DB.prepare(`INSERT INTO paddock_card_product(id,name,description,price_cents,units,active,updated_at) VALUES(1,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,price_cents=excluded.price_cents,
            units=excluded.units,active=excluded.active,updated_at=excluded.updated_at`).bind(name,description,Math.round(price*100),units,active?1:0,now).run();
          return json({saved:true},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/catalog/image"){
          const contentType=String(request.headers.get("content-type")||"").split(";")[0].toLowerCase();
          if(!["image/jpeg","image/png","image/webp"].includes(contentType))return json({error:"Format d’image invalide"},400,cors);
          const data=await request.arrayBuffer();
          if(!data.byteLength||data.byteLength>5*1024*1024)return json({error:"Image trop volumineuse (5 Mo maximum)"},413,cors);
          const extension=contentType==="image/png"?"png":contentType==="image/jpeg"?"jpg":"webp";
          const key=`catalog-${crypto.randomUUID()}.${extension}`;
          await env.PRODUCT_IMAGES.put(key,data,{httpMetadata:{contentType}});
          return json({url:`${url.origin}/api/catalog/images/${key}`},201,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/catalog"){
          const input=await readJson(request);
          const last=await env.DB.prepare("SELECT COALESCE(MAX(position),0) AS position FROM catalog_products WHERE category=?")
            .bind(String(input?.category||"")).first();
          const product=validateCatalogProduct({...input,position:Number(last?.position||0)+1},true);
          if(product.error)return json({error:product.error},400,cors);
          const now=new Date().toISOString();
          try{
            await env.DB.prepare(`INSERT INTO catalog_products(id,category,name,description,price_cents,image_url,badge,featured,active,position,updated_at)
              VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(product.id,product.category,product.name,product.description,product.priceCents,
              product.image,product.badge,product.featured?1:0,product.active?1:0,product.position,now).run();
          }catch(error){if(String(error?.message||error).includes("UNIQUE"))return json({error:"Cet identifiant existe déjà"},409,cors);throw error;}
          if(product.featured)await env.DB.prepare("UPDATE catalog_products SET featured=0 WHERE category=? AND id<>?")
            .bind(product.category,product.id).run();
          await notifyRealtime(env,"catalog");
          return json({created:true,id:product.id},201,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/catalog/reorder"){
          const input=await readJson(request);const category=String(input?.category||"");
          const ids=Array.isArray(input?.ids)?input.ids.map(String):[];
          if(!["services","soins","laverie"].includes(category)||!ids.length||new Set(ids).size!==ids.length||
            ids.some(id=>!/^[A-Za-z0-9_-]{1,40}$/.test(id)))return json({error:"Ordre invalide"},400,cors);
          const rows=await env.DB.prepare("SELECT id FROM catalog_products WHERE category=? AND active=1 ORDER BY position,id").bind(category).all();
          const expected=rows.results.map(row=>row.id);
          if(expected.length!==ids.length||expected.some(id=>!ids.includes(id)))return json({error:"Liste d’articles incomplète"},400,cors);
          const now=new Date().toISOString();
          await env.DB.batch(ids.map((id,index)=>env.DB.prepare("UPDATE catalog_products SET position=?,updated_at=? WHERE id=? AND category=?")
            .bind(index+1,now,id,category)));
          await notifyRealtime(env,"catalog");return json({saved:true},200,cors);
        }

        const adminCatalogMatch=url.pathname.match(/^\/api\/admin\/catalog\/([A-Za-z0-9_-]+)$/);
        if(request.method==="PUT"&&adminCatalogMatch){
          const input=await readJson(request);const product=validateCatalogProduct({...input,id:adminCatalogMatch[1]},false);
          if(product.error)return json({error:product.error},400,cors);
          const result=await env.DB.prepare(`UPDATE catalog_products SET category=?,name=?,description=?,price_cents=?,image_url=?,badge=?,
            featured=?,active=?,position=?,updated_at=? WHERE id=?`).bind(product.category,product.name,product.description,
            product.priceCents,product.image,product.badge,product.featured?1:0,product.active?1:0,product.position,
            new Date().toISOString(),product.id).run();
          if(!result.meta.changes)return json({error:"Article introuvable"},404,cors);
          if(product.featured)await env.DB.prepare("UPDATE catalog_products SET featured=0 WHERE category=? AND id<>?")
            .bind(product.category,product.id).run();
          await notifyRealtime(env,"catalog");return json({saved:true},200,cors);
        }
        if(request.method==="DELETE"&&adminCatalogMatch){
          const used=await env.DB.prepare("SELECT id FROM order_items WHERE product_id=? LIMIT 1").bind(adminCatalogMatch[1]).first();
          if(used){
            await env.DB.prepare("UPDATE catalog_products SET active=0,updated_at=? WHERE id=?")
              .bind(new Date().toISOString(),adminCatalogMatch[1]).run();
            await notifyRealtime(env,"catalog");return json({deleted:false,archived:true},200,cors);
          }
          await env.DB.prepare("DELETE FROM catalog_products WHERE id=?").bind(adminCatalogMatch[1]).run();
          await notifyRealtime(env,"catalog");return json({deleted:true,archived:false},200,cors);
        }

        const adminOrderMatch=url.pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
        if(request.method==="PATCH"&&adminOrderMatch){
          const current=(await loadOrders(env,"WHERE o.id=?",[Number(adminOrderMatch[1])]))[0];
          if(!current)return json({error:"Commande introuvable"},404,cors);
          const input=await readJson(request);
          const status=input.status===undefined?current.status:String(input.status);
          const comment=input.comment===undefined?current.comment:String(input.comment).trim();
          const billed=input.billed===undefined?current.billed:Boolean(input.billed);
          if(!["pending","validated","refused","ready","completed","cancelled"].includes(status))return json({error:"Statut invalide"},400,cors);
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          const now=new Date().toISOString();
          await env.DB.prepare(`UPDATE orders SET status=?,comment=?,billed=?,billed_at=?,updated_at=? WHERE id=?`)
            .bind(status,comment,billed?1:0,billed?(current.billedAt||now):null,now,current.id).run();
          const updated=(await loadOrders(env,"WHERE o.id=?",[current.id]))[0];
          await notifyRealtime(env,"orders");
          let email={requested:false,sent:false};
          if(status!==current.status){
            const user=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(updated.userId).first();
            email=await sendOrderEmail(env,"order_status",updated,user);
          }
          return json({order:updated,email},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/liberte"){
          const [requestResult,exceptionResult,userResult]=await Promise.all([
            env.DB.prepare(`SELECT id,user_id,name,email,date,status,comment,is_free,created_at,updated_at
              FROM paddock_requests ORDER BY date DESC,id DESC`).all(),
            env.DB.prepare(`SELECT date,is_open,comment,updated_at FROM paddock_request_exceptions
              ORDER BY date DESC`).all(),
            env.DB.prepare(`SELECT id,email,first_name,last_name,role,status,approval_status
              FROM users WHERE status='active' AND COALESCE(approval_status,'approved')='approved'
              ORDER BY last_name,first_name`).all()
          ]);
          return json({
            requests:requestResult.results.map(publicAdminPaddockRequest),
            exceptions:exceptionResult.results.map(row=>({date:row.date,open:Boolean(row.is_open),comment:row.comment||"",updatedAt:row.updated_at})),
            users:userResult.results.map(publicUser)
          },200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/liberte/requests"){
          const input=await readJson(request);const userId=Number(input?.userId);const date=String(input?.date||"");
          if(!Number.isInteger(userId)||userId<1)return json({error:"Client invalide"},400,cors);
          const user=await env.DB.prepare(`SELECT * FROM users WHERE id=? AND status='active'
            AND COALESCE(approval_status,'approved')='approved'`).bind(userId).first();
          if(!user)return json({error:"Client actif introuvable"},404,cors);
          const requestException=await env.DB.prepare("SELECT is_open,comment FROM paddock_request_exceptions WHERE date=?").bind(date).first();
          const dateError=validatePaddockRequestDate(date,{exception:requestException&&{open:Boolean(requestException.is_open),comment:requestException.comment||""},ignoreDeadline:true,allowToday:true});
          if(dateError)return json({error:dateError},400,cors);
          const now=new Date().toISOString();
          try{
            const result=await env.DB.prepare(`INSERT INTO paddock_requests(user_id,name,email,date,status,comment,created_at,updated_at)
              VALUES(?,?,?,?,'pending','',?,?)`).bind(user.id,user.first_name,user.email,date,now,now).run();
            const created=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(result.meta.last_row_id).first();
            await notifyRealtime(env,"paddock-requests");
            const email=await sendPaddockRequestConfirmationEmail(env,created);
            return json({request:publicPaddockRequest(created),email},201,cors);
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Ce client a déjà une demande pour ce jour"},409,cors);
            throw error;
          }
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/liberte/exceptions"){
          const input=await readJson(request);const date=String(input?.date||"");const comment=String(input?.comment||"").trim();
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+"T12:00:00Z").getTime()))return json({error:"Date invalide"},400,cors);
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          const now=new Date().toISOString();
          await env.DB.prepare(`INSERT INTO paddock_request_exceptions(date,is_open,comment,updated_at) VALUES(?,?,?,?)
            ON CONFLICT(date) DO UPDATE SET is_open=excluded.is_open,comment=excluded.comment,updated_at=excluded.updated_at`)
            .bind(date,input?.open?1:0,comment,now).run();
          await notifyRealtime(env,"paddock-request-exceptions");
          return json({exception:{date,open:Boolean(input?.open),comment,updatedAt:now}},200,cors);
        }

        const liberteException=url.pathname.match(/^\/api\/admin\/liberte\/exceptions\/(\d{4}-\d{2}-\d{2})$/);
        if(request.method==="DELETE"&&liberteException){
          await env.DB.prepare("DELETE FROM paddock_request_exceptions WHERE date=?").bind(liberteException[1]).run();
          await notifyRealtime(env,"paddock-request-exceptions");
          return json({deleted:true},200,cors);
        }

        if(request.method==="GET"&&url.pathname==="/api/admin/paddocks"){
          const [reservationResult,hours,datedHours,restrictionResult,requestResult]=await Promise.all([
            env.DB.prepare(`SELECT id,name,email,paddock,date,time,duration FROM paddock_reservations
              WHERE date>=date('now') ORDER BY date,time`).all(),
            loadEffectivePaddockHours(env,parisNow().date),
            loadEffectivePaddockHoursByDate(env,120),
            env.DB.prepare("SELECT date,block_grande_90,block_beudot_90 FROM paddock_restrictions WHERE date>=date('now')").all(),
            env.DB.prepare(`SELECT id,user_id,name,email,date,status,comment,created_at,updated_at
              FROM paddock_requests ORDER BY date DESC,id DESC`).all()
          ]);
          const restrictions={};for(const row of restrictionResult.results)restrictions[row.date]={blockGrande90:Boolean(row.block_grande_90),blockBeudot90:Boolean(row.block_beudot_90)};
          return json({reservations:reservationResult.results.map(row=>({...row,id:String(row.id),duration:Number(row.duration)})),
            requests:requestResult.results.map(publicPaddockRequest),horaires:hours,horairesParDate:datedHours,restrictions},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/paddocks/reservations"){
          const input=await readJson(request);
          const booking=validatePaddockBooking(input);
          if(booking.error)return json({error:booking.error},400,cors);
          const userId=Number(input?.userId);
          if(!Number.isInteger(userId)||userId<1)return json({error:"Client invalide"},400,cors);
          const user=await env.DB.prepare(`SELECT * FROM users WHERE id=? AND status='active'
            AND COALESCE(approval_status,'approved')='approved'`).bind(userId).first();
          if(!user)return json({error:"Client actif introuvable"},404,cors);
          const policyError=await paddockBookingPolicyError(env,booking);
          if(policyError)return json({error:policyError},409,cors);
          const conflict=await env.DB.prepare(`SELECT id FROM paddock_reservations WHERE date=? AND paddock=?
            AND (? < (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER)+duration))
            AND (?+? > (CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER))) LIMIT 1`)
            .bind(booking.date,booking.paddock,booking.startMinutes,booking.startMinutes,booking.duration).first();
          if(conflict)return json({error:"Ce créneau est déjà occupé"},409,cors);
          if(user.role==="client"){
            const existing=await env.DB.prepare("SELECT id FROM paddock_reservations WHERE user_id=? AND date=? LIMIT 1")
              .bind(user.id,booking.date).first();
            if(existing)return json({error:"Ce client a déjà une réservation ce jour"},409,cors);
          }
          const now=new Date().toISOString();const lockKey=crypto.randomUUID();
          try{
            await env.DB.batch([
              env.DB.prepare(`INSERT INTO paddock_reservations(lock_key,user_id,name,email,paddock,date,time,duration,created_at)
                VALUES(?,?,?,?,?,?,?,?,?)`).bind(lockKey,user.id,user.first_name,user.email,booking.paddock,
                booking.date,booking.time,booking.duration,now),
              ...paddockLockStatements(env,{lockKey,date:booking.date,paddock:booking.paddock,
                startMinutes:booking.startMinutes,duration:booking.duration})
            ]);
          }catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Ce créneau est déjà occupé"},409,cors);
            throw error;
          }
          const created=await env.DB.prepare("SELECT id FROM paddock_reservations WHERE lock_key=?").bind(lockKey).first();
          await notifyRealtime(env,"paddocks");
          const email=await sendPaddockReservationConfirmationEmail(env,{
            id:created.id,name:user.first_name,email:user.email,paddock:booking.paddock,
            date:booking.date,time:booking.time,duration:booking.duration
          });
          await sendAdminEventPush(env,"Nouvelle réservation paddock",`${user.first_name} — ${booking.date} à ${booking.time}`,"paddocks.html");
          return json({reservation:{id:String(created.id),userId:Number(user.id),name:user.first_name,paddock:booking.paddock,
            date:booking.date,time:booking.time,duration:booking.duration},email},201,cors);
        }

        const adminPaddockRequest=url.pathname.match(/^\/api\/admin\/paddocks\/requests\/(\d+)$/);
        if(request.method==="DELETE"&&adminPaddockRequest){
          const requestId=Number(adminPaddockRequest[1]);
          const requestRow=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(requestId).first();
          if(!requestRow)return json({error:"Demande introuvable"},404,cors);
          const usage=await env.DB.prepare("SELECT * FROM paddock_usages WHERE request_id=?").bind(requestId).first();
          const statements=[];
          if(usage?.mode==="card")statements.push(env.DB.prepare(`UPDATE paddock_cards SET remaining=MIN(total,remaining+1),updated_at=?
            WHERE user_id=?`).bind(new Date().toISOString(),requestRow.user_id));
          statements.push(env.DB.prepare("DELETE FROM paddock_requests WHERE id=?").bind(requestId));
          await env.DB.batch(statements);
          await notifyRealtime(env,"paddock-requests");
          await notifyRealtime(env,"paddock-accounts");
          return json({deleted:true,creditRestored:usage?.mode==="card"},200,cors);
        }
        if(request.method==="PATCH"&&adminPaddockRequest){
          const input=await readJson(request);
          const status=String(input?.status||"");
          const comment=String(input?.comment||"").trim();
          const isFree=input?.free===undefined?null:Boolean(input.free);
          if(!["pending","accepted","refused","completed","cancelled"].includes(status))return json({error:"Statut invalide"},400,cors);
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          const current=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(Number(adminPaddockRequest[1])).first();
          if(!current)return json({error:"Demande introuvable"},404,cors);
          const now=new Date().toISOString();
          const free=isFree===null?Boolean(current.is_free):isFree;
          await env.DB.prepare("UPDATE paddock_requests SET status=?,comment=?,is_free=?,updated_at=? WHERE id=?")
            .bind(status,comment,free?1:0,now,current.id).run();
          await reconcilePaddockUsage(env,{...current,status,is_free:free?1:0},now);
          const updated=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(current.id).first();
          await notifyRealtime(env,"paddock-requests");
          const statusChanged=current.status!==status;
          let email={requested:false,sent:false};
          if(statusChanged)email=await sendPaddockRequestStatusEmail(env,updated);
          return json({request:publicAdminPaddockRequest(updated),statusChanged,email},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/paddocks/blockages"){
          const input=await readJson(request);
          const date=String(input?.date||"");const time=String(input?.time||"");
          const duration=Number(input?.duration);const name=String(input?.name||"Blocage").trim();
          const paddocks=Array.isArray(input?.paddocks)?[...new Set(input.paddocks.map(String))]:[];
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time)||timeToMinutes(time)===null)return json({error:"Date ou heure invalide"},400,cors);
          if(!Number.isInteger(duration)||duration<1||duration>1440)return json({error:"Durée invalide"},400,cors);
          if(!paddocks.length||paddocks.some(value=>!["maison","grande","beudot"].includes(value)))return json({error:"Paddock invalide"},400,cors);
          const cleanName=(name.toLowerCase().startsWith("blocage")?name:"Blocage "+name).slice(0,120);
          const now=new Date().toISOString();
          const statements=[];
          for(const paddock of paddocks){
            const lockKey=crypto.randomUUID();
            statements.push(env.DB.prepare(`INSERT INTO paddock_reservations(lock_key,user_id,name,email,paddock,date,time,duration,created_at)
              VALUES(?,NULL,?,'',?,?,?,?,?)`).bind(lockKey,cleanName,paddock,date,time,duration,now));
            statements.push(...paddockLockStatements(env,{lockKey,date,paddock,startMinutes:timeToMinutes(time),duration}));
          }
          try{await env.DB.batch(statements);}catch(error){
            if(String(error?.message||error).includes("UNIQUE"))return json({error:"Un créneau est déjà occupé"},409,cors);
            throw error;
          }
          await notifyRealtime(env,"paddocks");
          return json({created:paddocks.length},201,cors);
        }

        const adminPaddockReservation=url.pathname.match(/^\/api\/admin\/paddocks\/reservations\/(\d+)$/);
        if(request.method==="DELETE"&&adminPaddockReservation){
          const reservation=await env.DB.prepare("SELECT * FROM paddock_reservations WHERE id=?")
            .bind(Number(adminPaddockReservation[1])).first();
          if(!reservation)return json({error:"Réservation introuvable"},404,cors);
          const input=(request.headers.get("content-type")||"").includes("application/json")?await readJson(request):{};
          const comment=String(input?.comment||"").trim();
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM paddock_slot_locks WHERE reservation_key=?").bind(reservation.lock_key),
            env.DB.prepare("DELETE FROM paddock_reservations WHERE id=?").bind(reservation.id)
          ]);
          await notifyRealtime(env,"paddocks");
          let email={requested:false,sent:false};
          if(reservation.email&&reservation.email.includes("@"))email=await sendPaddockReservationCancellationEmail(env,reservation,comment);
          await sendAdminEventPush(env,"Réservation paddock annulée",`${reservation.name} — ${reservation.date} à ${reservation.time}`,"paddocks.html");
          return json({deleted:true,email},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/paddocks/restrictions"){
          const input=await readJson(request);const date=String(input?.date||"");
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return json({error:"Date invalide"},400,cors);
          await env.DB.prepare(`INSERT INTO paddock_restrictions(date,block_grande_90,block_beudot_90,updated_at)
            VALUES(?,?,?,?) ON CONFLICT(date) DO UPDATE SET block_grande_90=excluded.block_grande_90,
            block_beudot_90=excluded.block_beudot_90,updated_at=excluded.updated_at`)
            .bind(date,input.blockGrande90?1:0,input.blockBeudot90?1:0,new Date().toISOString()).run();
          await notifyRealtime(env,"paddocks");
          return json({saved:true},200,cors);
        }

        const adminRestriction=url.pathname.match(/^\/api\/admin\/paddocks\/restrictions\/(\d{4}-\d{2}-\d{2})$/);
        if(request.method==="DELETE"&&adminRestriction){
          await env.DB.prepare("DELETE FROM paddock_restrictions WHERE date=?").bind(adminRestriction[1]).run();
          await notifyRealtime(env,"paddocks");
          return json({deleted:true},200,cors);
        }

        if(request.method==="PUT"&&url.pathname==="/api/admin/paddocks/hours"){
          const input=await readJson(request);const paddocks=Array.isArray(input?.paddocks)?[...new Set(input.paddocks.map(String))]:[];
          if(!paddocks.length||paddocks.some(value=>!["maison","grande","beudot"].includes(value)))return json({error:"Paddock invalide"},400,cors);
          const schedule=validatePaddockHours(input?.schedule);if(schedule.error)return json({error:schedule.error},400,cors);
          const now=new Date().toISOString();const encoded=JSON.stringify(schedule.value);
          await env.DB.batch(paddocks.map(paddock=>env.DB.prepare(`INSERT INTO paddock_hours(paddock,schedule_json,updated_at)
            VALUES(?,?,?) ON CONFLICT(paddock) DO UPDATE SET schedule_json=excluded.schedule_json,updated_at=excluded.updated_at`)
            .bind(paddock,encoded,now)));
          await notifyRealtime(env,"paddocks");
          return json({saved:true,paddocks},200,cors);
        }

        const userMatch=url.pathname.match(/^\/api\/admin\/users\/(\d+)$/);
        const userDetailsMatch=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/details$/);
        if(request.method==="GET"&&userDetailsMatch){
          const user=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(Number(userDetailsMatch[1])).first();
          if(!user)return json({error:"Utilisateur introuvable"},404,cors);
          const orders=await loadOrders(env,"WHERE o.user_id=?",[user.id]);
          return json({user:publicUser(user),...await loadPaddockAccount(env,user.id),orders,
            orderDue:orders.filter(order=>!order.billed&&!['refused','cancelled'].includes(order.status))
              .reduce((sum,order)=>sum+order.total,0)},200,cors);
        }

        const userCardMatch=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/paddock-card$/);
        if(request.method==="PUT"&&userCardMatch){
          const userId=Number(userCardMatch[1]);
          const user=await env.DB.prepare("SELECT id FROM users WHERE id=?").bind(userId).first();
          if(!user)return json({error:"Utilisateur introuvable"},404,cors);
          const input=await readJson(request);const total=Number(input?.total);const remaining=Number(input?.remaining);
          if(!Number.isInteger(total)||total<1||total>999||!Number.isInteger(remaining)||remaining<0||remaining>total)
            return json({error:"Valeurs de carte invalides"},400,cors);
          const now=new Date().toISOString();
          await env.DB.batch([
            env.DB.prepare("DELETE FROM paddock_usages WHERE user_id=? AND mode='card'").bind(userId),
            env.DB.prepare(`INSERT INTO paddock_cards(user_id,total,remaining,created_at,updated_at) VALUES(?,?,?,?,?)
              ON CONFLICT(user_id) DO UPDATE SET total=excluded.total,remaining=excluded.remaining,created_at=excluded.created_at,updated_at=excluded.updated_at`)
              .bind(userId,total,remaining,now,now)
          ]);
          await notifyRealtime(env,"paddock-accounts");
          return json(await loadPaddockAccount(env,userId),200,cors);
        }
        if(request.method==="DELETE"&&userCardMatch){
          const userId=Number(userCardMatch[1]);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM paddock_usages WHERE user_id=? AND mode='card'").bind(userId),
            env.DB.prepare("DELETE FROM paddock_cards WHERE user_id=?").bind(userId)
          ]);
          await notifyRealtime(env,"paddock-accounts");
          return json({deleted:true},200,cors);
        }

        const usageMatch=url.pathname.match(/^\/api\/admin\/users\/(\d+)\/paddock-usages\/(\d+)$/);
        if(request.method==="DELETE"&&usageMatch){
          const userId=Number(usageMatch[1]);const usageId=Number(usageMatch[2]);
          const usage=await env.DB.prepare("SELECT * FROM paddock_usages WHERE id=? AND user_id=?").bind(usageId,userId).first();
          if(!usage)return json({error:"Consommation introuvable"},404,cors);
          const statements=[env.DB.prepare("DELETE FROM paddock_usages WHERE id=?").bind(usageId)];
          if(usage.mode==="card")statements.push(env.DB.prepare(`UPDATE paddock_cards SET remaining=MIN(total,remaining+1),updated_at=?
            WHERE user_id=?`).bind(new Date().toISOString(),userId));
          await env.DB.batch(statements);
          await notifyRealtime(env,"paddock-accounts");
          return json({deleted:true,creditRestored:usage.mode==="card"},200,cors);
        }

        if(request.method==="PATCH"&&userMatch){
          const current=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(Number(userMatch[1])).first();
          if(!current)return json({error:"Utilisateur introuvable"},404,cors);
          const input=await readJson(request);
          const status=input.status===undefined?current.status:String(input.status);
          if(!["active","disabled"].includes(status))return json({error:"Statut invalide"},400,cors);
          const role=input.role===undefined?current.role:String(input.role);
          if(!["client","staff","admin"].includes(role))return json({error:"Rôle invalide"},400,cors);
          const approvalStatus=input.approvalStatus===undefined?(current.approval_status||"approved"):String(input.approvalStatus);
          if(!["pending","approved"].includes(approvalStatus))return json({error:"Validation invalide"},400,cors);
          const effectiveStatus=approvalStatus==="pending"?"disabled":status;
          const now=new Date().toISOString();
          if(input.temporaryPassword){
            const passwordError=validatePassword(input.temporaryPassword);
            if(passwordError)return json({error:passwordError},400,cors);
            const encoded=await hashPassword(input.temporaryPassword);
            await env.DB.batch([
              env.DB.prepare(`UPDATE users SET status=?,role=?,approval_status=?,password_hash=?,password_salt=?,
                password_iterations=?,must_change_password=1,updated_at=? WHERE id=?`)
                .bind(effectiveStatus,role,approvalStatus,encoded.hash,encoded.salt,encoded.iterations,now,current.id),
              env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,current.id)
            ]);
          }else{
            await env.DB.prepare("UPDATE users SET status=?,role=?,approval_status=?,updated_at=? WHERE id=?")
              .bind(effectiveStatus,role,approvalStatus,now,current.id).run();
            if(effectiveStatus==="disabled")await env.DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL")
              .bind(now,current.id).run();
          }
          const updated=await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(current.id).first();
          const justApproved=(current.approval_status||"approved")==="pending"&&approvalStatus==="approved"&&effectiveStatus==="active";
          const email=justApproved?await sendAccountApprovedEmail(env,updated,now):null;
          return json({user:publicUser(updated),email},200,cors);
        }

        if(request.method==="DELETE"&&userMatch){
          const current=await env.DB.prepare("SELECT id,email,first_name,last_name FROM users WHERE id=?").bind(Number(userMatch[1])).first();
          if(!current)return json({error:"Utilisateur introuvable"},404,cors);
          await env.DB.batch([
            env.DB.prepare("DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE user_id=?)").bind(current.id),
            env.DB.prepare("DELETE FROM orders WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_usages WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_cards WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_requests WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM user_sessions WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM user_push_subscriptions WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_push_reminders WHERE reservation_id IN (SELECT id FROM paddock_reservations WHERE user_id=?)").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_slot_locks WHERE reservation_key IN (SELECT lock_key FROM paddock_reservations WHERE user_id=?)").bind(current.id),
            env.DB.prepare("DELETE FROM paddock_reservations WHERE user_id=?").bind(current.id),
            env.DB.prepare("DELETE FROM users WHERE id=?").bind(current.id)
          ]);
          await env.PRODUCT_IMAGES.delete(`profiles/${current.id}.jpg`);
          await notifyRealtime(env,"paddocks");
          await notifyRealtime(env,"paddock-accounts");
          return json({deleted:true},200,cors);
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

        if(request.method==="POST"&&url.pathname==="/api/admin/hour-programs"){
          const input=await readJson(request);
          const validated=await validateHourProgram(env,input);
          if(validated.error)return json({error:validated.error},400,cors);
          const now=parisNow().iso;
          const result=await env.DB.prepare(`
            INSERT INTO hour_programs(name,scope,starts_on,ends_on,created_at,updated_at)
            VALUES(?,?,?,?,?,?)
          `).bind(validated.name,validated.scope,validated.startsOn,validated.endsOn,now,now).run();
          await saveHourProgramEntries(env,result.meta.last_row_id,validated.entries);
          await notifyRealtime(env,"schedules");
          await notifyRealtime(env,"statuses");
          return json({program:await loadHourProgram(env,result.meta.last_row_id)},201,cors);
        }

        const hourProgramMatch=url.pathname.match(/^\/api\/admin\/hour-programs\/(\d+)$/);
        if(hourProgramMatch&&request.method==="PATCH"){
          const id=Number(hourProgramMatch[1]);
          const exists=await env.DB.prepare("SELECT id FROM hour_programs WHERE id=?").bind(id).first();
          if(!exists)return json({error:"Programmation introuvable"},404,cors);
          const input=await readJson(request);
          const validated=await validateHourProgram(env,input);
          if(validated.error)return json({error:validated.error},400,cors);
          const now=parisNow().iso;
          await env.DB.prepare(`
            UPDATE hour_programs SET name=?,scope=?,starts_on=?,ends_on=?,updated_at=? WHERE id=?
          `).bind(validated.name,validated.scope,validated.startsOn,validated.endsOn,now,id).run();
          await saveHourProgramEntries(env,id,validated.entries);
          await notifyRealtime(env,"schedules");
          await notifyRealtime(env,"statuses");
          return json({program:await loadHourProgram(env,id)},200,cors);
        }

        if(hourProgramMatch&&request.method==="DELETE"){
          const result=await env.DB.prepare("DELETE FROM hour_programs WHERE id=?").bind(Number(hourProgramMatch[1])).run();
          if(!result.meta.changes)return json({error:"Programmation introuvable"},404,cors);
          await notifyRealtime(env,"schedules");
          await notifyRealtime(env,"statuses");
          return json({deleted:true},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/activity-programs"){
          const input=await readJson(request);
          const validated=validateActivityProgram(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const now=parisNow().iso;
          const result=await env.DB.prepare(`
            INSERT INTO activity_programs(name,starts_on,ends_on,enabled,created_at,updated_at)
            VALUES(?,?,?,?,?,?)
          `).bind(validated.name,validated.startsOn,validated.endsOn,validated.enabled,now,now).run();
          await saveActivityProgramEntries(env,result.meta.last_row_id,validated.entries);
          await notifyRealtime(env,"statuses");
          return json({program:await loadActivityProgram(env,result.meta.last_row_id)},201,cors);
        }

        const activityProgramMatch=url.pathname.match(/^\/api\/admin\/activity-programs\/(\d+)$/);
        if(activityProgramMatch&&request.method==="PATCH"){
          const id=Number(activityProgramMatch[1]);
          const exists=await env.DB.prepare("SELECT id FROM activity_programs WHERE id=?").bind(id).first();
          if(!exists)return json({error:"Programmation d’activité introuvable"},404,cors);
          const input=await readJson(request);
          const validated=validateActivityProgram(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const now=parisNow().iso;
          await env.DB.prepare(`
            UPDATE activity_programs SET name=?,starts_on=?,ends_on=?,enabled=?,updated_at=? WHERE id=?
          `).bind(validated.name,validated.startsOn,validated.endsOn,validated.enabled,now,id).run();
          await saveActivityProgramEntries(env,id,validated.entries);
          await notifyRealtime(env,"statuses");
          return json({program:await loadActivityProgram(env,id)},200,cors);
        }

        if(activityProgramMatch&&request.method==="DELETE"){
          const result=await env.DB.prepare("DELETE FROM activity_programs WHERE id=?").bind(Number(activityProgramMatch[1])).run();
          if(!result.meta.changes)return json({error:"Programmation d’activité introuvable"},404,cors);
          await notifyRealtime(env,"statuses");
          return json({deleted:true},200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/hour-exceptions"){
          const input=await readJson(request);
          const validated=await validateHourException(env,input);
          if(validated.error)return json({error:validated.error},400,cors);
          const now=parisNow().iso;
          await env.DB.prepare(`
            INSERT INTO hour_exceptions(date,scope,target_slug,manual_status,opens_at,closes_at,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(date,scope,target_slug) DO UPDATE SET
              manual_status=excluded.manual_status,
              opens_at=excluded.opens_at,
              closes_at=excluded.closes_at,
              updated_at=excluded.updated_at
          `).bind(validated.date,validated.scope,validated.targetSlug,validated.manualStatus,
            validated.opensAt,validated.closesAt,now,now).run();
          await notifyRealtime(env,"schedules");
          await notifyRealtime(env,"statuses");
          await notifyRealtime(env,"paddocks");
          return json({exception:await loadHourException(env,validated.date,validated.scope,validated.targetSlug)},200,cors);
        }

        const hourExceptionMatch=url.pathname.match(/^\/api\/admin\/hour-exceptions\/(\d+)$/);
        if(hourExceptionMatch&&request.method==="DELETE"){
          const result=await env.DB.prepare("DELETE FROM hour_exceptions WHERE id=?")
            .bind(Number(hourExceptionMatch[1])).run();
          if(!result.meta.changes)return json({error:"Exception horaire introuvable"},404,cors);
          await notifyRealtime(env,"schedules");
          await notifyRealtime(env,"statuses");
          await notifyRealtime(env,"paddocks");
          return json({deleted:true},200,cors);
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
          const alerts=await attachSchedules(env,result.results);
          return json(alerts,200,cors);
        }

        if(request.method==="POST"&&url.pathname==="/api/admin/notifications"){
          const input=await readJson(request);
          const validated=validateAlert(input);
          if(validated.error)return json({error:validated.error},400,cors);
          const schedule=validateScheduledNotification(input?.scheduledAt);
          if(schedule.error)return json({error:schedule.error},400,cors);

          const now=parisNow();
          const alertClock=schedule.scheduledAt?parisDateTime(schedule.scheduledAt):now;
          const result=await env.DB.prepare(`
            INSERT INTO alerts(
              date,heure,categorie,titre,message,epingle,active,
              push_requested,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?)
          `).bind(
            alertClock.date,alertClock.time,validated.categorie,validated.titre,
            validated.message,validated.epingle,schedule.scheduledAt?"non":validated.active,
            schedule.scheduledAt?1:validated.pushRequested,now.iso,now.iso
          ).run();

          const created=await env.DB.prepare(`
            SELECT id,date,heure,categorie,titre,message,epingle,active,
                   push_requested,push_sent_at,created_at,updated_at
            FROM alerts WHERE id=?
          `).bind(result.meta.last_row_id).first();

          let scheduled=null;
          if(schedule.scheduledAt){
            scheduled=await createScheduledNotification(env,created.id,schedule.scheduledAt,now.iso);
          }
          const push=scheduled?{enabled:isPushEnabled(env),status:"scheduled",scheduledAt:schedule.scheduledAt}:await sendRequestedPush(env,created);
          if(push.status==="sent"){
            await markPushSent(env,created.id,push.sentAt);
            created.push_sent_at=push.sentAt;
          }
          created.schedule=scheduled;

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
          const schedule=validateScheduledNotification(input?.scheduledAt);
          if(schedule.error)return json({error:schedule.error},400,cors);
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
          const alertClock=schedule.scheduledAt?parisDateTime(schedule.scheduledAt):{date:current.date,time:current.heure};
          await env.DB.prepare(`
            UPDATE alerts SET date=?,heure=?,categorie=?,titre=?,message=?,epingle=?,active=?,
              push_requested=?,push_sent_at=NULL,updated_at=? WHERE id=?
          `).bind(
            alertClock.date,alertClock.time,
            validated.categorie,validated.titre,validated.message,
            validated.epingle,schedule.scheduledAt?"non":validated.active,schedule.scheduledAt?1:validated.pushRequested,
            now.iso,Number(match[1])
          ).run();

          const updated=await env.DB.prepare(`
            SELECT id,date,heure,categorie,titre,message,epingle,active,
                   push_requested,push_sent_at,created_at,updated_at
            FROM alerts WHERE id=?
          `).bind(Number(match[1])).first();
          let scheduled=null;
          if(schedule.scheduledAt){
            scheduled=await upsertScheduledNotification(env,updated.id,schedule.scheduledAt,now.iso);
          }else if(input.scheduledAt===null){
            await cancelScheduledNotification(env,updated.id,now.iso);
          }
          const push=scheduled?{enabled:isPushEnabled(env),status:"scheduled",scheduledAt:schedule.scheduledAt}:await sendRequestedPush(env,updated);
          if(push.status==="sent"){
            await markPushSent(env,updated.id,push.sentAt);
            updated.push_sent_at=push.sentAt;
          }
          updated.schedule=scheduled;
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

async function loadPublicStatuses(env,date=new Date(),dateOverride=""){
  const paris=parisClock(date);
  const effectiveDate=dateOverride||parisDateTime(date).date;
  const effectiveDay=dayNumberFromIsoDate(effectiveDate)||paris.day;
  const [spacesResult,schedulesResult,activityOptions,alert]=await Promise.all([
    env.DB.prepare("SELECT * FROM spaces ORDER BY position").all(),
    loadEffectiveSpaceSchedules(env,effectiveDate),
    loadEffectiveActivityOptions(env,effectiveDate),
    env.DB.prepare("SELECT message,urgent FROM home_alert WHERE id=1").first()
  ]);
  const scheduleMap=new Map(schedulesResult.map(row=>[`${row.space_slug}:${row.day}`,row]));
  const rows=[];
  for(const space of spacesResult.results){
    const schedule=scheduleMap.get(`${space.slug}:${effectiveDay}`)||null;
    const nextOpening=await findNextSpaceOpeningForDate(env,space.slug,effectiveDate,paris.minutes);
    const activity=activityOptions[space.slug]||null;
    rows.push(publicSpace(schedule?{...space,...spaceProgramFields(schedule,space)}:space,schedule,paris.minutes,nextOpening,activity));
  }
  rows.push({
    espace:"accueil",statut_manuel:"",statut_auto:"ferme",liberte:"",longe:"",info:"",
    alerte:alert?.message||"",horaire_special:"",horaire_affiche:"",urgent:alert?.urgent||"non"
  });
  return rows;
}

function publicSpace(space,schedule,minutes,nextOpening=null,activity=null){
  const normalHours=schedule?`${schedule.opens_at} - ${schedule.closes_at}`:"";
  const status=calculateStatus(space.manual_status,schedule,minutes);
  const hidesHours=status==="ferme"||status==="hors-service";
  const activityBlocked=["ferme","hors-service"].includes(status);
  const activityValue=field=>{
    if(activityBlocked)return"non";
    if(space[field]==="auto")return effectiveActivityValue(activity?.[field],minutes);
    return space[field]||"";
  };
  const liberte=activityValue("liberte");
  const longe=activityValue("longe");
  let transition=null;
  if(space.manual_status==="ouvert"&&status==="ouvert"&&schedule){
    const opens=timeToMinutes(schedule.opens_at),closes=timeToMinutes(schedule.closes_at);
    const partialClose=nextClosedInterval(schedule,minutes);
    transition=partialClose
      ? {type:"closing",time:partialClose.open,dayOffset:0}
      : {type:"closing",time:schedule.closes_at,dayOffset:closes<=opens&&minutes>=opens?1:0};
  }else if(space.manual_status==="ouvert"&&status==="prevision"&&nextOpening){
    transition={type:"opening",time:nextOpening.time,dayOffset:nextOpening.dayOffset};
  }
  return{
    espace:space.slug,
    statut_manuel:space.manual_status,
    statut_auto:status,
    liberte,
    longe,
    liberte_horaire:activityBlocked||space.liberte!=="auto"||liberte!=="oui"?"":(activity?.liberte?.hours||""),
    longe_horaire:activityBlocked||space.longe!=="auto"||longe!=="oui"?"":(activity?.longe?.hours||""),
    info:space.info||"",
    alerte:"",
    horaire_special:space.special_hours||"",
    horaire_affiche:hidesHours?"":normalHours,
    transition,
    urgent:""
  };
}

function effectiveActivityValue(activity,minutes){
  if(!activity)return"";
  if(activity.enabled!=="oui")return"non";
  const opens=timeToMinutes(activity.startsAt);
  const closes=timeToMinutes(activity.endsAt);
  if(opens===null&&closes===null)return"oui";
  if(opens===null||closes===null)return"non";
  if(opens===closes)return"non";
  if(closes>opens)return minutes>=opens&&minutes<closes?"oui":"non";
  return minutes>=opens||minutes<closes?"oui":"non";
}

function findNextSpaceOpening(scheduleMap,slug,currentDay,minutes){
  const today=scheduleMap.get(`${slug}:${currentDay}`)||null;
  const todayOpening=isOpenSchedule(today)?timeToMinutes(today?.opens_at):null;
  if(todayOpening!==null&&minutes<todayOpening)return{time:today.opens_at,dayOffset:0};
  for(let dayOffset=1;dayOffset<=7;dayOffset++){
    const day=((currentDay-1+dayOffset)%7)+1;
    const schedule=scheduleMap.get(`${slug}:${day}`)||null;
    if(isOpenSchedule(schedule)&&timeToMinutes(schedule?.opens_at)!==null)return{time:schedule.opens_at,dayOffset};
  }
  return null;
}

function isOpenSchedule(schedule){
  if(!schedule)return false;
  const status=String(schedule.exception_manual_status||schedule.program_manual_status||"ouvert").toLowerCase();
  return status==="ouvert"&&hasValidTimeRange(schedule.opens_at,schedule.closes_at);
}

async function findNextSpaceOpeningForDate(env,slug,dateString,minutes){
  const today=validIsoDate(dateString)||parisNow().date;
  for(let dayOffset=0;dayOffset<=7;dayOffset++){
    const date=addIsoDays(today,dayOffset);
    const day=dayNumberFromIsoDate(date);
    if(!day)continue;
    const schedules=await loadEffectiveSpaceSchedules(env,date);
    const schedule=schedules.find(row=>row.space_slug===slug&&Number(row.day)===day)||null;
    if(!isOpenSchedule(schedule))continue;
    const opens=timeToMinutes(schedule.opens_at);
    if(dayOffset===0&&opens!==null&&minutes>=opens)continue;
    return{time:schedule.opens_at,dayOffset};
  }
  return null;
}

function calculateStatus(manualStatus,schedule,minutes){
  if(["ferme","prevision","hors-service"].includes(manualStatus))return manualStatus;
  if(isPartialClosedNow(schedule,minutes))return schedule.exception_partial_status||"ferme";
  if(!schedule)return"prevision";
  const opens=timeToMinutes(schedule.opens_at);
  const closes=timeToMinutes(schedule.closes_at);
  if(opens===null||closes===null)return"prevision";
  const open=closes>opens?minutes>=opens&&minutes<closes:minutes>=opens||minutes<closes;
  return open?"ouvert":"prevision";
}

function hasValidTimeRange(open,close){
  return timeToMinutes(open)!==null&&timeToMinutes(close)!==null;
}

function isPartialClosureException(exception){
  return exception&&["ferme","hors-service"].includes(exception.manualStatus)&&hasValidTimeRange(exception.opensAt,exception.closesAt);
}

function normalizeClosedIntervals(intervals=[]){
  return intervals
    .map(item=>({open:String(item?.open||""),close:String(item?.close||""),status:String(item?.status||"ferme")}))
    .filter(item=>hasValidTimeRange(item.open,item.close)&&timeToMinutes(item.open)!==timeToMinutes(item.close));
}

function addClosedInterval(schedule,exception){
  if(!isPartialClosureException(exception))return schedule;
  return{...schedule,exception_partial_status:exception.manualStatus,
    closed_intervals:normalizeClosedIntervals([...(schedule?.closed_intervals||[]),{open:exception.opensAt,close:exception.closesAt,status:exception.manualStatus}])};
}

function minutesInRange(minutes,open,close){
  const opens=timeToMinutes(open),closes=timeToMinutes(close);
  if(opens===null||closes===null||opens===closes)return false;
  return closes>opens?minutes>=opens&&minutes<closes:minutes>=opens||minutes<closes;
}

function isPartialClosedNow(schedule,minutes){
  return normalizeClosedIntervals(schedule?.closed_intervals).some(item=>minutesInRange(minutes,item.open,item.close));
}

function nextClosedInterval(schedule,minutes){
  return normalizeClosedIntervals(schedule?.closed_intervals)
    .map(item=>({...item,opens:timeToMinutes(item.open)}))
    .filter(item=>item.opens!==null&&item.opens>minutes)
    .sort((a,b)=>a.opens-b.opens)[0]||null;
}

function publicSchedule(row){
  const status=row.exception_manual_status||row.program_manual_status||"ouvert";
  const closed=status!=="ouvert";
  const value={jour:DAY_NAMES[row.day],ouvert:closed?"":row.opens_at,ferme:closed?"":row.closes_at};
  if(status!=="ouvert")value.statut=status;
  const closedIntervals=normalizeClosedIntervals(row.closed_intervals);
  if(closedIntervals.length)value.closedIntervals=closedIntervals;
  return value;
}

async function loadOperations(env){
  const [spaces,schedules,general,exceptions,hourExceptions,homeAlert,hourPrograms,activityPrograms]=await Promise.all([
    env.DB.prepare("SELECT * FROM spaces ORDER BY position").all(),
    env.DB.prepare("SELECT * FROM space_schedules ORDER BY space_slug,day").all(),
    env.DB.prepare("SELECT * FROM general_schedules ORDER BY day").all(),
    env.DB.prepare("SELECT * FROM schedule_exceptions ORDER BY date DESC").all(),
    env.DB.prepare("SELECT * FROM hour_exceptions ORDER BY date DESC,scope,target_slug").all(),
    env.DB.prepare("SELECT * FROM home_alert WHERE id=1").first(),
    loadHourPrograms(env),
    loadActivityPrograms(env)
  ]);
  return{spaces:spaces.results,spaceSchedules:schedules.results,
    generalSchedules:general.results,exceptions:exceptions.results,homeAlert:homeAlert||{message:"",urgent:"non"},
    hourPrograms,hourExceptions:hourExceptions.results.map(publicHourException),activityPrograms};
}

async function loadEffectiveGeneralSchedules(env,dateString=""){
  const date=validIsoDate(dateString)||parisNow().date;
  const day=dayNumberFromIsoDate(date);
  const base=await env.DB.prepare("SELECT day,opens_at,closes_at FROM general_schedules ORDER BY day").all();
  const entries=await loadApplicableHourEntries(env,"general",dateString);
  const map=new Map(base.results.map(row=>[Number(row.day),{...row}]));
  entries.filter(row=>row.target_slug==="general").forEach(row=>{
    const closed=String(row.manual_status||"ouvert")!=="ouvert";
    map.set(Number(row.day),{day:row.day,opens_at:closed?"":row.opens_at,closes_at:closed?"":row.closes_at,program_manual_status:row.manual_status});
  });
  const exception=await loadHourException(env,date,"general","general");
  if(exception&&day){
    const closed=exception.manualStatus!=="ouvert";
    map.set(day,{day,opens_at:closed?"":exception.opensAt,closes_at:closed?"":exception.closesAt,exception_manual_status:exception.manualStatus});
  }
  return [...map.values()].sort((a,b)=>Number(a.day)-Number(b.day));
}

async function loadEffectiveGeneralSchedulesByDate(env,dateList=[]){
  const result={};
  for(const date of dateList){
    result[date]=(await loadEffectiveGeneralSchedules(env,date)).map(publicSchedule);
  }
  return result;
}

async function loadEffectiveSpaceSchedules(env,dateString=""){
  const date=validIsoDate(dateString)||parisNow().date;
  const day=dayNumberFromIsoDate(date);
  const base=await env.DB.prepare("SELECT * FROM space_schedules ORDER BY space_slug,day").all();
  const entries=[...await loadApplicableHourEntries(env,"work",dateString),...await loadApplicableHourEntries(env,"paddocks",dateString)];
  const map=new Map(base.results.map(row=>[`${row.space_slug}:${row.day}`,{...row}]));
  entries.forEach(row=>{
    const spaceSlug=row.target_slug==="grande"?"grande-voie":row.target_slug;
    const closed=String(row.manual_status||"ouvert")!=="ouvert";
    map.set(`${spaceSlug}:${row.day}`,{
      space_slug:spaceSlug,
      day:row.day,
      opens_at:closed?"":row.opens_at,
      closes_at:closed?"":row.closes_at,
      program_manual_status:row.manual_status,
      program_special_hours:row.special_hours,
      program_info:row.info,
      program_liberte:row.liberte,
      program_longe:row.longe
    });
  });
  if(day){
    const exceptions=await loadHourExceptionsForDate(env,date);
    exceptions.filter(item=>item.scope==="work"||item.scope==="paddocks").forEach(item=>{
      const spaceSlug=item.scope==="paddocks"&&item.targetSlug==="grande"?"grande-voie":item.targetSlug;
      const key=`${spaceSlug}:${day}`;
      const closed=item.manualStatus!=="ouvert";
      map.set(key,{space_slug:spaceSlug,day,opens_at:closed?"":item.opensAt,closes_at:closed?"":item.closesAt,
        program_manual_status:item.manualStatus,hour_exception:true});
    });
  }
  return [...map.values()].sort((a,b)=>String(a.space_slug).localeCompare(String(b.space_slug))||Number(a.day)-Number(b.day));
}

async function getEffectiveHours(env,{scope,targetSlug,dateString}){
  const date=validIsoDate(dateString)||parisNow().date;
  const day=dayNumberFromIsoDate(date);
  if(!day)return null;
  if(scope==="general"){
    const schedules=await loadEffectiveGeneralSchedules(env,date);
    return schedules.find(row=>Number(row.day)===day)||null;
  }
  if(scope==="work"||scope==="paddocks-space"){
    const schedules=await loadEffectiveSpaceSchedules(env,date);
    return schedules.find(row=>row.space_slug===targetSlug&&Number(row.day)===day)||null;
  }
  if(scope==="paddock"){
    const hours=await loadEffectivePaddockHours(env,date);
    return hours?.[targetSlug]?.[DAY_NAMES[day]]||null;
  }
  return null;
}

async function loadEffectivePaddockHours(env,dateString=""){
  const date=validIsoDate(dateString)||parisNow().date;
  const day=dayNumberFromIsoDate(date);
  const base=await env.DB.prepare("SELECT paddock,schedule_json FROM paddock_hours").all();
  const hours={};
  for(const row of base.results){
    hours[row.paddock]=JSON.parse(row.schedule_json);
  }
  const entries=await loadApplicableHourEntries(env,"paddocks",dateString);
  const dayNames=["","lundi","mardi","mercredi","jeudi","vendredi","samedi","dimanche"];
  for(const row of entries){
    if(!["maison","grande","beudot"].includes(row.target_slug))continue;
    const dayName=dayNames[Number(row.day)];
    if(!dayName)continue;
    const paddockHours=hours[row.target_slug]||{};
    const closed=["ferme","hors-service"].includes(String(row.manual_status||""));
    paddockHours[dayName]={
      closed,
      open:closed?"":row.opens_at,
      close:closed?"":row.closes_at
    };
    hours[row.target_slug]=paddockHours;
  }
  if(day){
    const dayName=DAY_NAMES[day];
    const exceptions=await loadHourExceptionsForDate(env,date);
    exceptions.filter(item=>item.scope==="paddocks"&&["maison","grande","beudot"].includes(item.targetSlug)).forEach(item=>{
      const paddockHours=hours[item.targetSlug]||{};
      const closed=["ferme","hors-service"].includes(item.manualStatus);
      paddockHours[dayName]={
        closed,
        open:closed?"":item.opensAt,
        close:closed?"":item.closesAt
      };
      hours[item.targetSlug]=paddockHours;
    });
  }
  return hours;
}

async function loadEffectivePaddockHoursByDate(env,daysAhead=14){
  const days=Math.max(1,Math.min(Number(daysAhead)||14,180));
  const today=parisNow().date;
  const result={};
  for(let index=0;index<days;index++){
    const date=new Date(`${today}T12:00:00`);
    date.setDate(date.getDate()+index);
    const key=date.toISOString().slice(0,10);
    result[key]=await loadEffectivePaddockHours(env,key);
  }
  return result;
}

function spaceProgramFields(schedule,space={}){
  const fields={};
  if(schedule.program_manual_status&&space.manual_status==="ouvert")fields.manual_status=schedule.program_manual_status;
  if(schedule.program_special_hours!==undefined)fields.special_hours=schedule.program_special_hours;
  if(schedule.program_info!==undefined)fields.info=schedule.program_info;
  if(schedule.program_liberte)fields.liberte=schedule.program_liberte;
  if(schedule.program_longe)fields.longe=schedule.program_longe;
  return fields;
}

async function loadApplicableHourEntries(env,scope,dateString=""){
  const date=validIsoDate(dateString)||parisNow().date;
  const program=await env.DB.prepare(`
    SELECT id FROM hour_programs
    WHERE scope=? AND starts_on<=? AND (ends_on IS NULL OR ends_on='' OR ends_on>=?)
    ORDER BY starts_on DESC,id DESC LIMIT 1
  `).bind(scope,date,date).first();
  if(!program)return[];
  const result=await env.DB.prepare("SELECT * FROM hour_program_entries WHERE program_id=? ORDER BY target_slug,day")
    .bind(program.id).all();
  return result.results;
}

async function loadHourExceptionsForDate(env,dateString){
  const date=validIsoDate(dateString);
  if(!date)return[];
  const result=await env.DB.prepare("SELECT * FROM hour_exceptions WHERE date=? ORDER BY scope,target_slug")
    .bind(date).all();
  return result.results.map(publicHourException);
}

async function loadHourException(env,date,scope,targetSlug){
  const row=await env.DB.prepare("SELECT * FROM hour_exceptions WHERE date=? AND scope=? AND target_slug=?")
    .bind(date,scope,targetSlug).first();
  return row?publicHourException(row):null;
}

async function loadHourPrograms(env){
  const programs=await env.DB.prepare("SELECT * FROM hour_programs ORDER BY starts_on DESC,id DESC").all();
  const entries=await env.DB.prepare("SELECT * FROM hour_program_entries ORDER BY program_id,target_slug,day").all();
  const byProgram=new Map();
  entries.results.forEach(row=>{
    const list=byProgram.get(Number(row.program_id))||[];
    list.push(publicHourProgramEntry(row));
    byProgram.set(Number(row.program_id),list);
  });
  return programs.results.map(row=>({...publicHourProgram(row),entries:byProgram.get(Number(row.id))||[]}));
}

async function loadHourProgram(env,id){
  const row=await env.DB.prepare("SELECT * FROM hour_programs WHERE id=?").bind(id).first();
  if(!row)return null;
  const entries=await env.DB.prepare("SELECT * FROM hour_program_entries WHERE program_id=? ORDER BY target_slug,day").bind(id).all();
  return{...publicHourProgram(row),entries:entries.results.map(publicHourProgramEntry)};
}

async function loadActivityPrograms(env){
  const programs=await env.DB.prepare("SELECT * FROM activity_programs ORDER BY starts_on DESC,id DESC").all();
  const entries=await env.DB.prepare("SELECT * FROM activity_program_entries ORDER BY program_id,space_slug,day,activity").all();
  const byProgram=new Map();
  entries.results.forEach(row=>{
    const list=byProgram.get(Number(row.program_id))||[];
    list.push(publicActivityProgramEntry(row));
    byProgram.set(Number(row.program_id),list);
  });
  return programs.results.map(row=>({...publicActivityProgram(row),entries:byProgram.get(Number(row.id))||[]}));
}

async function loadActivityProgram(env,id){
  const row=await env.DB.prepare("SELECT * FROM activity_programs WHERE id=?").bind(id).first();
  if(!row)return null;
  const entries=await env.DB.prepare("SELECT * FROM activity_program_entries WHERE program_id=? ORDER BY space_slug,day,activity").bind(id).all();
  return{...publicActivityProgram(row),entries:entries.results.map(publicActivityProgramEntry)};
}

async function loadEffectiveActivityOptions(env,dateString=""){
  const date=validIsoDate(dateString)||parisNow().date;
  const day=dayNumberFromIsoDate(date);
  const program=await env.DB.prepare(`
    SELECT id FROM activity_programs
    WHERE enabled='oui' AND starts_on<=? AND (ends_on IS NULL OR ends_on='' OR ends_on>=?)
    ORDER BY starts_on DESC,id DESC LIMIT 1
  `).bind(date,date).first();
  if(!program||!day)return{};
  const rows=await env.DB.prepare("SELECT * FROM activity_program_entries WHERE program_id=? AND day=?")
    .bind(program.id,day).all();
  const result={};
  rows.results.forEach(row=>{
    const space=result[row.space_slug]||{};
    space[row.activity]={
      enabled:row.enabled,
      startsAt:row.starts_at||"",
      endsAt:row.ends_at||"",
      hours:row.starts_at&&row.ends_at?`${row.starts_at} - ${row.ends_at}`:""
    };
    result[row.space_slug]=space;
  });
  return result;
}

function publicHourProgram(row){
  return{id:row.id,name:row.name,scope:row.scope,startsOn:row.starts_on,endsOn:row.ends_on||"",createdAt:row.created_at,updatedAt:row.updated_at};
}

function publicHourProgramEntry(row){
  return{targetSlug:row.target_slug,day:row.day,manualStatus:row.manual_status,opensAt:row.opens_at,
    closesAt:row.closes_at,specialHours:row.special_hours||"",info:row.info||"",liberte:row.liberte||"",longe:row.longe||""};
}

function publicActivityProgram(row){
  return{id:row.id,name:row.name,startsOn:row.starts_on,endsOn:row.ends_on||"",
    enabled:row.enabled||"non",createdAt:row.created_at,updatedAt:row.updated_at};
}

function publicActivityProgramEntry(row){
  return{spaceSlug:row.space_slug,day:row.day,activity:row.activity,enabled:row.enabled||"non",
    startsAt:row.starts_at||"",endsAt:row.ends_at||""};
}

function publicHourException(row){
  return{id:Number(row.id),date:row.date,scope:row.scope,targetSlug:row.target_slug,
    manualStatus:row.manual_status,opensAt:row.opens_at,closesAt:row.closes_at,
    createdAt:row.created_at,updatedAt:row.updated_at};
}

function validateSpace(input){
  const manualStatus=String(input?.manualStatus||"").trim().toLowerCase();
  if(!["ouvert","prevision","ferme","hors-service"].includes(manualStatus))return{error:"Statut invalide"};
  const info=String(input?.info||"").trim();
  const specialHours=String(input?.specialHours||"").trim();
  if(info.length>500||specialHours.length>120)return{error:"Texte trop long"};
  return{manualStatus,liberte:normalizeActivityMode(input?.liberte),longe:normalizeActivityMode(input?.longe),info,specialHours};
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

async function validateHourProgram(env,input){
  const name=String(input?.name||"").trim();
  const scope=String(input?.scope||"").trim();
  const startsOn=validIsoDate(input?.startsOn);
  const endsOn=input?.endsOn?validIsoDate(input.endsOn):"";
  if(!name||name.length>120)return{error:"Nom de programmation invalide"};
  if(!["general","work","paddocks"].includes(scope))return{error:"Type de programmation invalide"};
  if(!startsOn)return{error:"Date de début invalide"};
  if(input?.endsOn&&!endsOn)return{error:"Date de fin invalide"};
  if(endsOn&&endsOn<startsOn)return{error:"La date de fin doit être après la date de début"};
  const entries=Array.isArray(input?.entries)?input.entries:[];
  if(!entries.length)return{error:"Ajoutez au moins une ligne d’horaire"};
  const spaces=scope==="work"?await env.DB.prepare("SELECT slug FROM spaces").all():{results:[]};
  const allowedTargets=new Set(
    scope==="general"?["general"]:
    scope==="paddocks"?["maison","grande","beudot"]:
    spaces.results.map(row=>row.slug).filter(slug=>["carriere","manege"].includes(slug))
  );
  const rows=[];
  const keys=new Set();
  for(const entry of entries){
    const targetSlug=String(entry?.targetSlug||"").trim();
    const day=Number(entry?.day);
    const opensAt=String(entry?.opensAt||"");
    const closesAt=String(entry?.closesAt||"");
    const manualStatus=String(entry?.manualStatus||"ouvert").trim().toLowerCase();
    const specialHours=String(entry?.specialHours||"").trim();
    const info=String(entry?.info||"").trim();
    if(!allowedTargets.has(targetSlug))return{error:"Espace invalide dans la programmation"};
    if(!["ouvert","prevision","ferme","hors-service"].includes(manualStatus))return{error:"Statut invalide"};
    const hasOpen=Boolean(opensAt);
    const hasClose=Boolean(closesAt);
    if(manualStatus==="ouvert"){
      if(!hasOpen||!hasClose||!/^\d{2}:\d{2}$/.test(opensAt)||!/^\d{2}:\d{2}$/.test(closesAt))return{error:"Une programmation ouverte doit avoir des horaires"};
      if(timeToMinutes(opensAt)===null||timeToMinutes(closesAt)===null)return{error:"Horaire invalide"};
    }else if(hasOpen||hasClose){
      return{error:"Une programmation fermée s’applique à la journée complète, sans horaires"};
    }
    if(specialHours.length>120||info.length>500)return{error:"Texte trop long"};
    const key=`${targetSlug}:${day}`;
    if(keys.has(key))return{error:"Chaque jour ne doit apparaître qu’une fois par espace"};
    keys.add(key);
    rows.push({targetSlug,day,manualStatus,opensAt:manualStatus==="ouvert"?opensAt:"",closesAt:manualStatus==="ouvert"?closesAt:"",specialHours,info,
      liberte:scope==="work"?normalizeYesNo(entry?.liberte,true):"",
      longe:scope==="work"?normalizeYesNo(entry?.longe,true):""});
  }
  return{name,scope,startsOn,endsOn,entries:rows};
}

async function validateHourException(env,input){
  const date=validIsoDate(input?.date);
  const scope=String(input?.scope||"").trim();
  const targetSlug=String(input?.targetSlug||"").trim();
  const manualStatus=String(input?.manualStatus||"ouvert").trim().toLowerCase();
  const opensAt=String(input?.opensAt||"");
  const closesAt=String(input?.closesAt||"");
  if(!date)return{error:"Date invalide"};
  if(!["general","work","paddocks"].includes(scope))return{error:"Type d’exception invalide"};
  if(!["ouvert","ferme","hors-service"].includes(manualStatus))return{error:"Statut invalide"};
  if(scope==="general"&&manualStatus==="hors-service")return{error:"Hors service ne s’applique pas aux horaires des écuries"};
  const hasOpen=Boolean(opensAt);
  const hasClose=Boolean(closesAt);
  if(manualStatus==="ouvert"){
    if(!hasOpen||!hasClose)return{error:"Une exception ouverte doit avoir des horaires"};
    if(timeToMinutes(opensAt)===null||timeToMinutes(closesAt)===null)return{error:"Horaire invalide"};
  }else if(hasOpen||hasClose){
    return{error:"Une exception fermée s’applique à la journée complète, sans horaires"};
  }
  const spaces=scope==="work"?await env.DB.prepare("SELECT slug FROM spaces").all():{results:[]};
  const allowedTargets=new Set(
    scope==="general"?["general"]:
    scope==="paddocks"?["maison","grande","beudot"]:
    spaces.results.map(row=>row.slug).filter(slug=>["carriere","manege"].includes(slug))
  );
  if(!allowedTargets.has(targetSlug))return{error:"Espace invalide dans l’exception"};
  return{date,scope,targetSlug,manualStatus,opensAt:manualStatus==="ouvert"?opensAt:"",closesAt:manualStatus==="ouvert"?closesAt:""};
}

function validateActivityProgram(input){
  const name=String(input?.name||"").trim();
  const startsOn=validIsoDate(input?.startsOn);
  const endsOn=input?.endsOn?validIsoDate(input.endsOn):"";
  const enabled=normalizeYesNo(input?.enabled,true)||"non";
  if(!name||name.length>120)return{error:"Nom de programmation invalide"};
  if(!startsOn)return{error:"Date de début invalide"};
  if(input?.endsOn&&!endsOn)return{error:"Date de fin invalide"};
  if(endsOn&&endsOn<startsOn)return{error:"La date de fin doit être après la date de début"};
  const entries=Array.isArray(input?.entries)?input.entries:[];
  if(!entries.length)return{error:"Ajoutez au moins une ligne d’option"};
  const rows=[];
  const keys=new Set();
  for(const entry of entries){
    const spaceSlug=String(entry?.spaceSlug||"").trim();
    const day=Number(entry?.day);
    const activity=String(entry?.activity||"").trim();
    const optionEnabled=normalizeYesNo(entry?.enabled,true)||"non";
    const startsAt=String(entry?.startsAt||"").trim();
    const endsAt=String(entry?.endsAt||"").trim();
    if(!["carriere","manege"].includes(spaceSlug))return{error:"Espace invalide dans les options"};
    if(day<1||day>7)return{error:"Jour invalide dans les options"};
    if(!["liberte","longe"].includes(activity))return{error:"Activité invalide"};
    if(startsAt&&timeToMinutes(startsAt)===null)return{error:"Horaire d’activité invalide"};
    if(endsAt&&timeToMinutes(endsAt)===null)return{error:"Horaire d’activité invalide"};
    if((startsAt&&!endsAt)||(!startsAt&&endsAt))return{error:"Renseignez début et fin d’activité ensemble"};
    const key=`${spaceSlug}:${day}:${activity}`;
    if(keys.has(key))return{error:"Chaque option ne doit apparaître qu’une fois"};
    keys.add(key);
    rows.push({spaceSlug,day,activity,enabled:optionEnabled,startsAt,endsAt});
  }
  return{name,startsOn,endsOn,enabled,entries:rows};
}

async function saveHourProgramEntries(env,programId,entries){
  await env.DB.prepare("DELETE FROM hour_program_entries WHERE program_id=?").bind(programId).run();
  if(!entries.length)return;
  await env.DB.batch(entries.map(entry=>env.DB.prepare(`
    INSERT INTO hour_program_entries(program_id,target_slug,day,manual_status,opens_at,closes_at,special_hours,info,liberte,longe)
    VALUES(?,?,?,?,?,?,?,?,?,?)
  `).bind(programId,entry.targetSlug,entry.day,entry.manualStatus,entry.opensAt,entry.closesAt,
    entry.specialHours,entry.info,entry.liberte,entry.longe)));
}

async function saveActivityProgramEntries(env,programId,entries){
  await env.DB.prepare("DELETE FROM activity_program_entries WHERE program_id=?").bind(programId).run();
  if(!entries.length)return;
  await env.DB.batch(entries.map(entry=>env.DB.prepare(`
    INSERT INTO activity_program_entries(program_id,space_slug,day,activity,enabled,starts_at,ends_at)
    VALUES(?,?,?,?,?,?,?)
  `).bind(programId,entry.spaceSlug,entry.day,entry.activity,entry.enabled,entry.startsAt,entry.endsAt)));
}

function validIsoDate(value){
  const date=String(value||"").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date)?date:"";
}

function parseDateList(value){
  return[...new Set(String(value||"").split(",").map(validIsoDate).filter(Boolean))].slice(0,14);
}

function dayNumberFromIsoDate(value){
  const date=validIsoDate(value);
  if(!date)return 0;
  const [year,month,day]=date.split("-").map(Number);
  const local=new Date(year,month-1,day,12,0,0,0);
  return local.getDay()||7;
}

function normalizeYesNo(value,allowEmpty){
  const normalized=String(value??"").trim().toLowerCase();
  if(normalized==="oui"||value===true)return"oui";
  if(normalized==="non"||value===false)return"non";
  return allowEmpty?"":"non";
}

function normalizeActivityMode(value){
  const normalized=String(value??"").trim().toLowerCase();
  if(["oui","non","auto"].includes(normalized))return normalized;
  if(value===true)return"oui";
  if(value===false)return"non";
  return"";
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

  const publicAlertId=alert.alert_id??alert.id;
  const detailUrl=`https://damiensiri.github.io/push2-beta/detail.html?id=${encodeURIComponent(publicAlertId)}`;
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

function parisLocalMinute(date=new Date()){
  const values={};
  new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"})
    .formatToParts(date).forEach(part=>{if(part.type!=="literal")values[part.type]=part.value;});
  return Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day))/60000+Number(values.hour)*60+Number(values.minute);
}

function reservationLocalMinute(date,time){
  const [year,month,day]=String(date).split("-").map(Number);const [hour,minute]=String(time).split(":").map(Number);
  return Date.UTC(year,month-1,day)/60000+hour*60+minute;
}

function duePaddockReminderTypes(reservation,currentMinute){
  const start=reservationLocalMinute(reservation.date,reservation.time);const duration=Number(reservation.duration)||0;
  return [{type:"start_1h",due:start-60},{type:"end_5m",due:start+duration-5}]
    .filter(item=>currentMinute>=item.due&&currentMinute<item.due+5).map(item=>item.type);
}

function isValidPushSubscriptionId(value){
  return /^[A-Za-z0-9-]{20,100}$/.test(String(value||""));
}

function isValidPushInstallationId(value){
  return /^[A-Za-z0-9-]{20,100}$/.test(String(value||""));
}

async function processPaddockPushReminders(env,now=new Date()){
  if(!isPushEnabled(env))return{processed:0,sent:0,disabled:true};
  const parisDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const result=await env.DB.prepare(`SELECT id,user_id,paddock,date,time,duration FROM paddock_reservations
    WHERE user_id IS NOT NULL AND date BETWEEN date(?,'-1 day') AND date(?,'+1 day')`).bind(parisDate,parisDate).all();
  const currentMinute=parisLocalMinute(now);let sent=0;
  for(const reservation of result.results){
    const subscriptions=await env.DB.prepare("SELECT subscription_id FROM user_push_subscriptions WHERE user_id=?")
      .bind(reservation.user_id).all();
    const subscriptionIds=subscriptions.results.map(item=>item.subscription_id).filter(Boolean);
    if(!subscriptionIds.length)continue;
    for(const type of duePaddockReminderTypes(reservation,currentMinute)){
      const claimedAt=new Date().toISOString();
      const deliveryKey=crypto.randomUUID();
      const claim=await env.DB.prepare(`INSERT OR IGNORE INTO paddock_push_reminders
        (reservation_id,reminder_type,claimed_at,attempt_count,delivery_key) VALUES(?,?,?,1,?)`)
        .bind(reservation.id,type,claimedAt,deliveryKey).run();
      let acquired=Boolean(claim.meta.changes);
      if(!acquired){
        const staleBefore=new Date(Date.now()-45_000).toISOString();
        const retry=await env.DB.prepare(`UPDATE paddock_push_reminders
          SET claimed_at=?,attempt_count=attempt_count+1,last_error=NULL
          WHERE reservation_id=? AND reminder_type=? AND sent_at IS NULL AND claimed_at<?`)
          .bind(claimedAt,reservation.id,type,staleBefore).run();
        acquired=Boolean(retry.meta.changes);
      }
      if(!acquired)continue;
      const reminder=await env.DB.prepare(`SELECT delivery_key FROM paddock_push_reminders
        WHERE reservation_id=? AND reminder_type=?`).bind(reservation.id,type).first();
      const stableDeliveryKey=reminder?.delivery_key||deliveryKey;
      if(!reminder?.delivery_key){
        await env.DB.prepare(`UPDATE paddock_push_reminders SET delivery_key=?
          WHERE reservation_id=? AND reminder_type=? AND delivery_key IS NULL`)
          .bind(stableDeliveryKey,reservation.id,type).run();
      }
      const push=await sendPaddockReminderPush(env,reservation,type,subscriptionIds,stableDeliveryKey);
      if(push.sent){
        await env.DB.prepare(`UPDATE paddock_push_reminders
          SET sent_at=?,onesignal_notification_id=?,last_error=NULL WHERE reservation_id=? AND reminder_type=?`)
          .bind(new Date().toISOString(),push.id||null,reservation.id,type).run();sent++;
      }else{
        await env.DB.prepare(`UPDATE paddock_push_reminders SET last_error=?
          WHERE reservation_id=? AND reminder_type=? AND sent_at IS NULL`)
          .bind(String(push.error||"Échec OneSignal").slice(0,500),reservation.id,type).run();
      }
    }
  }
  return{processed:result.results.length,sent};
}

async function sendPaddockReminderPush(env,reservation,type,subscriptionIds,deliveryKey){
  const paddock=({maison:"Maison",grande:"Grande voie",beudot:"Beudot"})[reservation.paddock]||reservation.paddock;
  const title=type==="start_1h"?"Rappel de votre réservation paddock":"Fin de votre réservation paddock";
  const message=type==="start_1h"
    ?`Votre réservation au paddock ${paddock} commence dans 1 heure, à ${reservation.time}.`
    :`Votre réservation au paddock ${paddock} se termine dans 5 minutes. Merci de libérer le paddock.`;
  try{
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),10_000);
    let response;
    try{response=await fetch("https://api.onesignal.com/notifications",{method:"POST",signal:controller.signal,headers:{
      "authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`,"content-type":"application/json; charset=utf-8"},body:JSON.stringify({
        app_id:env.ONESIGNAL_APP_ID,include_subscription_ids:subscriptionIds,idempotency_key:deliveryKey,
        headings:{fr:title,en:title},contents:{fr:message,en:message},url:"https://damiensiri.github.io/push2-beta/mesreservations.html"
      })});}finally{clearTimeout(timeout);}
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.errors)return{sent:false,error:data.errors||`HTTP ${response.status}`};
    return{sent:true,id:data.id||null};
  }catch(error){return{sent:false,error:String(error?.message||error)};}
}

async function attachSchedules(env,alerts){
  if(!alerts.length)return alerts;
  const schedules=await env.DB.prepare(`
    SELECT s.*,a.id AS linked_alert_id FROM scheduled_notifications s
    JOIN alerts a ON a.id=s.alert_id
    ORDER BY s.scheduled_at DESC
  `).all();
  const byAlert=new Map(schedules.results.map(row=>[Number(row.alert_id),publicScheduledNotification(row)]));
  return alerts.map(alert=>({...alert,schedule:byAlert.get(Number(alert.id))||null}));
}

function validateScheduledNotification(value){
  if(value===undefined||value===null||value==="")return{scheduledAt:null};
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime()))return{error:"Date de programmation invalide"};
  const scheduledAt=date.toISOString();
  if(date.getTime()<Date.now()-60_000)return{error:"La programmation doit être dans le futur"};
  return{scheduledAt};
}

function publicScheduledNotification(row){
  return{
    id:Number(row.id),alertId:Number(row.alert_id),scheduledAt:row.scheduled_at,
    status:row.status,claimedAt:row.claimed_at||null,attemptCount:Number(row.attempt_count||0),
    sentAt:row.status==="sent"?row.updated_at:null,lastError:row.last_error||null
  };
}

async function createScheduledNotification(env,alertId,scheduledAt,now){
  const deliveryKey=crypto.randomUUID();
  const result=await env.DB.prepare(`
    INSERT INTO scheduled_notifications(alert_id,scheduled_at,status,delivery_key,created_at,updated_at)
    VALUES(?,?,'pending',?,?,?)
  `).bind(alertId,scheduledAt,deliveryKey,now,now).run();
  const row=await env.DB.prepare("SELECT * FROM scheduled_notifications WHERE id=?")
    .bind(result.meta.last_row_id).first();
  return publicScheduledNotification(row);
}

async function upsertScheduledNotification(env,alertId,scheduledAt,now){
  const current=await env.DB.prepare("SELECT * FROM scheduled_notifications WHERE alert_id=?").bind(alertId).first();
  if(current&&current.status==="sent")return publicScheduledNotification(current);
  if(current){
    await env.DB.prepare(`
      UPDATE scheduled_notifications SET scheduled_at=?,status='pending',claimed_at=NULL,
        attempt_count=0,last_error=NULL,updated_at=? WHERE alert_id=?
    `).bind(scheduledAt,now,alertId).run();
  }else{
    await createScheduledNotification(env,alertId,scheduledAt,now);
  }
  const row=await env.DB.prepare("SELECT * FROM scheduled_notifications WHERE alert_id=?").bind(alertId).first();
  return publicScheduledNotification(row);
}

async function cancelScheduledNotification(env,alertId,now){
  await env.DB.prepare(`
    UPDATE scheduled_notifications SET status='cancelled',claimed_at=NULL,updated_at=?
    WHERE alert_id=? AND status IN ('pending','sending','failed')
  `).bind(now,alertId).run();
}

async function processScheduledNotifications(env,now=new Date()){
  if(!isPushEnabled(env))return{processed:0,sent:0,disabled:true};
  const due=await env.DB.prepare(`
    SELECT s.id FROM scheduled_notifications s
    JOIN alerts a ON a.id=s.alert_id
    WHERE s.status IN ('pending','failed') AND s.scheduled_at<=?
    ORDER BY s.scheduled_at ASC LIMIT 10
  `).bind(now.toISOString()).all();
  let sent=0;
  for(const item of due.results){
    const claimedAt=new Date().toISOString();
    const staleBefore=new Date(Date.now()-45_000).toISOString();
    const claim=await env.DB.prepare(`
      UPDATE scheduled_notifications
      SET status='sending',claimed_at=?,attempt_count=attempt_count+1,last_error=NULL,updated_at=?
      WHERE id=? AND (status IN ('pending','failed') OR (status='sending' AND claimed_at<?))
    `).bind(claimedAt,claimedAt,item.id,staleBefore).run();
    if(!claim.meta.changes)continue;
    const schedule=await env.DB.prepare(`
      SELECT s.*,a.id AS alert_id,a.titre,a.message,a.active,a.push_requested,a.push_sent_at
      FROM scheduled_notifications s JOIN alerts a ON a.id=s.alert_id WHERE s.id=?
    `).bind(item.id).first();
    if(!schedule||schedule.push_sent_at){
      await env.DB.prepare("UPDATE scheduled_notifications SET status='sent',updated_at=? WHERE id=?")
        .bind(claimedAt,item.id).run();
      continue;
    }
    await env.DB.prepare("UPDATE alerts SET active='oui',push_requested=1,updated_at=? WHERE id=?")
      .bind(claimedAt,schedule.alert_id).run();
    const push=await sendRequestedPush(env,{...schedule,active:"oui",push_requested:1,push_sent_at:null});
    if(push.status==="sent"){
      await markPushSent(env,schedule.alert_id,push.sentAt);
      await env.DB.prepare(`
        UPDATE scheduled_notifications SET status='sent',onesignal_notification_id=?,
          last_error=NULL,updated_at=? WHERE id=?
      `).bind(push.id||null,push.sentAt,item.id).run();
      sent++;
    }else{
      await env.DB.prepare(`
        UPDATE scheduled_notifications SET status='failed',last_error=?,updated_at=? WHERE id=?
      `).bind(String(push.error||push.status||"Échec OneSignal").slice(0,500),new Date().toISOString(),item.id).run();
    }
  }
  return{processed:due.results.length,sent};
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
  return{...parisDateTime(date),iso:date.toISOString()};
}

function parisDateTime(value){
  const date=value instanceof Date?value:new Date(value);
  const parts={};
  new Intl.DateTimeFormat("en-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"
  }).formatToParts(date).forEach(part=>{
    if(part.type!=="literal")parts[part.type]=part.value;
  });
  return{
    date:`${parts.year}-${parts.month}-${parts.day}`,
    time:`${parts.hour}:${parts.minute}`
  };
}

function isAdmin(request,env){
  if(!env.ADMIN_TOKEN)return false;
  const value=request.headers.get("authorization")||"";
  return value===`Bearer ${String(env.ADMIN_TOKEN).trim()}`;
}

async function kioskDevice(request,env){
  const value=request.headers.get("authorization")||"";
  if(!value.startsWith("Bearer "))return null;
  const hash=await sha256(value.slice(7).trim());
  return env.DB.prepare("SELECT id,label FROM planning_kiosk_devices WHERE token_hash=? AND active=1").bind(hash).first();
}

function validWeekStart(value){
  const week=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week))return"";
  const date=new Date(week+"T12:00:00Z");
  return !Number.isNaN(date.getTime())&&date.getUTCDay()===1?week:"";
}

function publicPlanningTask(row){
  return{id:Number(row.id),weekStart:row.week_start,horseId:Number(row.horse_id),dayIndex:Number(row.day_index),
    type:row.type,description:row.description||"",paddock:row.paddock||"",startsAt:row.starts_at||"",
    endsAt:row.ends_at||"",requestId:row.request_id===null?null:Number(row.request_id),position:Number(row.position||0),
    employeeId:row.employee_id===null||row.employee_id===undefined?null:Number(row.employee_id),
    employeeName:row.employee_name||"",employeeColor:row.employee_color||"",
    employeeAvailable:row.employee_id===null||row.employee_id===undefined?true:Boolean(Number(row.employee_available)),
    completedAt:row.completed_at||null,completedBy:row.completed_by||null};
}

async function loadPlanning(env,week){
  const [horseResult,taskResult,reservationResult,hoursResult,requestResult,employeeResult]=await Promise.all([
    env.DB.prepare(`SELECT h.id,h.name,wh.position FROM planning_week_horses wh JOIN planning_horses h ON h.id=wh.horse_id
      WHERE wh.week_start=? AND h.active=1 ORDER BY wh.position,h.name`).bind(week).all(),
    env.DB.prepare(`SELECT t.*,e.name AS employee_name,e.color AS employee_color,
      CASE WHEN t.employee_id IS NULL THEN 1 WHEN EXISTS(
        SELECT 1 FROM staff_shifts s WHERE s.employee_id=t.employee_id AND s.status='work'
          AND s.work_date=date(t.week_start,printf('+%d days',t.day_index))
      ) THEN 1 ELSE 0 END AS employee_available
      FROM planning_tasks t LEFT JOIN staff_employees e ON e.id=t.employee_id
      WHERE t.week_start=? ORDER BY t.day_index,t.horse_id,t.position,t.id`).bind(week).all(),
    env.DB.prepare(`SELECT id,name,paddock,date,time,duration FROM paddock_reservations
      WHERE date>=? AND date<=date(?, '+6 days') ORDER BY date,time,paddock,id`).bind(week,week).all(),
    env.DB.prepare("SELECT paddock,schedule_json FROM paddock_hours").all(),
    env.DB.prepare(`SELECT id,date,name FROM paddock_requests WHERE date>=? AND date<=date(?, '+6 days')
      AND status='accepted' ORDER BY date,name,id`).bind(week,week).all(),
    env.DB.prepare(`SELECT e.id,e.name,e.color,s.work_date
      FROM staff_employees e JOIN staff_shifts s ON s.employee_id=e.id
      WHERE e.active=1 AND s.status='work' AND s.work_date>=? AND s.work_date<=date(?, '+6 days')
      ORDER BY e.position,e.name,s.work_date`).bind(week,week).all()
  ]);
  const paddockHours={};for(const row of hoursResult.results)paddockHours[row.paddock]=JSON.parse(row.schedule_json);
  return{weekStart:week,horses:horseResult.results.map(row=>({id:Number(row.id),name:row.name,position:Number(row.position)})),
    tasks:taskResult.results.map(publicPlanningTask),paddockReservations:reservationResult.results.map(row=>({id:String(row.id),
      name:row.name,paddock:row.paddock,date:row.date,time:row.time,duration:Number(row.duration)})),paddockHours,
    paddockRequests:requestResult.results.map(row=>({id:String(row.id),date:row.date,name:row.name})),
    employees:[...employeeResult.results.reduce((map,row)=>{
      if(!map.has(row.id))map.set(row.id,{id:Number(row.id),name:row.name,color:row.color,workDates:[]});
      map.get(row.id).workDates.push(row.work_date);return map;
    },new Map()).values()]};
}

function validatePlanningTask(input){
  const weekStart=validWeekStart(input?.weekStart);const horseId=Number(input?.horseId);const dayIndex=Number(input?.dayIndex);
  const type=String(input?.type||"");const description=String(input?.description||"").trim();const paddock=String(input?.paddock||"").trim();
  const startsAt=String(input?.startsAt||"").trim()||null;const endsAt=String(input?.endsAt||"").trim()||null;
  const requestId=input?.requestId?Number(input.requestId):null;
  const employeeId=input?.employeeId?Number(input.employeeId):null;
  if(!weekStart||!Number.isInteger(horseId)||horseId<1||!Number.isInteger(dayIndex)||dayIndex<0||dayIndex>6)return{error:"Semaine, cheval ou jour invalide"};
  if(!["paddock","travail","longe","repos","concours","proprietaire","autre"].includes(type))return{error:"Type de tâche invalide"};
  if(description.length>300)return{error:"Description trop longue"};
  if(type==="autre"&&!description)return{error:"Le texte de la tâche est obligatoire"};
  if(type==="paddock"&&(!paddock||!/^\d{2}:\d{2}$/.test(startsAt||"")||!/^\d{2}:\d{2}$/.test(endsAt||"")))return{error:"Paddock et horaires obligatoires"};
  if(requestId!==null&&(!Number.isInteger(requestId)||requestId<1))return{error:"Demande liée invalide"};
  if(employeeId!==null&&(!Number.isInteger(employeeId)||employeeId<1))return{error:"Salarié invalide"};
  return{weekStart,horseId,dayIndex,type,description,paddock:type==="paddock"?paddock:"",startsAt:type==="paddock"?startsAt:null,
    endsAt:type==="paddock"?endsAt:null,requestId,employeeId};
}

async function planningEmployeeAvailable(env,employeeId,weekStart,dayIndex){
  if(!employeeId)return true;
  const date=addIsoDays(weekStart,dayIndex);
  const row=await env.DB.prepare(`SELECT 1 ok FROM staff_employees e
    JOIN staff_shifts s ON s.employee_id=e.id
    WHERE e.id=? AND e.active=1 AND s.work_date=? AND s.status='work'`).bind(employeeId,date).first();
  return Boolean(row);
}

function validStaffMonth(value){
  const month=String(value||"");
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return"";
  return month;
}

function staffMonthRange(month){
  const valid=validStaffMonth(month);
  if(!valid)return null;
  const [year,monthNumber]=valid.split("-").map(Number);
  const first=new Date(Date.UTC(year,monthNumber-1,1));
  const last=new Date(Date.UTC(year,monthNumber,0));
  const mondayOffset=(first.getUTCDay()+6)%7;
  const sundayOffset=6-((last.getUTCDay()+6)%7);
  const start=new Date(first);start.setUTCDate(start.getUTCDate()-mondayOffset);
  const end=new Date(last);end.setUTCDate(end.getUTCDate()+sundayOffset);
  const iso=date=>date.toISOString().slice(0,10);
  return{start:iso(start),end:iso(end)};
}

function validStaffColor(value){
  const color=String(value||"").trim();
  return /^#[0-9a-f]{6}$/i.test(color)?color.toUpperCase():"#F27D2C";
}

function googleCalendarIcalUrls(env){
  return[
    env.GOOGLE_CALENDAR_ICAL_URL,
    env.GOOGLE_CALENDAR_PERSONAL_ICAL_URL,
    env.GOOGLE_CALENDAR_GROUP_ICAL_URL
  ].map(value=>String(value||"").trim()).filter(Boolean);
}

function decodeIcsText(value){
  return String(value||"").replace(/\\n/gi,"\n").replace(/\\,/g,",").replace(/\\;/g,";").replace(/\\\\/g,"\\");
}

function parseIcsDate(value,allDay){
  const text=String(value||"").trim();
  if(!/^\d{8}(T\d{6}Z?)?$/.test(text))return"";
  const date=`${text.slice(0,4)}-${text.slice(4,6)}-${text.slice(6,8)}`;
  if(allDay||text.length===8)return date;
  const time=`${text.slice(9,11)}:${text.slice(11,13)}:${text.slice(13,15)}`;
  return `${date}T${time}${text.endsWith("Z")?"Z":""}`;
}

function parseIcsCalendar(source,month,calendar=null){
  const valid=validStaffMonth(month);
  if(!valid)return[];
  const unfolded=String(source||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").replace(/\n[ \t]/g,"");
  const calendarName=decodeIcsText(unfolded.match(/^X-WR-CALNAME:(.*)$/m)?.[1]||`Calendrier ${(calendar?.index??0)+1}`).trim();
  const first=`${valid}-01`;
  const [year,number]=valid.split("-").map(Number);
  const last=new Date(Date.UTC(year,number,0)).toISOString().slice(0,10);
  const events=[];
  for(const match of unfolded.matchAll(/BEGIN:VEVENT\n([\s\S]*?)\nEND:VEVENT/g)){
    const properties={};
    for(const line of match[1].split("\n")){
      const separator=line.indexOf(":");
      if(separator<1)continue;
      const keyPart=line.slice(0,separator);
      const key=keyPart.split(";")[0].toUpperCase();
      if(!(key in properties))properties[key]={value:line.slice(separator+1),params:keyPart};
    }
    if(String(properties.STATUS?.value||"").toUpperCase()==="CANCELLED")continue;
    const allDay=/VALUE=DATE/i.test(properties.DTSTART?.params||"")||
      /^\d{8}$/.test(properties.DTSTART?.value||"");
    const start=parseIcsDate(properties.DTSTART?.value,allDay);
    if(!start)continue;
    const fallbackEnd=allDay?addIsoDays(start,1):start;
    const end=parseIcsDate(properties.DTEND?.value,allDay)||fallbackEnd;
    const startDate=start.slice(0,10);
    const effectiveEnd=allDay&&end>start?addIsoDays(end,-1):end.slice(0,10);
    if(startDate>last||effectiveEnd<first)continue;
    const event={
      id:String(properties.UID?.value||`${start}-${events.length}`).slice(0,240),
      title:decodeIcsText(properties.SUMMARY?.value||"Sans titre").slice(0,240),
      start,end,date:startDate,allDay,
      location:decodeIcsText(properties.LOCATION?.value||"").slice(0,240),
      htmlLink:""
    };
    if(calendar){
      event.calendarName=calendarName;
      event.calendarColor=calendar.color;
      event.calendarIndex=calendar.index;
    }
    events.push(event);
  }
  return events.sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title,"fr")).slice(0,1000);
}

function addIsoDays(value,count){
  const date=new Date(value+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()+count);
  return date.toISOString().slice(0,10);
}

function isIsoDate(value){
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+"T12:00:00Z"));
}

function isStaffWeekStart(value){
  return isIsoDate(value)&&new Date(value+"T12:00:00Z").getUTCDay()===1;
}

function staffMinutes(start,end){
  if(!start&&!end)return 0;
  if(!/^\d{2}:\d{2}$/.test(start||"")||!/^\d{2}:\d{2}$/.test(end||""))return null;
  const from=timeToMinutes(start),to=timeToMinutes(end);
  if(from===null||to===null||to<=from)return null;
  return to-from;
}

function validateStaffShift(input){
  const employeeId=Number(input?.employeeId);const date=String(input?.date||"");
  const status=String(input?.status||"work").toLowerCase();
  const morningStart=String(input?.morningStart||"").trim()||null;
  const morningEnd=String(input?.morningEnd||"").trim()||null;
  const afternoonStart=String(input?.afternoonStart||"").trim()||null;
  const afternoonEnd=String(input?.afternoonEnd||"").trim()||null;
  const note=String(input?.note||"").trim();
  if(!Number.isInteger(employeeId)||employeeId<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+"T12:00:00Z").getTime()))
    return{error:"Salarié ou date invalide"};
  if(!["work","rest","leave","sick","absence","cfa"].includes(status))return{error:"Type de journée invalide"};
  if(note.length>200)return{error:"Note trop longue"};
  if(status!=="work")return{employeeId,date,status,morningStart:null,morningEnd:null,afternoonStart:null,afternoonEnd:null,note};
  const morningMinutes=staffMinutes(morningStart,morningEnd);
  const afternoonMinutes=staffMinutes(afternoonStart,afternoonEnd);
  if(morningMinutes===null||afternoonMinutes===null)return{error:"Les horaires de début et de fin doivent être complets et cohérents"};
  if(!morningMinutes&&!afternoonMinutes&&note==="")return{error:"Renseignez au moins une plage horaire ou une note"};
  return{employeeId,date,status,morningStart,morningEnd,afternoonStart,afternoonEnd,note,
    totalMinutes:morningMinutes+afternoonMinutes};
}

function publicStaffEmployee(row){
  return{id:Number(row.id),name:row.name,color:row.color,active:Boolean(row.active),position:Number(row.position||0)};
}

function publicStaffShift(row){
  const morning=staffMinutes(row.morning_start,row.morning_end)||0;
  const afternoon=staffMinutes(row.afternoon_start,row.afternoon_end)||0;
  return{id:Number(row.id),employeeId:Number(row.employee_id),date:row.work_date,status:row.status,
    morningStart:row.morning_start||"",morningEnd:row.morning_end||"",afternoonStart:row.afternoon_start||"",
    afternoonEnd:row.afternoon_end||"",note:row.note||"",totalMinutes:row.status==="cfa"?420:morning+afternoon};
}

async function completePaddockRequest(env,requestId,defaultComment=""){
  const current=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(requestId).first();
  if(!current)throw new Error("Demande de mise au paddock introuvable");
  if(current.status==="completed")return{request:current,duplicate:true};
  const now=new Date().toISOString();const comment=current.comment||defaultComment;
  await env.DB.prepare("UPDATE paddock_requests SET status='completed',comment=?,updated_at=? WHERE id=?").bind(comment,now,current.id).run();
  await reconcilePaddockUsage(env,{...current,status:"completed"},now);
  const updated=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(current.id).first();
  await notifyRealtime(env,"paddock-requests");await notifyRealtime(env,"paddock-accounts");
  const email=await sendPaddockRequestStatusEmail(env,updated);
  return{request:updated,email};
}

async function reconcilePaddockUsage(env,row,now=new Date().toISOString()){
  const usage=await env.DB.prepare("SELECT * FROM paddock_usages WHERE request_id=?").bind(row.id).first();
  const chargeable=row.status==="completed"&&!Boolean(row.is_free);
  if(!chargeable&&usage){
    const statements=[];
    if(usage.mode==="card")statements.push(env.DB.prepare(`UPDATE paddock_cards SET remaining=MIN(total,remaining+1),updated_at=? WHERE user_id=?`).bind(now,row.user_id));
    statements.push(env.DB.prepare("DELETE FROM paddock_usages WHERE id=?").bind(usage.id));
    await env.DB.batch(statements);
    await notifyRealtime(env,"paddock-accounts");
    return;
  }
  if(chargeable&&!usage){
    const card=await env.DB.prepare("SELECT remaining FROM paddock_cards WHERE user_id=?").bind(row.user_id).first();
    const mode=card&&Number(card.remaining)>0?"card":"invoice";
    const statements=[];
    if(mode==="card")statements.push(env.DB.prepare(`UPDATE paddock_cards SET remaining=remaining-1,updated_at=? WHERE user_id=? AND remaining>0`).bind(now,row.user_id));
    statements.push(env.DB.prepare(`INSERT OR IGNORE INTO paddock_usages(user_id,request_id,usage_date,mode,created_at) VALUES(?,?,?,?,?)`)
      .bind(row.user_id,row.id,row.date,mode,now));
    await env.DB.batch(statements);
    await notifyRealtime(env,"paddock-accounts");
  }
}

// Limite actuellement acceptée par Web Crypto dans Cloudflare Workers.
const PASSWORD_ITERATIONS=100000;
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

function validatePaddockBooking(input){
  const paddock=String(input?.paddock||"");
  const date=String(input?.date||"");
  const time=String(input?.time||"");
  const duration=Number(input?.duration);
  if(!["maison","grande","beudot"].includes(paddock))return{error:"Paddock invalide"};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return{error:"Date invalide"};
  if(!/^\d{2}:\d{2}$/.test(time)||timeToMinutes(time)===null)return{error:"Heure invalide"};
  if(![60,90].includes(duration))return{error:"Durée invalide"};
  if(duration===90&&paddock==="maison")return{error:"Les réservations de 1 h 30 sont réservées à Grande voie et Beudot"};
  return{paddock,date,time,duration,startMinutes:timeToMinutes(time)};
}

async function paddockBookingPolicyError(env,booking){
  const hours=await loadEffectivePaddockHours(env,booking.date);
  const dayName=DAY_NAMES[dayNumberFromIsoDate(booking.date)];
  const config=hours?.[booking.paddock]?.[dayName];
  if(!config||config.closed)return"Ce paddock est fermé ce jour";
  const openMinutes=timeToMinutes(config.open);
  const closeMinutes=timeToMinutes(config.close);
  if(openMinutes===null||closeMinutes===null)return"Les horaires du paddock sont indisponibles";
  if(!fitsWithinRange(booking.startMinutes,booking.duration,openMinutes,closeMinutes)){
    return"Ce créneau ne permet pas de terminer avant la fermeture du paddock";
  }
  if(normalizeClosedIntervals(config.closedIntervals).some(interval=>rangesOverlap(
    booking.startMinutes,booking.startMinutes+booking.duration,timeToMinutes(interval.open),timeToMinutes(interval.close)
  )))return"Ce paddock est fermé sur cette tranche horaire";
  if(booking.duration!==90)return"";
  const restriction=await env.DB.prepare(`SELECT block_grande_90,block_beudot_90
    FROM paddock_restrictions WHERE date=?`).bind(booking.date).first();
  if(booking.paddock==="grande"&&restriction?.block_grande_90)return"Les réservations de 1 h 30 sont indisponibles à Grande voie ce jour";
  if(booking.paddock==="beudot"&&restriction?.block_beudot_90)return"Les réservations de 1 h 30 sont indisponibles à Beudot ce jour";
  return"";
}

function fitsWithinRange(start,duration,open,close){
  if(!Number.isFinite(start)||!Number.isFinite(duration)||open===null||close===null)return false;
  if(close>open)return start>=open&&start+duration<=close;
  return start>=open||start+duration<=close;
}

function rangesOverlap(start,end,blockedStart,blockedEnd){
  if(blockedStart===null||blockedEnd===null||blockedStart===blockedEnd)return false;
  if(blockedEnd>blockedStart)return start<blockedEnd&&end>blockedStart;
  return start<blockedEnd||end>blockedStart;
}

function validatePaddockRequestDate(date,{now=new Date(),exception=null,ignoreDeadline=false,allowToday=false}={}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return"Date invalide";
  const target=new Date(date+"T12:00:00Z");
  if(Number.isNaN(target.getTime()))return"Date invalide";
  const day=target.getUTCDay();
  if(exception&&!exception.open)return exception.comment||"Les demandes sont exceptionnellement fermées pour cette date";
  if(day===0&&!exception?.open)return"Demande impossible le dimanche";
  const parts=Object.fromEntries(new Intl.DateTimeFormat("fr-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(now).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  if(date<today||(!allowToday&&date===today))return"La demande doit concerner un prochain jour";
  const tomorrowDate=new Date(today+"T12:00:00Z");tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
  const tomorrow=tomorrowDate.toISOString().slice(0,10);
  if(!ignoreDeadline&&date===tomorrow&&(Number(parts.hour)*60+Number(parts.minute))>1200)return"Demande possible uniquement jusqu’à 20h la veille";
  return"";
}

function publicPaddockRequest(row){
  return{id:String(row.id),userId:row.user_id===undefined?undefined:Number(row.user_id),name:row.name,email:row.email,
    date:row.date,status:row.status,comment:row.comment||"",createdAt:row.created_at,updatedAt:row.updated_at};
}

function publicAdminPaddockRequest(row){
  return{...publicPaddockRequest(row),free:Boolean(row.is_free)};
}

function publicProduct(row){
  return{id:row.id,category:row.category,name:row.name,description:row.description||"",price:Number(row.price_cents)/100,
    image:row.image_url||"",badge:row.badge||"",featured:Boolean(row.featured),position:Number(row.position)};
}

function validateCatalogProduct(input,requireId){
  const id=String(input?.id||"").trim();const category=String(input?.category||"");
  const name=String(input?.name||"").trim();const description=String(input?.description||"").trim();
  const price=Number(input?.price);const image=String(input?.image||"").trim();const badge=String(input?.badge||"").trim();
  const position=Number(input?.position);const featured=Boolean(input?.featured);const active=input?.active===undefined?true:Boolean(input.active);
  if((requireId||id)&&!/^[A-Za-z0-9_-]{1,40}$/.test(id))return{error:"Identifiant invalide"};
  if(!["services","soins","laverie"].includes(category))return{error:"Catégorie invalide"};
  if(!name||name.length>120||description.length>1000||badge.length>80||image.length>1000)return{error:"Contenu de l’article invalide"};
  if(image&&!/^https:\/\//i.test(image))return{error:"Adresse d’image invalide"};
  if(!Number.isFinite(price)||price<0||price>100000)return{error:"Prix invalide"};
  if(!Number.isInteger(position)||position<0||position>9999)return{error:"Ordre invalide"};
  return{id,category,name,description,priceCents:Math.round(price*100),image,badge,position,featured,active};
}

async function loadOrders(env,whereClause,bindings){
  const statement=env.DB.prepare(`SELECT o.id,o.public_id,o.user_id,o.source,o.status,o.comment,o.total_cents,o.billed,
    o.billed_at,o.created_at,o.updated_at,u.first_name,u.last_name,u.email
    FROM orders o JOIN users u ON u.id=o.user_id ${whereClause} ORDER BY o.created_at DESC,o.id DESC`);
  const result=(bindings.length?await statement.bind(...bindings).all():await statement.all()).results;
  return Promise.all(result.map(async row=>{
    const itemResult=await env.DB.prepare(`SELECT product_id,name,unit_price_cents,quantity,line_total_cents
      FROM order_items WHERE order_id=? ORDER BY id`).bind(row.id).all();
    return{id:Number(row.id),publicId:row.public_id,userId:Number(row.user_id),source:row.source,status:row.status,
      comment:row.comment||"",total:Number(row.total_cents)/100,billed:Boolean(row.billed),billedAt:row.billed_at||null,
      createdAt:row.created_at,updatedAt:row.updated_at,customer:{firstName:row.first_name,lastName:row.last_name,email:row.email},
      items:itemResult.results.map(item=>({productId:item.product_id,name:item.name,price:Number(item.unit_price_cents)/100,
        quantity:Number(item.quantity),lineTotal:Number(item.line_total_cents)/100}))};
  }));
}

async function sendOrderEmail(env,type,order,user){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={type,idempotencyKey:`${type}:${order.publicId}:${order.status}:${order.updatedAt}`,
    customer:{email:user.email,firstName:user.first_name||user.firstName,lastName:user.last_name||user.lastName},
    order:{id:order.publicId,source:order.source,total:order.total,status:order.status,comment:order.comment||"",
      items:order.items.map(item=>({name:item.name,quantity:item.quantity,lineTotal:item.lineTotal}))}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

async function loadPaddockAccount(env,userId){
  const [card,usageResult]=await Promise.all([
    env.DB.prepare("SELECT total,remaining,created_at,updated_at FROM paddock_cards WHERE user_id=?").bind(userId).first(),
    env.DB.prepare(`SELECT id,request_id,usage_date,mode,created_at FROM paddock_usages
      WHERE user_id=? ORDER BY usage_date DESC,id DESC`).bind(userId).all()
  ]);
  return{
    card:card?{total:Number(card.total),remaining:Number(card.remaining),createdAt:card.created_at,updatedAt:card.updated_at}:null,
    usages:usageResult.results.map(row=>({id:String(row.id),requestId:String(row.request_id),date:row.usage_date,
      mode:row.mode,createdAt:row.created_at}))
  };
}

async function sendPaddockRequestConfirmationEmail(env,row){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={type:"paddock_request_confirmation",idempotencyKey:`paddock-request:${row.id}`,
    customer:{email:row.email,firstName:row.name},request:{id:String(row.id),date:row.date}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

async function sendPaddockRequestStatusEmail(env,row){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={
    type:"paddock_request_status",
    idempotencyKey:`paddock-request-status:${row.id}:${row.status}:${row.updated_at}`,
    customer:{email:row.email,firstName:row.name},
    request:{id:String(row.id),date:row.date,status:row.status,comment:row.comment||""}
  };
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){
    return{requested:true,sent:false,error:String(error?.message||error)};
  }
}

async function sendPaddockReservationCancellationEmail(env,row,comment){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={type:"paddock_reservation_cancelled",
    idempotencyKey:`paddock-reservation-cancelled:${row.id}:${new Date().toISOString()}`,
    customer:{email:row.email,firstName:row.name},
    reservation:{id:String(row.id),paddock:row.paddock,date:row.date,time:row.time,duration:Number(row.duration),comment}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

async function sendPaddockReservationConfirmationEmail(env,row){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={type:"paddock_reservation_confirmation",
    idempotencyKey:`paddock-reservation:${row.id}`,
    customer:{email:row.email,firstName:row.name},
    reservation:{id:String(row.id),paddock:row.paddock,date:row.date,time:row.time,duration:Number(row.duration)}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

async function sendAccountApprovedEmail(env,user,approvedAt){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const payload={type:"account_approved",idempotencyKey:`account-approved:${user.id}:${approvedAt}`,
    customer:{email:user.email,firstName:user.first_name,lastName:user.last_name},
    account:{id:String(user.id),loginUrl:"https://damiensiri.github.io/push2-beta/connexion.html"}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

async function sendPasswordResetEmail(env,user,token,expiresAt){
  if(!env.MAILER_ENDPOINT)return{requested:true,sent:false,error:"Mailer bêta non configuré"};
  const resetUrl=`https://damiensiri.github.io/push2-beta/connexion.html?reset=${encodeURIComponent(token)}`;
  const payload={type:"password_reset",idempotencyKey:`password-reset:${user.id}:${expiresAt}`,
    customer:{email:user.email,firstName:user.first_name,lastName:user.last_name},reset:{url:resetUrl,expiresAt}};
  try{
    const response=await fetch(env.MAILER_ENDPOINT,{method:"POST",headers:{"content-type":"text/plain;charset=UTF-8"},body:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.ok)return{requested:true,sent:false,error:data.error||`Mailer HTTP ${response.status}`};
    return{requested:true,sent:Boolean(data.sent),duplicate:Boolean(data.duplicate)};
  }catch(error){return{requested:true,sent:false,error:String(error?.message||error)};}
}

function paddockLockStatements(env,{lockKey,date,paddock,startMinutes,duration}){
  const statements=[];
  for(let slot=startMinutes;slot<startMinutes+duration;slot+=30){
    statements.push(env.DB.prepare(`INSERT INTO paddock_slot_locks(date,paddock,slot_minute,reservation_key)
      VALUES(?,?,?,?)`).bind(date,paddock,slot,lockKey));
  }
  return statements;
}

function validatePaddockHours(input){
  const days=["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];
  if(!input||typeof input!=="object")return{error:"Horaires invalides"};
  const value={};
  for(const day of days){
    const row=input[day];if(!row)return{error:"Les sept jours sont obligatoires"};
    const open=String(row.open||"");const close=String(row.close||"");
    if(timeToMinutes(open)===null||timeToMinutes(close)===null)return{error:"Horaire invalide"};
    value[day]={closed:Boolean(row.closed),open,close};
  }
  return{value};
}

function publicUser(user){
  return{id:Number(user.id),email:user.email,firstName:user.first_name,lastName:user.last_name,
    cardNumber:user.card_number||"",role:user.role,status:user.status,approvalStatus:user.approval_status||"approved",
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

const THEME_NAMES=["summer","autumn","christmas","winter","spring"];

function assertThemeConfig(env){
  if(!env.THEME_CONFIG_URL)throw new Error("Configuration thème non branchée");
}

function appScriptUrl(env){
  const url=new URL(env.THEME_CONFIG_URL);
  url.searchParams.set("_",String(Date.now()));
  return url.toString();
}

async function readThemeConfig(env){
  assertThemeConfig(env);
  const response=await fetch(appScriptUrl(env),{cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false)throw new Error(data?.error||"Lecture du thème impossible");
  const theme=String(data?.theme||data?.activeTheme||data?.currentTheme||"").trim().toLowerCase();
  if(!THEME_NAMES.includes(theme))throw new Error("Thème publié inconnu");
  return{theme,updatedAt:data?.updatedAt||""};
}

async function publishThemeConfig(env,theme){
  assertThemeConfig(env);
  if(!THEME_NAMES.includes(theme))throw new Error("Thème invalide");
  if(!env.THEME_ADMIN_TOKEN)throw new Error("Code thème non configuré côté Worker");
  const response=await fetch(appScriptUrl(env),{
    method:"POST",
    headers:{"content-type":"text/plain;charset=UTF-8"},
    body:JSON.stringify({action:"setTheme",theme,token:env.THEME_ADMIN_TOKEN}),
    cache:"no-store"
  });
  const data=await response.json().catch(()=>({}));
  if(!response.ok||data?.ok===false)throw new Error(data?.error||"Publication du thème impossible");
  const publishedTheme=String(data?.theme||theme).trim().toLowerCase();
  if(!THEME_NAMES.includes(publishedTheme))throw new Error("Thème publié invalide");
  return{theme:publishedTheme,updatedAt:data?.updatedAt||new Date().toISOString()};
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

async function sendAdminEventPush(env,title,message,page){
  if(!isPushEnabled(env))return{sent:false,disabled:true};
  try{
    const result=await env.DB.prepare("SELECT subscription_id FROM admin_push_subscriptions ORDER BY updated_at DESC").all();
    const subscriptionIds=result.results.map(row=>row.subscription_id).filter(Boolean);
    if(!subscriptionIds.length)return{sent:false,noSubscribers:true};
    const response=await fetch("https://api.onesignal.com/notifications",{method:"POST",headers:{
      "authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`,"content-type":"application/json; charset=utf-8"},body:JSON.stringify({
        app_id:env.ONESIGNAL_APP_ID,include_subscription_ids:subscriptionIds,
        headings:{fr:title,en:title},contents:{fr:message,en:message},
        url:`https://damiensiri.github.io/backstage-beta/${page}`
      })});
    const data=await response.json().catch(()=>({}));
    return{sent:Boolean(response.ok&&data.id),id:data.id||null,error:data.errors||null};
  }catch(error){
    return{sent:false,error:String(error?.message||error)};
  }
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
  compatibleAlert,validateAlert,validateScheduledNotification,parisNow,parisDateTime,isPushEnabled,sendRequestedPush,plainTextMessage,
  calculateStatus,publicSpace,publicSchedule,validateSpace,validateSchedules,timeToMinutes,effectiveActivityValue,parisClock,findNextSpaceOpening,
  normalizeEmail,validatePassword,validateNewUser,hashPassword,verifyPassword,publicUser,validatePaddockBooking,validatePaddockHours,
  parisLocalMinute,reservationLocalMinute,duePaddockReminderTypes,isValidPushSubscriptionId,isValidPushInstallationId,processPaddockPushReminders,
  processScheduledNotifications,validatePaddockRequestDate,validStaffMonth,staffMonthRange,staffMinutes,validateStaffShift,isStaffWeekStart,addIsoDays,
  parseIcsCalendar,googleCalendarIcalUrls
};
