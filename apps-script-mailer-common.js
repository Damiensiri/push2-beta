/**
 * Backend commun des emails de la PWA Écurie Damien Siri.
 *
 * Étape pilote :
 * - ce fichier est destiné au projet Google Apps Script « Commandes » existant ;
 * - les confirmations de commandes sont actives ;
 * - les confirmations paddock sont préparées avant leur branchement à la PWA.
 *
 * Propriétés de script disponibles :
 * - MAILER_TEST_EMAIL : redirige tous les emails vers cette adresse pendant les tests ;
 * - MAILER_MANAGER_EMAIL : copie cachée facultative envoyée au gérant hors mode test.
 */

const MAILER_COMMON_CONFIG = Object.freeze({
  acceptedTypes: Object.freeze([
    "order_confirmation",
    "paddock_request_confirmation",
    "paddock_reservation_confirmation"
  ]),
  acceptedSources: Object.freeze(["soins", "services", "laverie", "panier"]),
  acceptedPaddocks: Object.freeze(["maison", "grande", "beudot"]),
  acceptedDurations: Object.freeze([60, 90]),
  duplicateProtectionSeconds: 21600,
  maxItems: 40,
  maxTextLength: 160,
  maxOrderIdLength: 80,
  maxTotal: 100000,
  maxPayloadLength: 20000,
  totalTolerance: 0.02,
  maxPerHour: 30,
  maxPerDay: 60,
  maxPerRecipientPerHour: 4,
  minimumQuotaReserve: 10,
  ratePropertyPrefix: "MAILER_RATE_"
});

function doPost(event) {
  try {
    const payload = mailerCommonParsePayload_(event);
    const result = mailerCommonSend_(payload);

    return mailerCommonJsonResponse_({
      ok: true,
      sent: true,
      duplicate: false,
      type: result.type,
      referenceId: result.referenceId,
      orderId: result.orderId,
      testMode: result.testMode
    });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);

    if (message === "MAILER_DUPLICATE") {
      return mailerCommonJsonResponse_({
        ok: true,
        sent: false,
        duplicate: true
      });
    }

    console.error("Mailer commun :", error);
    return mailerCommonJsonResponse_({
      ok: false,
      sent: false,
      error: message
    });
  }
}

function mailerCommonSend_(payload) {
  mailerCommonValidateBasePayload_(payload);

  if (payload.type === "order_confirmation") {
    return mailerCommonSendOrderConfirmation_(payload);
  }

  return mailerCommonSendPaddockConfirmation_(payload);
}

function mailerCommonSendOrderConfirmation_(payload) {
  mailerCommonValidateOrderPayload_(payload);

  const firstName = mailerCommonCleanText_(payload.customer.firstName);
  const lastName = mailerCommonCleanText_(payload.customer.lastName);
  const orderId = mailerCommonCleanText_(payload.order.id);
  const sourceLabel = mailerCommonSourceLabel_(payload.order.source);
  const subject = "Confirmation de votre commande #" + orderId;
  const bodies = mailerCommonBuildOrderBodies_({
    firstName,
    lastName,
    orderId,
    sourceLabel,
    total: Number(payload.order.total),
    items: payload.order.items
  });

  return mailerCommonDeliver_(payload, {
    type: payload.type,
    referenceId: orderId,
    orderId,
    customerEmail: payload.customer.email.trim(),
    copyManager: true,
    subject,
    bodies
  });
}

