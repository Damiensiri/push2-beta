/** Added only to Mailer Beta. Existing mail flows are delegated unchanged. */
function doPost(e) {
  var payload;
  try { payload = readPayload_(e); } catch (error) { return jsonResponse_({ok:false,definitelyNotSent:true,error:String(error.message)}); }
  if (payload.type !== 'horse_health_reminder') return legacyDoPost_(e);
  return healthReminderMail_(payload);
}
function healthReminderMail_(payload) {
  if (!Number.isInteger(payload.notificationId) || payload.notificationId < 1 || !/^[a-f0-9-]{36}$/.test(String(payload.token || ''))) return jsonResponse_({ok:false,definitelyNotSent:true,error:'Rappel invalide'});
  var lock = LockService.getScriptLock(), started = false;
  try {
    lock.waitLock(10000);
    var key = 'horse-health:' + payload.notificationId + ':' + payload.token;
    var cache = CacheService.getScriptCache(), existing = cache.get(key);
    if (existing === 'sent') return jsonResponse_({ok:true,sent:false,duplicate:true});
    if (existing) return jsonResponse_({ok:false,error:'Envoi déjà engagé, résultat à vérifier'});
    var response = UrlFetchApp.fetch('https://ecurie-notifications-beta.damiensiri-pro.workers.dev/api/horse-mail/resolve', {
      method:'post',contentType:'application/json',payload:JSON.stringify({id:payload.notificationId,token:payload.token}),muteHttpExceptions:true
    });
    if (response.getResponseCode() !== 200) return jsonResponse_({ok:false,definitelyNotSent:true,error:'Rappel annulé ou indisponible'});
    var data = JSON.parse(response.getContentText());
    if (!data.email || !data.horseName || !data.label || !validDate_(data.nextDueOn)) return jsonResponse_({ok:false,definitelyNotSent:true,error:'Rappel incomplet'});
    if (MailApp.getRemainingDailyQuota() <= MAILER_BETA.quotaReserve) return jsonResponse_({ok:false,definitelyNotSent:true,error:'Quota email insuffisant'});
    var subject = 'Rappel de suivi : ' + data.horseName;
    var body = 'Bonjour ' + (data.firstName || '') + ',\n\nLe suivi « ' + data.label + ' » de ' + data.horseName + ' arrive à échéance le ' + dateFr_(data.nextDueOn) + '.\n\nRetrouvez les informations dans Mes chevaux :\nhttps://damiensiri.github.io/push2-beta/mes-chevaux.html\n\nÉcurie Damien Siri';
    cache.put(key,'attempted',21600);
    started = true;
    MailApp.sendEmail({to:data.email,subject:subject,body:body,name:MAILER_BETA.senderName});
    cache.put(key,'sent',21600);
    return jsonResponse_({ok:true,sent:true,duplicate:false});
  } catch (error) {
    return jsonResponse_({ok:false,definitelyNotSent:!started,error:started?'Résultat de l’envoi à vérifier':'Service temporairement indisponible'});
  } finally { try { lock.releaseLock(); } catch (_) {} }
}
