const JSON_HEADERS={
  "content-type":"application/json; charset=utf-8",
  "cache-control":"no-store",
  "x-content-type-options":"nosniff"
};

export default{
  async scheduled(controller,env,ctx){
    ctx.waitUntil(processPaddockPushReminders(env,new Date(controller.scheduledTime)));
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
          if(!isValidPushSubscriptionId(subscriptionId))return json({error:"Abonnement push invalide"},400,cors);
          if(request.method==="PUT"){
            const now=new Date().toISOString();
            await env.DB.prepare(`INSERT INTO user_push_subscriptions(subscription_id,user_id,created_at,updated_at)
              VALUES(?,?,?,?) ON CONFLICT(subscription_id) DO UPDATE SET user_id=excluded.user_id,updated_at=excluded.updated_at`)
              .bind(subscriptionId,viewer.id,now,now).run();
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
        return json({order,email},201,cors);
      }

      if(url.pathname==="/api/paddocks/planning"&&request.method==="GET"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const [reservationResult,hoursResult,restrictionResult]=await Promise.all([
          env.DB.prepare(`SELECT id,user_id,name,paddock,date,time,duration FROM paddock_reservations
            WHERE date>=date('now') ORDER BY date,time`).all(),
          env.DB.prepare("SELECT paddock,schedule_json FROM paddock_hours").all(),
          env.DB.prepare("SELECT date,block_grande_90,block_beudot_90 FROM paddock_restrictions WHERE date>=date('now')").all()
        ]);
        const hours={};
        for(const row of hoursResult.results)hours[row.paddock]=JSON.parse(row.schedule_json);
        const restrictions={};
        for(const row of restrictionResult.results)restrictions[row.date]={blockGrande90:Boolean(row.block_grande_90),blockBeudot90:Boolean(row.block_beudot_90)};
        return json({
          reservations:reservationResult.results.map(row=>({id:String(row.id),name:row.name,paddock:row.paddock,
            date:row.date,time:row.time,duration:Number(row.duration),mine:Number(row.user_id)===Number(viewer.id)})),
          horaires:hours,restrictions,
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
        return json(await loadPaddockAccount(env,viewer.id),200,cors);
      }

      if(url.pathname==="/api/paddocks/requests"&&request.method==="POST"){
        const viewer=await authenticatedUser(request,env);
        if(!viewer)return json({error:"Non autorisé"},401,cors);
        const input=await readJson(request);
        const date=String(input?.date||"");
        const dateError=validatePaddockRequestDate(date);
        if(dateError)return json({error:dateError},400,cors);
        const now=new Date().toISOString();
        try{
          const result=await env.DB.prepare(`INSERT INTO paddock_requests(user_id,name,email,date,status,comment,created_at,updated_at)
            VALUES(?,?,?,?,'pending','',?,?)`).bind(viewer.id,viewer.first_name,viewer.email,date,now,now).run();
          const created=await env.DB.prepare(`SELECT id,date,status,comment,created_at,updated_at
            FROM paddock_requests WHERE id=?`).bind(result.meta.last_row_id).first();
          await notifyRealtime(env,"paddock-requests");
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
        return json({deleted:true},200,cors);
      }

      if(url.pathname.startsWith("/api/admin/")){
        if(!isAdmin(request,env))return json({error:"Non autorisé"},401,cors);

        if(request.method==="GET"&&url.pathname==="/api/admin/operations"){
          return json(await loadOperations(env),200,cors);
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

        if(request.method==="GET"&&url.pathname==="/api/admin/catalog"){
          const result=await env.DB.prepare(`SELECT id,category,name,description,price_cents,image_url,badge,featured,active,position,updated_at
            FROM catalog_products ORDER BY category,position,id`).all();
          return json({products:result.results.map(row=>({...publicProduct(row),active:Boolean(row.active),updatedAt:row.updated_at}))},200,cors);
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
          const rows=await env.DB.prepare("SELECT id FROM catalog_products WHERE category=? ORDER BY position,id").bind(category).all();
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

        if(request.method==="GET"&&url.pathname==="/api/admin/paddocks"){
          const [reservationResult,hoursResult,restrictionResult,requestResult]=await Promise.all([
            env.DB.prepare(`SELECT id,name,email,paddock,date,time,duration FROM paddock_reservations
              WHERE date>=date('now') ORDER BY date,time`).all(),
            env.DB.prepare("SELECT paddock,schedule_json FROM paddock_hours").all(),
            env.DB.prepare("SELECT date,block_grande_90,block_beudot_90 FROM paddock_restrictions WHERE date>=date('now')").all(),
            env.DB.prepare(`SELECT id,user_id,name,email,date,status,comment,created_at,updated_at
              FROM paddock_requests ORDER BY date DESC,id DESC`).all()
          ]);
          const hours={};for(const row of hoursResult.results)hours[row.paddock]=JSON.parse(row.schedule_json);
          const restrictions={};for(const row of restrictionResult.results)restrictions[row.date]={blockGrande90:Boolean(row.block_grande_90),blockBeudot90:Boolean(row.block_beudot_90)};
          return json({reservations:reservationResult.results.map(row=>({...row,id:String(row.id),duration:Number(row.duration)})),
            requests:requestResult.results.map(publicPaddockRequest),horaires:hours,restrictions},200,cors);
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
          if(!["pending","accepted","refused","completed","cancelled"].includes(status))return json({error:"Statut invalide"},400,cors);
          if(comment.length>500)return json({error:"Commentaire trop long"},400,cors);
          const current=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(Number(adminPaddockRequest[1])).first();
          if(!current)return json({error:"Demande introuvable"},404,cors);
          const now=new Date().toISOString();
          if(current.status!=="completed"&&status==="completed"){
            const existingUsage=await env.DB.prepare("SELECT id FROM paddock_usages WHERE request_id=?").bind(current.id).first();
            if(!existingUsage){
              const card=await env.DB.prepare("SELECT remaining FROM paddock_cards WHERE user_id=?").bind(current.user_id).first();
              const mode=card&&Number(card.remaining)>0?"card":"invoice";
              const statements=[
                env.DB.prepare("UPDATE paddock_requests SET status=?,comment=?,updated_at=? WHERE id=?").bind(status,comment,now,current.id),
                env.DB.prepare(`INSERT INTO paddock_usages(user_id,request_id,usage_date,mode,created_at)
                  VALUES(?,?,?,?,?)`).bind(current.user_id,current.id,current.date,mode,now)
              ];
              if(mode==="card")statements.push(env.DB.prepare(`UPDATE paddock_cards SET remaining=remaining-1,updated_at=?
                WHERE user_id=? AND remaining>0`).bind(now,current.user_id));
              await env.DB.batch(statements);
            }else{
              await env.DB.prepare("UPDATE paddock_requests SET status=?,comment=?,updated_at=? WHERE id=?")
                .bind(status,comment,now,current.id).run();
            }
          }else{
            await env.DB.prepare("UPDATE paddock_requests SET status=?,comment=?,updated_at=? WHERE id=?")
              .bind(status,comment,now,current.id).run();
          }
          const updated=await env.DB.prepare("SELECT * FROM paddock_requests WHERE id=?").bind(current.id).first();
          await notifyRealtime(env,"paddock-requests");
          const statusChanged=current.status!==status;
          let email={requested:false,sent:false};
          if(statusChanged)email=await sendPaddockRequestStatusEmail(env,updated);
          return json({request:publicPaddockRequest(updated),statusChanged,email},200,cors);
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
          await env.DB.prepare(`INSERT INTO paddock_cards(user_id,total,remaining,created_at,updated_at) VALUES(?,?,?,?,?)
            ON CONFLICT(user_id) DO UPDATE SET total=excluded.total,remaining=excluded.remaining,updated_at=excluded.updated_at`)
            .bind(userId,total,remaining,now,now).run();
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
      const claim=await env.DB.prepare(`INSERT OR IGNORE INTO paddock_push_reminders(reservation_id,reminder_type,claimed_at)
        VALUES(?,?,?)`).bind(reservation.id,type,claimedAt).run();
      if(!claim.meta.changes)continue;
      const push=await sendPaddockReminderPush(env,reservation,type,subscriptionIds);
      if(push.sent){
        await env.DB.prepare("UPDATE paddock_push_reminders SET sent_at=?,onesignal_notification_id=? WHERE reservation_id=? AND reminder_type=?")
          .bind(new Date().toISOString(),push.id||null,reservation.id,type).run();sent++;
      }else{
        await env.DB.prepare("DELETE FROM paddock_push_reminders WHERE reservation_id=? AND reminder_type=? AND sent_at IS NULL")
          .bind(reservation.id,type).run();
      }
    }
  }
  return{processed:result.results.length,sent};
}

async function sendPaddockReminderPush(env,reservation,type,subscriptionIds){
  const paddock=({maison:"Maison",grande:"Grande voie",beudot:"Beudot"})[reservation.paddock]||reservation.paddock;
  const title=type==="start_1h"?"Rappel de votre réservation paddock":"Fin de votre réservation paddock";
  const message=type==="start_1h"
    ?`Votre réservation au paddock ${paddock} commence dans 1 heure, à ${reservation.time}.`
    :`Votre réservation au paddock ${paddock} se termine dans 5 minutes. Merci de libérer le paddock.`;
  try{
    const response=await fetch("https://api.onesignal.com/notifications",{method:"POST",headers:{
      "authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`,"content-type":"application/json; charset=utf-8"},body:JSON.stringify({
        app_id:env.ONESIGNAL_APP_ID,include_subscription_ids:subscriptionIds,
        headings:{fr:title,en:title},contents:{fr:message,en:message},url:"https://damiensiri.github.io/push2-beta/mesreservations.html"
      })});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.errors||!data.id)return{sent:false,error:data.errors||"Aucun appareil push actif"};
    return{sent:true,id:data.id};
  }catch(error){return{sent:false,error:String(error?.message||error)};}
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
  return{paddock,date,time,duration,startMinutes:timeToMinutes(time)};
}

function validatePaddockRequestDate(date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return"Date invalide";
  const target=new Date(date+"T12:00:00Z");
  if(Number.isNaN(target.getTime()))return"Date invalide";
  const day=target.getUTCDay();
  if(day===0||day===6)return"Demande impossible le week-end";
  const parts=Object.fromEntries(new Intl.DateTimeFormat("fr-CA",{
    timeZone:"Europe/Paris",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"
  }).formatToParts(new Date()).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
  const today=`${parts.year}-${parts.month}-${parts.day}`;
  if(date<=today)return"La demande doit concerner un prochain jour";
  const tomorrowDate=new Date(today+"T12:00:00Z");tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
  const tomorrow=tomorrowDate.toISOString().slice(0,10);
  if(date===tomorrow&&(Number(parts.hour)*60+Number(parts.minute))>1200)return"Demande possible uniquement jusqu’à 20h la veille";
  return"";
}

function publicPaddockRequest(row){
  return{id:String(row.id),userId:row.user_id===undefined?undefined:Number(row.user_id),name:row.name,email:row.email,
    date:row.date,status:row.status,comment:row.comment||"",createdAt:row.created_at,updatedAt:row.updated_at};
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
  normalizeEmail,validatePassword,validateNewUser,hashPassword,verifyPassword,publicUser,validatePaddockBooking,validatePaddockHours,
  parisLocalMinute,reservationLocalMinute,duePaddockReminderTypes,isValidPushSubscriptionId,processPaddockPushReminders
};