function mailerCommonSendPaddockConfirmation_(payload) {
  mailerCommonValidatePaddockPayload_(payload);

  const firstName = mailerCommonCleanText_(payload.customer.firstName);
  let subject;
  let bodies;
  let referenceId;
  let copyManager;

  if (payload.type === "paddock_request_confirmation") {
    const date = mailerCommonCleanText_(payload.request.date);
    subject = "Demande de mise au paddock enregistrée";
    referenceId = "mise-" + date;
    copyManager = true;
    bodies = mailerCommonBuildPaddockRequestBodies_({ firstName, date });
  } else {
    const reservation = payload.reservation;
    const paddock = mailerCommonCleanText_(reservation.paddock);
    const date = mailerCommonCleanText_(reservation.date);
    const time = mailerCommonCleanText_(reservation.time);
    const duration = Number(reservation.duration);
    referenceId = mailerCommonCleanText_(reservation.id);
    subject = "Réservation paddock confirmée";
    copyManager = false;
    bodies = mailerCommonBuildPaddockReservationBodies_({
      firstName,
      paddock: mailerCommonPaddockLabel_(paddock),
      date,
      time,
      duration
    });
  }

  return mailerCommonDeliver_(payload, {
    type: payload.type,
    referenceId,
    customerEmail: payload.customer.email.trim(),
    copyManager,
    subject,
    bodies
  });
}

function mailerCommonDeliver_(payload, delivery) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const duplicateKey = mailerCommonDuplicateKey_(payload.idempotencyKey);
    const cache = CacheService.getScriptCache();

    if (cache.get(duplicateKey)) {
      throw new Error("MAILER_DUPLICATE");
    }

    const properties = PropertiesService.getScriptProperties();
    const testEmail = String(properties.getProperty("MAILER_TEST_EMAIL") || "").trim();
    const managerEmail = String(properties.getProperty("MAILER_MANAGER_EMAIL") || "").trim();
    const testMode = Boolean(testEmail);
    const recipient = testMode ? testEmail : payload.customer.email.trim();

    if (!mailerCommonIsEmail_(recipient)) {
      throw new Error("Adresse destinataire invalide.");
    }

    if (
      delivery.copyManager &&
      managerEmail &&
      !mailerCommonIsEmail_(managerEmail)
    ) {
      throw new Error("Propriété MAILER_MANAGER_EMAIL invalide.");
    }

    const rateKeys = mailerCommonCheckRateLimits_(
      properties,
      payload.customer.email.trim()
    );
    const recipientCount =
      !testMode && delivery.copyManager && managerEmail ? 2 : 1;
    const remainingQuota = MailApp.getRemainingDailyQuota();

    if (
      remainingQuota <
      recipientCount + MAILER_COMMON_CONFIG.minimumQuotaReserve
    ) {
      throw new Error(
        "Envoi suspendu pour préserver le quota des changements de statut."
      );
    }

    const subjectPrefix = testMode ? "[TEST] " : "";

    const message = {
      to: recipient,
      subject: subjectPrefix + delivery.subject,
      body: delivery.bodies.plain,
      htmlBody: delivery.bodies.html,
      name: "Écurie Damien Siri"
    };

    if (!testMode && delivery.copyManager && managerEmail) {
      message.bcc = managerEmail;
    }

    MailApp.sendEmail(message);
    mailerCommonIncrementRateLimits_(properties, rateKeys);
    cache.put(
      duplicateKey,
      "sent",
      MAILER_COMMON_CONFIG.duplicateProtectionSeconds
    );

    return {
      type: delivery.type,
      referenceId: delivery.referenceId,
      orderId: delivery.orderId,
      testMode
    };
  } finally {
    lock.releaseLock();
  }
}

function mailerCommonParsePayload_(event) {
  if (!event) {
    throw new Error("Requête absente.");
  }

  let raw = "";

  if (event.postData && event.postData.contents) {
    raw = event.postData.contents;
  } else if (event.parameter && event.parameter.payload) {
    raw = event.parameter.payload;
  }

  if (!raw) {
    throw new Error("Contenu de la requête absent.");
  }

  if (raw.length > MAILER_COMMON_CONFIG.maxPayloadLength) {
    throw new Error("Contenu de la requête trop volumineux.");
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("JSON invalide.");
  }
}

