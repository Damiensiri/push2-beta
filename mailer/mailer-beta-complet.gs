/**
 * Mailer Écurie D. Siri — BÊTA
 * Google Apps Script utilisé uniquement pour l'envoi des emails.
 * Les données sont stockées dans Cloudflare D1 bêta.
 */

const MAILER_BETA = Object.freeze({
  senderName: "Écurie Damien Siri",
  managerCopy: "",
  duplicateSeconds: 21600,
  quotaReserve: 10,
  acceptedTypes: Object.freeze([
    "order_confirmation",
    "order_status",
    "account_approved",
    "password_reset",
    "paddock_request_confirmation",
    "paddock_request_status",
    "paddock_reservation_confirmation",
    "paddock_reservation_cancelled"
  ])
});

function doGet() {
  return jsonResponse_({ ok: true, service: "mailer-beta", version: "2026-09-06-horse-health" });
}

function legacyDoPost_(e) {
  try {
    const payload = readPayload_(e);
    validateBase_(payload);

    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (isDuplicate_(payload.idempotencyKey)) {
        return jsonResponse_({ ok: true, sent: false, duplicate: true });
      }

      if (MailApp.getRemainingDailyQuota() <= MAILER_BETA.quotaReserve) {
        throw new Error("Quota email bêta insuffisant.");
      }

      const message = buildMessage_(payload);
      sendMessage_(message);
      remember_(payload.idempotencyKey);

      return jsonResponse_({
        ok: true,
        sent: true,
        duplicate: false,
        type: payload.type,
        referenceId: message.referenceId
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error("Mailer bêta", error);
    return jsonResponse_({
      ok: false,
      sent: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function buildMessage_(payload) {
  if (payload.type === "account_approved") return accountApproved_(payload);
  if (payload.type === "password_reset") return passwordReset_(payload);
  if (payload.type === "order_confirmation") return orderConfirmation_(payload);
  if (payload.type === "order_status") return orderStatus_(payload);
  if (payload.type === "paddock_request_confirmation") return paddockRequestConfirmation_(payload);
  if (payload.type === "paddock_request_status") return paddockRequestStatus_(payload);
  if (payload.type === "paddock_reservation_confirmation") return paddockReservationConfirmation_(payload);
  if (payload.type === "paddock_reservation_cancelled") return paddockReservationCancelled_(payload);
  throw new Error("Type de message non autorisé.");
}

function passwordReset_(payload) {
  const customer = validateCustomer_(payload.customer);
  const reset = payload.reset || {};
  const url = String(reset.url || "").trim();
  if (!/^https:\/\//.test(url)) throw new Error("Lien de réinitialisation invalide.");
  return {
    referenceId: customer.email,
    to: customer.email,
    copyManager: false,
    subject: "Réinitialisation de votre mot de passe",
    body: "Bonjour " + customer.firstName + ",\n\nUne demande de réinitialisation de votre mot de passe a été effectuée. Ce lien est valable 30 minutes et ne peut être utilisé qu’une fois :\n\n" + url + "\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Une demande de réinitialisation de votre mot de passe a été effectuée.</p><p>Ce lien est valable <strong>30 minutes</strong> et ne peut être utilisé qu’une fois.</p><p><a href=\"" + escapeHtml_(url) + "\" style=\"display:inline-block;padding:12px 18px;border-radius:10px;background:#277fc1;color:#fff;text-decoration:none;font-weight:bold\">Choisir un nouveau mot de passe</a></p><p>Si vous n’êtes pas à l’origine de cette demande, ignorez simplement ce message.</p><p>Écurie Damien Siri</p>"
  };
}

function accountApproved_(payload) {
  const customer = validateCustomer_(payload.customer);
  const account = payload.account || {};
  const loginUrl = String(account.loginUrl || "").trim();
  if (!/^https:\/\//.test(loginUrl)) throw new Error("Lien de connexion invalide.");
  return {
    referenceId: clean_(account.id) || customer.email,
    to: customer.email,
    copyManager: false,
    subject: "Votre accès à l’application Écurie D. Siri est validé",
    body: "Bonjour " + customer.firstName + ",\n\nVotre demande de compte a été acceptée. Vous pouvez maintenant vous connecter avec l’adresse email et le mot de passe choisis lors de votre inscription.\n\nConnexion : " + loginUrl + "\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre demande de compte a été <strong>acceptée</strong>.</p><p>Vous pouvez maintenant vous connecter avec l’adresse email et le mot de passe choisis lors de votre inscription.</p><p><a href=\"" + escapeHtml_(loginUrl) + "\" style=\"display:inline-block;padding:12px 18px;border-radius:10px;background:#277fc1;color:#fff;text-decoration:none;font-weight:bold\">Se connecter à l’application</a></p><p>Écurie Damien Siri</p>"
  };
}

function orderConfirmation_(payload) {
  const customer = validateCustomer_(payload.customer);
  const order = validateOrder_(payload.order);
  const lines = order.items.map(item => item.quantity + " × " + item.name + " — " + euro_(item.lineTotal));
  const htmlLines = order.items.map(item =>
    "<li>" + item.quantity + " × " + escapeHtml_(item.name) + " — <strong>" + escapeHtml_(euro_(item.lineTotal)) + "</strong></li>"
  ).join("");
  return {
    referenceId: order.id,
    to: customer.email,
    copyManager: true,
    subject: "Confirmation de votre commande #" + order.id,
    body: "Bonjour " + customer.firstName + ",\n\nVotre commande #" + order.id + " a bien été enregistrée.\n\n" +
      lines.join("\n") + "\n\nTotal : " + euro_(order.total) +
      "\n\nVous pourrez suivre son statut depuis l’application.\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre commande <strong>#" +
      escapeHtml_(order.id) + "</strong> a bien été enregistrée.</p><ul>" + htmlLines +
      "</ul><p><strong>Total : " + escapeHtml_(euro_(order.total)) +
      "</strong></p><p>Vous pourrez suivre son statut depuis l’application.</p><p>Écurie Damien Siri</p>"
  };
}

function orderStatus_(payload) {
  const customer = validateCustomer_(payload.customer);
  const order = validateOrder_(payload.order);
  const status = orderStatusLabel_(order.status);
  const commentPlain = order.comment ? "\n\nMessage :\n" + order.comment : "";
  const commentHtml = order.comment ? "<p><strong>Message :</strong><br>" + escapeHtml_(order.comment).replace(/\n/g, "<br>") + "</p>" : "";
  return {
    referenceId: order.id,
    to: customer.email,
    copyManager: false,
    subject: "Mise à jour de votre commande #" + order.id,
    body: "Bonjour " + customer.firstName + ",\n\nLe statut de votre commande #" + order.id +
      " a été mis à jour.\n\nNouveau statut : " + status + commentPlain + "\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Le statut de votre commande <strong>#" +
      escapeHtml_(order.id) + "</strong> a été mis à jour.</p><p><strong>Nouveau statut : " +
      escapeHtml_(status) + "</strong></p>" + commentHtml + "<p>Écurie Damien Siri</p>"
  };
}

function paddockRequestConfirmation_(payload) {
  const customer = validateCustomer_(payload.customer);
  const request = payload.request || {};
  const date = validDate_(request.date);
  return {
    referenceId: "mise-" + date,
    to: customer.email,
    copyManager: true,
    subject: "Demande de mise au paddock enregistrée",
    body: "Bonjour " + customer.firstName + ",\n\nVotre demande de mise au paddock pour le " + dateFr_(date) +
      " a bien été enregistrée.\n\nStatut : En attente de confirmation.\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre demande de mise au paddock pour le <strong>" +
      escapeHtml_(dateFr_(date)) + "</strong> a bien été enregistrée.</p><p><strong>Statut : En attente de confirmation.</strong></p><p>Écurie Damien Siri</p>"
  };
}

function paddockRequestStatus_(payload) {
  const customer = validateCustomer_(payload.customer);
  const request = payload.request || {};
  const id = clean_(request.id);
  const date = validDate_(request.date);
  const status = paddockRequestStatusLabel_(clean_(request.status));
  const comment = cleanComment_(request.comment);
  const commentPlain = comment ? "\n\nMessage :\n" + comment : "";
  const commentHtml = comment ? "<p><strong>Message :</strong><br>" + escapeHtml_(comment).replace(/\n/g, "<br>") + "</p>" : "";
  return {
    referenceId: id,
    to: customer.email,
    copyManager: false,
    subject: "Mise à jour de votre demande de paddock",
    body: "Bonjour " + customer.firstName + ",\n\nVotre demande du " + dateFr_(date) +
      " a été mise à jour.\n\nNouveau statut : " + status + commentPlain + "\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre demande du <strong>" +
      escapeHtml_(dateFr_(date)) + "</strong> a été mise à jour.</p><p><strong>Nouveau statut : " +
      escapeHtml_(status) + "</strong></p>" + commentHtml + "<p>Écurie Damien Siri</p>"
  };
}

function paddockReservationConfirmation_(payload) {
  const customer = validateCustomer_(payload.customer);
  const reservation = validateReservation_(payload.reservation);
  return {
    referenceId: reservation.id,
    to: customer.email,
    copyManager: false,
    subject: "Confirmation de votre réservation paddock",
    body: "Bonjour " + customer.firstName + ",\n\nVotre réservation est confirmée.\n\nPaddock : " +
      paddockLabel_(reservation.paddock) + "\nDate : " + dateFr_(reservation.date) + "\nHeure : " +
      reservation.time + "\nDurée : " + reservation.duration + " minutes\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre réservation est confirmée.</p><ul><li><strong>Paddock :</strong> " +
      escapeHtml_(paddockLabel_(reservation.paddock)) + "</li><li><strong>Date :</strong> " + escapeHtml_(dateFr_(reservation.date)) +
      "</li><li><strong>Heure :</strong> " + escapeHtml_(reservation.time) + "</li><li><strong>Durée :</strong> " +
      reservation.duration + " minutes</li></ul><p>Écurie Damien Siri</p>"
  };
}

function paddockReservationCancelled_(payload) {
  const customer = validateCustomer_(payload.customer);
  const reservation = validateReservation_(payload.reservation);
  const comment = cleanComment_(payload.reservation.comment);
  const commentPlain = comment ? "\n\nMessage :\n" + comment : "";
  const commentHtml = comment ? "<p><strong>Message :</strong><br>" + escapeHtml_(comment).replace(/\n/g, "<br>") + "</p>" : "";
  return {
    referenceId: reservation.id,
    to: customer.email,
    copyManager: false,
    subject: "Annulation de votre réservation paddock",
    body: "Bonjour " + customer.firstName + ",\n\nVotre réservation du " + dateFr_(reservation.date) + " à " +
      reservation.time + " pour le paddock " + paddockLabel_(reservation.paddock) + " a été annulée." +
      commentPlain + "\n\nÉcurie Damien Siri",
    htmlBody: "<p>Bonjour " + escapeHtml_(customer.firstName) + ",</p><p>Votre réservation du <strong>" +
      escapeHtml_(dateFr_(reservation.date)) + " à " + escapeHtml_(reservation.time) + "</strong> pour le paddock <strong>" +
      escapeHtml_(paddockLabel_(reservation.paddock)) + "</strong> a été annulée.</p>" + commentHtml + "<p>Écurie Damien Siri</p>"
  };
}

function sendMessage_(message) {
  const options = {
    to: message.to,
    subject: message.subject,
    body: message.body,
    htmlBody: message.htmlBody,
    name: MAILER_BETA.senderName
  };
  if (message.copyManager && MAILER_BETA.managerCopy) options.bcc = MAILER_BETA.managerCopy;
  MailApp.sendEmail(options);
}

function validateBase_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload absent.");
  if (MAILER_BETA.acceptedTypes.indexOf(payload.type) === -1) throw new Error("Type de message non autorisé.");
  const key = clean_(payload.idempotencyKey);
  if (!key || key.length > 300) throw new Error("Clé anti-doublon invalide.");
}

function validateCustomer_(customer) {
  if (!customer || typeof customer !== "object") throw new Error("Client absent.");
  const email = String(customer.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Adresse email invalide.");
  return { email, firstName: clean_(customer.firstName) || "", lastName: clean_(customer.lastName) || "" };
}

function validateOrder_(order) {
  if (!order || typeof order !== "object") throw new Error("Commande absente.");
  const id = clean_(order.id);
  const total = Number(order.total);
  if (!id || !Number.isFinite(total) || total < 0) throw new Error("Commande invalide.");
  const items = Array.isArray(order.items) ? order.items.map(item => ({
    name: clean_(item.name), quantity: Number(item.quantity), lineTotal: Number(item.lineTotal)
  })) : [];
  if (!items.length || items.some(item => !item.name || !Number.isInteger(item.quantity) || item.quantity < 1 || !Number.isFinite(item.lineTotal))) {
    throw new Error("Articles de commande invalides.");
  }
  return { id, total, items, status: clean_(order.status), comment: cleanComment_(order.comment) };
}

function validateReservation_(reservation) {
  if (!reservation || typeof reservation !== "object") throw new Error("Réservation absente.");
  const id = clean_(reservation.id);
  const paddock = clean_(reservation.paddock);
  const date = validDate_(reservation.date);
  const time = clean_(reservation.time);
  const duration = Number(reservation.duration);
  if (!id || ["maison", "grande", "beudot"].indexOf(paddock) === -1 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) || [60, 90].indexOf(duration) === -1) {
    throw new Error("Réservation invalide.");
  }
  return { id, paddock, date, time, duration };
}

function orderStatusLabel_(status) {
  const labels = { pending: "En attente", validated: "Validée", refused: "Refusée", ready: "Prête", completed: "Terminée", cancelled: "Annulée" };
  if (!labels[status]) throw new Error("Statut de commande invalide.");
  return labels[status];
}

function paddockRequestStatusLabel_(status) {
  const labels = { pending: "En attente", accepted: "Acceptée", refused: "Refusée", completed: "Réalisée", cancelled: "Annulée" };
  if (!labels[status]) throw new Error("Statut de demande invalide.");
  return labels[status];
}

function paddockLabel_(value) {
  return ({ maison: "Maison", grande: "Grande voie", beudot: "Beudot" })[value] || value;
}

function validDate_(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date invalide.");
  return date;
}

function dateFr_(date) {
  const parts = date.split("-");
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}

function euro_(value) {
  return Number(value).toFixed(2).replace(".", ",") + " €";
}

function clean_(value) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, 300);
}

function cleanComment_(value) {
  return String(value == null ? "" : value).trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").slice(0, 500);
}

function escapeHtml_(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function isDuplicate_(key) {
  return CacheService.getScriptCache().get("mailer:" + key) === "1";
}

function remember_(key) {
  CacheService.getScriptCache().put("mailer:" + key, "1", MAILER_BETA.duplicateSeconds);
}

function readPayload_(e) {
  const text = e && e.postData && e.postData.contents ? e.postData.contents : "";
  if (!text || text.length > 20000) throw new Error("Payload invalide.");
  return JSON.parse(text);
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

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
