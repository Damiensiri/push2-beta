const CONFIG_COMMANDES = {
  sheetName: "Réponses au formulaire 1",
  emailHeaders: ["Email", "Adresse e-mail", "Adresse mail", "Mail"],
  idHeaders: ["ID", "ID commande", "Commande ID"],
  statutHeaders: ["Statut"],
  commentaireHeaders: ["Commentaire"],
  statutNotifieHeader: "Statut notifié",
  dateNotificationHeader: "Notification envoyée le"
};

function initialiserStatutsNotifies() {
  const context = getCommandesContext_();
  const { sheet, rows, columns } = context;

  rows.forEach((row, index) => {
    const statut = row[columns.statut];
    const statutNotifie = row[columns.statutNotifie];

    if (statut && !statutNotifie) {
      sheet.getRange(index + 2, columns.statutNotifie + 1).setValue(statut);
    }
  });
}

function verifierStatutsCommandes() {
  const context = getCommandesContext_();
  const { sheet, rows, columns } = context;

  rows.forEach((row, index) => {
    const email = row[columns.email];
    const id = row[columns.id];
    const statut = row[columns.statut];
    const commentaire = row[columns.commentaire] || "";
    const statutNotifie = row[columns.statutNotifie];

    if (!email || !id || !statut) return;
    if (String(statut) === String(statutNotifie)) return;

    envoyerMailStatutCommande_(email, id, statut, commentaire);

    sheet.getRange(index + 2, columns.statutNotifie + 1).setValue(statut);
    sheet.getRange(index + 2, columns.dateNotification + 1).setValue(new Date());
  });
}

function envoyerMailStatutCommande_(email, id, statut, commentaire) {
  const subject = "Mise à jour de votre commande #" + id;
  const commentaireHtml = commentaire
    ? "<p><strong>Message :</strong><br>" + escapeHtml_(commentaire).replace(/\n/g, "<br>") + "</p>"
    : "";

  const htmlBody =
    "<p>Bonjour,</p>" +
    "<p>Le statut de votre commande <strong>#" + escapeHtml_(id) + "</strong> a été mis à jour.</p>" +
    "<p><strong>Nouveau statut :</strong> " + escapeHtml_(statut) + "</p>" +
    commentaireHtml +
    "<p>Vous pouvez consulter vos commandes depuis l'application.</p>" +
    "<p>Écurie Damien Siri</p>";

  const plainBody =
    "Bonjour,\n\n" +
    "Le statut de votre commande #" + id + " a été mis à jour.\n\n" +
    "Nouveau statut : " + statut + "\n\n" +
    (commentaire ? "Message : " + commentaire + "\n\n" : "") +
    "Vous pouvez consulter vos commandes depuis l'application.\n\n" +
    "Écurie Damien Siri";

  MailApp.sendEmail({
    to: email,
    subject,
    body: plainBody,
    htmlBody,
    name: "Écurie Damien Siri"
  });
}

function getCommandesContext_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_COMMANDES.sheetName);

  if (!sheet) {
    throw new Error("Onglet introuvable : " + CONFIG_COMMANDES.sheetName);
  }

  ensureColumn_(sheet, CONFIG_COMMANDES.statutNotifieHeader);
  ensureColumn_(sheet, CONFIG_COMMANDES.dateNotificationHeader);

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(header => String(header).trim());
  const rows = data.slice(1);

  const columns = {
    email: findColumn_(headers, CONFIG_COMMANDES.emailHeaders),
    id: findColumn_(headers, CONFIG_COMMANDES.idHeaders),
    statut: findColumn_(headers, CONFIG_COMMANDES.statutHeaders),
    commentaire: findColumn_(headers, CONFIG_COMMANDES.commentaireHeaders, true),
    statutNotifie: findColumn_(headers, [CONFIG_COMMANDES.statutNotifieHeader]),
    dateNotification: findColumn_(headers, [CONFIG_COMMANDES.dateNotificationHeader])
  };

  return { sheet, rows, columns };
}

function ensureColumn_(sheet, headerName) {
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(header => String(header).trim());

  if (!headers.includes(headerName)) {
    sheet.getRange(1, lastColumn + 1).setValue(headerName);
  }
}

function findColumn_(headers, possibleNames, optional) {
  const normalizedHeaders = headers.map(normalizeHeader_);

  for (const name of possibleNames) {
    const index = normalizedHeaders.indexOf(normalizeHeader_(name));
    if (index !== -1) return index;
  }

  if (optional) return -1;
  throw new Error("Colonne introuvable : " + possibleNames.join(" / "));
}

function normalizeHeader_(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