function mailerCommonValidateBasePayload_(payload) {
  if (
    !payload ||
    MAILER_COMMON_CONFIG.acceptedTypes.indexOf(payload.type) === -1
  ) {
    throw new Error("Type d’email non autorisé.");
  }

  if (
    typeof payload.idempotencyKey !== "string" ||
    !payload.idempotencyKey.trim() ||
    payload.idempotencyKey.length > 140
  ) {
    throw new Error("Clé anti-doublon invalide.");
  }

  if (!payload.customer || !mailerCommonIsEmail_(payload.customer.email)) {
    throw new Error("Adresse client invalide.");
  }

  const firstName = payload.customer.firstName;
  if (
    typeof firstName !== "string" ||
    !firstName.trim() ||
    firstName.length > MAILER_COMMON_CONFIG.maxTextLength
  ) {
    throw new Error("Prénom client invalide.");
  }

  if (
    payload.customer.lastName !== undefined &&
    (
      typeof payload.customer.lastName !== "string" ||
      payload.customer.lastName.length > MAILER_COMMON_CONFIG.maxTextLength
    )
  ) {
    throw new Error("Nom client invalide.");
  }
}

function mailerCommonValidateOrderPayload_(payload) {
  if (
    typeof payload.customer.lastName !== "string" ||
    !payload.customer.lastName.trim()
  ) {
    throw new Error("Identité client incomplète.");
  }

  if (!payload.order || typeof payload.order !== "object") {
    throw new Error("Commande absente.");
  }

  if (
    typeof payload.order.id !== "string" ||
    !payload.order.id.trim() ||
    payload.order.id.length > MAILER_COMMON_CONFIG.maxOrderIdLength
  ) {
    throw new Error("Identifiant de commande invalide.");
  }

  if (MAILER_COMMON_CONFIG.acceptedSources.indexOf(payload.order.source) === -1) {
    throw new Error("Origine de commande non autorisée.");
  }

  const total = Number(payload.order.total);
  if (
    !Number.isFinite(total) ||
    total < 0 ||
    total > MAILER_COMMON_CONFIG.maxTotal
  ) {
    throw new Error("Total de commande invalide.");
  }

  if (
    !Array.isArray(payload.order.items) ||
    payload.order.items.length < 1 ||
    payload.order.items.length > MAILER_COMMON_CONFIG.maxItems
  ) {
    throw new Error("Articles de commande invalides.");
  }

  let calculatedTotal = 0;

  payload.order.items.forEach(function (item) {
    if (
      !item ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > MAILER_COMMON_CONFIG.maxTextLength
    ) {
      throw new Error("Nom d’article invalide.");
    }

    const quantity = Number(item.quantity);
    const lineTotal = Number(item.lineTotal);
    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100 ||
      !Number.isFinite(lineTotal) ||
      lineTotal < 0 ||
      lineTotal > MAILER_COMMON_CONFIG.maxTotal
    ) {
      throw new Error("Détail d’article invalide.");
    }

    calculatedTotal += lineTotal;
  });

  if (
    Math.abs(calculatedTotal - total) >
    MAILER_COMMON_CONFIG.totalTolerance
  ) {
    throw new Error("Le total ne correspond pas aux articles.");
  }
}

function mailerCommonValidatePaddockPayload_(payload) {
  if (payload.type === "paddock_request_confirmation") {
    if (
      !payload.request ||
      typeof payload.request.date !== "string" ||
      !mailerCommonIsDate_(payload.request.date)
    ) {
      throw new Error("Date de demande invalide.");
    }
    return;
  }

  const reservation = payload.reservation;
  if (!reservation || typeof reservation !== "object") {
    throw new Error("Réservation absente.");
  }

  if (
    typeof reservation.id !== "string" ||
    !reservation.id.trim() ||
    reservation.id.length > MAILER_COMMON_CONFIG.maxOrderIdLength
  ) {
    throw new Error("Identifiant de réservation invalide.");
  }

  if (
    MAILER_COMMON_CONFIG.acceptedPaddocks.indexOf(reservation.paddock) === -1
  ) {
    throw new Error("Paddock invalide.");
  }

  if (
    typeof reservation.date !== "string" ||
    !mailerCommonIsDate_(reservation.date)
  ) {
    throw new Error("Date de réservation invalide.");
  }

  if (
    typeof reservation.time !== "string" ||
    !mailerCommonIsTime_(reservation.time)
  ) {
    throw new Error("Heure de réservation invalide.");
  }

  if (
    MAILER_COMMON_CONFIG.acceptedDurations.indexOf(
      Number(reservation.duration)
    ) === -1
  ) {
    throw new Error("Durée de réservation invalide.");
  }
}

