const CONFIG_MISES_PADDOCK = {
  sheetName: "Réponses au formulaire 1",
  nomHeaders: ["Prénom", "Prenom", "Nom", "Name"],
  dateHeaders: ["Date", "Jour"],
  emailHeaders: ["Email", "Adresse e-mail", "Adresse mail", "Mail"],
  statutHeaders: ["Statut"],
  commentaireHeaders: ["Commentaire", "Info", "Message"],
  statutNotifieHeader: "Statut notifié",
  dateNotificationHeader: "Notification envoyée le"
};

function initialiserStatutsMisesPaddock() {
  const context = getMisesPaddockContext_();
  const { sheet, rows, columns } = context;

  rows.forEach((row, index) => {
    const statut = row[columns.statut];
    const statutNotifie = row[columns.statutNotifie];

    if (statut && !statutNotifie) {
      sheet.getRange(index + 2, columns.statutNotifie + 1).setValue(statut);
    }
  });
}

function verifierStatutsMisesPaddock() {
  const context = getMisesPaddockContext_();
  const { sheet, rows, columns } = context;

  rows.forEach((row, index) => {
    const nom = row[columns.nom] || "";
    const date = row[columns.date] || "";
    const email = row[columns.email] || "";
    const statut = row[columns.statut] || "";
    const commentaire = columns.commentaire === -1 ? "" : row[columns.commentaire] || "";
    const statutNotifie = row[columns.statutNotifie] || "";

    if (!email || !statut) return;
    if (String(statut) === String(statutNotifie)) return;

    envoyerMailStatutMisePaddock_(email, nom, date, statut, commentaire);

    sheet.getRange(index + 2, columns.statutNotifie + 1).setValue(statut);
    sheet.getRange(index + 2, columns.dateNotification + 1).setValue(new Date());
  });
}

function envoyerMailStatutMisePaddock_(email, nom, date, statut, commentaire) {
  const subject = "Mise à jour de votre demande de mise au paddock";
  const bonjour = nom ? "Bonjour " + nom + "," : "Bonjour,";
  const dateLine = date
    ? "<p><strong>Jour :</strong> " + escapeHtmlMisePaddock_(date) + "</p>"
    : "";
  const commentaireHtml = commentaire
    ? "<p><strong>Message :</strong><br>" + escapeHtmlMisePaddock_(commentaire).replace(/\n/g, "<br>") + "</p>"
    : "";

  const htmlBody =
    "<p>" + escapeHtmlMisePaddock_(bonjour) + "</p>" +
    "<p>Le statut de votre demande de mise au paddock a été mis à jour.</p>" +
    dateLine +
    "<p><strong>Nouveau statut :</strong> " + escapeHtmlMisePaddock_(statut) + "</p>" +
    commentaireHtml +
    "<p>Vous pouvez consulter vos demandes depuis la page Mes réservations.</p>" +
    "<p>Écurie Damien Siri</p>";

  const plainBody =
    bonjour + "\n\n" +
    "Le statut de votre demande de mise au paddock a été mis à jour.\n\n" +
    (date ? "Jour : " + date + "\n" : "") +
    "Nouveau statut : " + statut + "\n\n" +
    (commentaire ? "Message : " + commentaire + "\n\n" : "") +
    "Vous pouvez consulter vos demandes depuis la page Mes réservations.\n\n" +
    "Écurie Damien Siri";

  MailApp.sendEmail({
    to: email,
    subject,
    body: plainBody,
    htmlBody
  });
}

function getMisesPaddockContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_MISES_PADDOCK.sheetName);

  if (!sheet) {
    throw new Error("Onglet introuvable : " + CONFIG_MISES_PADDOCK.sheetName);
  }

  ensureColumnMisePaddock_(sheet, CONFIG_MISES_PADDOCK.statutNotifieHeader);
  ensureColumnMisePaddock_(sheet, CONFIG_MISES_PADDOCK.dateNotificationHeader);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(header => String(header).trim());
  const rows = data.slice(1);

  const columns = {
    nom: findColumnMisePaddock_(headers, CONFIG_MISES_PADDOCK.nomHeaders),
    date: findColumnMisePaddock_(headers, CONFIG_MISES_PADDOCK.dateHeaders),
    email: findColumnMisePaddock_(headers, CONFIG_MISES_PADDOCK.emailHeaders),
    statut: findColumnMisePaddock_(headers, CONFIG_MISES_PADDOCK.statutHeaders),
    commentaire: findColumnMisePaddock_(headers, CONFIG_MISES_PADDOCK.commentaireHeaders, true),
    statutNotifie: findColumnMisePaddock_(headers, [CONFIG_MISES_PADDOCK.statutNotifieHeader]),
    dateNotification: findColumnMisePaddock_(headers, [CONFIG_MISES_PADDOCK.dateNotificationHeader])
  };

  return { sheet, rows, columns };
}

function ensureColumnMisePaddock_(sheet, headerName) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(header => String(header).trim());

  if (!headers.includes(headerName)) {
    sheet.getRange(1, lastColumn + 1).setValue(headerName);
  }
}

function findColumnMisePaddock_(headers, possibleNames, optional) {
  const normalizedHeaders = headers.map(normalizeHeaderMisePaddock_);

  for (const name of possibleNames) {
    const index = normalizedHeaders.indexOf(normalizeHeaderMisePaddock_(name));
    if (index !== -1) return index;
  }

  if (optional) return -1;
  throw new Error("Colonne introuvable : " + possibleNames.join(" / "));
}

function normalizeHeaderMisePaddock_(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHtmlMisePaddock_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
