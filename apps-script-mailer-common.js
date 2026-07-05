/**
 * Backend commun des emails de la PWA Écurie Damien Siri.
 *
 * Étape pilote :
 * - ce fichier est destiné au projet Google Apps Script « Commandes » existant ;
 * - seul le type `order_confirmation` est accepté ;
 * - la page Soins l'utilise actuellement en mode test.
 *
 * Propriétés de script disponibles :
 * - MAILER_TEST_EMAIL : redirige tous les emails vers cette adresse pendant les tests ;
 * - MAILER_MANAGER_EMAIL : copie cachée facultative envoyée au gérant hors mode test.
 */

const MAILER_COMMON_CONFIG = Object.freeze({
  acceptedType: "order_confirmation",
  acceptedSources: Object.freeze(["soins", "services", "laverie", "panier"]),
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
    const result = mailerCommonSendOrderConfirmation_(payload);

    return mailerCommonJsonResponse_({
      ok: true,
      sent: true,
      duplicate: false,
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

function mailerCommonSendOrderConfirmation_(payload) {
  mailerCommonValidateOrderPayload_(payload);

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

    if (managerEmail && !mailerCommonIsEmail_(managerEmail)) {
      throw new Error("Propriété MAILER_MANAGER_EMAIL invalide.");
    }

    const rateKeys = mailerCommonCheckRateLimits_(
      properties,
      payload.customer.email.trim()
    );
    const recipientCount = !testMode && managerEmail ? 2 : 1;
    const remainingQuota = MailApp.getRemainingDailyQuota();

    if (
      remainingQuota <
      recipientCount + MAILER_COMMON_CONFIG.minimumQuotaReserve
    ) {
      throw new Error(
        "Envoi suspendu pour préserver le quota des changements de statut."
      );
    }

    const firstName = mailerCommonCleanText_(payload.customer.firstName);
    const lastName = mailerCommonCleanText_(payload.customer.lastName);
    const orderId = mailerCommonCleanText_(payload.order.id);
    const sourceLabel = mailerCommonSourceLabel_(payload.order.source);
    const subjectPrefix = testMode ? "[TEST] " : "";
    const subject = subjectPrefix + "Confirmation de votre commande #" + orderId;
    const bodies = mailerCommonBuildOrderBodies_({
      firstName,
      lastName,
      orderId,
      sourceLabel,
      total: Number(payload.order.total),
      items: payload.order.items
    });

    const message = {
      to: recipient,
      subject,
      body: bodies.plain,
      htmlBody: bodies.html,
      name: "Écurie Damien Siri"
    };

    // Une commande impose la copie gérant côté serveur. Le mode test la coupe.
    if (!testMode && managerEmail) {
      message.bcc = managerEmail;
    }

    MailApp.sendEmail(message);
    mailerCommonIncrementRateLimits_(properties, rateKeys);
    cache.put(
      duplicateKey,
      "sent",
      MAILER_COMMON_CONFIG.duplicateProtectionSeconds
    );

    return { orderId, testMode };
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

function mailerCommonValidateOrderPayload_(payload) {
  if (!payload || payload.type !== MAILER_COMMON_CONFIG.acceptedType) {
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

  ["firstName", "lastName"].forEach(function (field) {
    const value = payload.customer[field];
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.length > MAILER_COMMON_CONFIG.maxTextLength
    ) {
      throw new Error("Identité client incomplète.");
    }
  });

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

function mailerCommonSourceLabel_(source) {
  const labels = {
    soins: "Soins",
    services: "Services",
    laverie: "Laverie",
    panier: "Panier"
  };
  return labels[source];
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