function mailerCommonCheckRateLimits_(properties, customerEmail) {
  const now = new Date();
  const hourBucket = Utilities.formatDate(now, "UTC", "yyyyMMddHH");
  const dayBucket = Utilities.formatDate(now, "UTC", "yyyyMMdd");
  const recipientHash = mailerCommonDigestHex_(
    String(customerEmail).trim().toLowerCase()
  ).slice(0, 24);
  const prefix = MAILER_COMMON_CONFIG.ratePropertyPrefix;
  const counters = [
    {
      key: prefix + "HOUR_" + hourBucket,
      limit: MAILER_COMMON_CONFIG.maxPerHour
    },
    {
      key: prefix + "DAY_" + dayBucket,
      limit: MAILER_COMMON_CONFIG.maxPerDay
    },
    {
      key: prefix + "RECIPIENT_" + hourBucket + "_" + recipientHash,
      limit: MAILER_COMMON_CONFIG.maxPerRecipientPerHour
    }
  ];

  mailerCommonCleanupRateProperties_(
    properties,
    [
      prefix + "HOUR_" + hourBucket,
      prefix + "DAY_" + dayBucket,
      prefix + "RECIPIENT_" + hourBucket + "_"
    ]
  );

  counters.forEach(function (counter) {
    const count = Number(properties.getProperty(counter.key) || 0);
    if (!Number.isFinite(count) || count < 0) {
      throw new Error("Compteur de sécurité invalide.");
    }
    if (count >= counter.limit) {
      throw new Error("Limite temporaire d’envoi atteinte.");
    }
  });

  return counters.map(function (counter) { return counter.key; });
}

function mailerCommonIncrementRateLimits_(properties, keys) {
  keys.forEach(function (key) {
    const count = Number(properties.getProperty(key) || 0);
    properties.setProperty(key, String(count + 1));
  });
}

function mailerCommonCleanupRateProperties_(properties, activePrefixes) {
  const prefix = MAILER_COMMON_CONFIG.ratePropertyPrefix;
  const allProperties = properties.getProperties();

  Object.keys(allProperties).forEach(function (key) {
    const active = activePrefixes.some(function (activePrefix) {
      return key.indexOf(activePrefix) === 0;
    });
    if (key.indexOf(prefix) === 0 && !active) {
      properties.deleteProperty(key);
    }
  });
}

function mailerCommonBuildOrderBodies_(order) {
  const customerName = [order.firstName, order.lastName].filter(Boolean).join(" ");
  const itemLines = order.items.map(function (item) {
    return (
      item.quantity +
      " × " +
      mailerCommonCleanText_(item.name) +
      " — " +
      mailerCommonFormatEuro_(Number(item.lineTotal))
    );
  });

  const plain =
    "Bonjour " + customerName + ",\n\n" +
    "Votre commande #" + order.orderId + " a bien été enregistrée.\n" +
    "Catégorie : " + order.sourceLabel + "\n\n" +
    itemLines.join("\n") + "\n\n" +
    "Total : " + mailerCommonFormatEuro_(order.total) + "\n\n" +
    "Vous pourrez suivre son statut depuis l’application.\n\n" +
    "Écurie Damien Siri";

  const htmlItems = order.items.map(function (item) {
    return (
      "<li>" +
      Number(item.quantity) +
      " × " +
      mailerCommonEscapeHtml_(mailerCommonCleanText_(item.name)) +
      " — <strong>" +
      mailerCommonEscapeHtml_(mailerCommonFormatEuro_(Number(item.lineTotal))) +
      "</strong></li>"
    );
  }).join("");

  const html =
    "<p>Bonjour " + mailerCommonEscapeHtml_(customerName) + ",</p>" +
    "<p>Votre commande <strong>#" +
    mailerCommonEscapeHtml_(order.orderId) +
    "</strong> a bien été enregistrée.</p>" +
    "<p><strong>Catégorie :</strong> " +
    mailerCommonEscapeHtml_(order.sourceLabel) +
    "</p>" +
    "<ul>" + htmlItems + "</ul>" +
    "<p><strong>Total : " +
    mailerCommonEscapeHtml_(mailerCommonFormatEuro_(order.total)) +
    "</strong></p>" +
    "<p>Vous pourrez suivre son statut depuis l’application.</p>" +
    "<p>Écurie Damien Siri</p>";

  return { plain, html };
}

function mailerCommonBuildPaddockRequestBodies_(request) {
  const plain =
    "Bonjour " + request.firstName + ",\n\n" +
    "Votre demande de mise au paddock pour le " + request.date +
    " a bien été enregistrée.\n\n" +
    "Statut : En attente de confirmation.\n\n" +
    "Vous serez informé par email lors de sa mise à jour.\n\n" +
    "Écurie Damien Siri";

  const html =
    "<p>Bonjour " +
    mailerCommonEscapeHtml_(request.firstName) +
    ",</p>" +
    "<p>Votre demande de mise au paddock pour le <strong>" +
    mailerCommonEscapeHtml_(request.date) +
    "</strong> a bien été enregistrée.</p>" +
    "<p><strong>Statut :</strong> En attente de confirmation.</p>" +
    "<p>Vous serez informé par email lors de sa mise à jour.</p>" +
    "<p>Écurie Damien Siri</p>";

  return { plain, html };
}

function mailerCommonBuildPaddockReservationBodies_(reservation) {
  const durationLabel = reservation.duration === 90 ? "1 h 30" : "1 h";
  const plain =
    "Bonjour " + reservation.firstName + ",\n\n" +
    "Votre réservation paddock est confirmée.\n\n" +
    "Paddock : " + reservation.paddock + "\n" +
    "Jour : " + reservation.date + "\n" +
    "Heure : " + reservation.time + "\n" +
    "Durée : " + durationLabel + "\n\n" +
    "Écurie Damien Siri";

  const html =
    "<p>Bonjour " +
    mailerCommonEscapeHtml_(reservation.firstName) +
    ",</p>" +
    "<p>Votre réservation paddock est confirmée.</p>" +
    "<p><strong>Paddock :</strong> " +
    mailerCommonEscapeHtml_(reservation.paddock) +
    "<br><strong>Jour :</strong> " +
    mailerCommonEscapeHtml_(reservation.date) +
    "<br><strong>Heure :</strong> " +
    mailerCommonEscapeHtml_(reservation.time) +
    "<br><strong>Durée :</strong> " +
    durationLabel +
    "</p>" +
    "<p>Écurie Damien Siri</p>";

  return { plain, html };
}

function mailerCommonSourceLabel_(source) {
  const labels = {
    soins: "Soins",
    services: "Services",
    laverie: "Laverie",
    panier: "Panier"
  };
  return labels[source];
}

function mailerCommonPaddockLabel_(paddock) {
  const labels = {
    maison: "Maison",
    grande: "Grande Voie",
    beudot: "Beudot"
  };
  return labels[paddock];
}

function mailerCommonIsDate_(value) {
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function mailerCommonIsTime_(value) {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  return Number(match[1]) < 24 && Number(match[2]) < 60;
}

function mailerCommonFormatEuro_(value) {
  return Number(value).toFixed(2).replace(".", ",") + " €";
}

function mailerCommonCleanText_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mailerCommonIsEmail_(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function mailerCommonDuplicateKey_(value) {
  return "mailer-common-" + mailerCommonDigestHex_(value);
}

function mailerCommonDigestHex_(value) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  const hex = digest.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
  return hex;
}

function mailerCommonEscapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function mailerCommonJsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
