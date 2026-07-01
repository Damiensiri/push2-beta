/**
 * Web App iCalendar pour la PWA Écurie Damien Siri.
 *
 * Déployer ce fichier dans un projet Google Apps Script indépendant :
 * - Exécuter en tant que : Moi
 * - Qui a accès : Tout le monde
 *
 * L’application ouvre ensuite l’URL /exec avec les paramètres :
 * title, date, time, duration et description.
 */

const CALENDAR_TIME_ZONE = "Europe/Paris";

function doGet(event) {
  try {
    const parameters = event && event.parameter ? event.parameter : {};
    const title = cleanCalendarText_(parameters.title, "Réservation paddock", 120);
    const description = cleanCalendarText_(
      parameters.description,
      "Réservation paddock — Écurie Damien Siri",
      500
    );
    const date = validateCalendarDate_(parameters.date);
    const time = validateCalendarTime_(parameters.time);
    const duration = validateCalendarDuration_(parameters.duration);
    const start = Utilities.parseDate(
      date + " " + time,
      CALENDAR_TIME_ZONE,
      "yyyy-MM-dd HH:mm"
    );
    const end = new Date(start.getTime() + duration * 60000);
    const now = new Date();

    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Ecurie Damien Siri//Reservations//FR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + Utilities.getUuid() + "@ecurie-damien-siri",
      "DTSTAMP:" + formatCalendarUTC_(now),
      "DTSTART;TZID=" + CALENDAR_TIME_ZONE + ":" + formatCalendarLocal_(start),
      "DTEND;TZID=" + CALENDAR_TIME_ZONE + ":" + formatCalendarLocal_(end),
      "SUMMARY:" + escapeCalendarValue_(title),
      "DESCRIPTION:" + escapeCalendarValue_(description),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Rappel réservation dans 45 minutes",
      "TRIGGER:-PT45M",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Rappel fin de réservation dans 15 minutes",
      "TRIGGER;RELATED=END:-PT15M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n") + "\r\n";

    return ContentService
      .createTextOutput(ics)
      .setMimeType(ContentService.MimeType.ICAL);
  } catch (error) {
    return ContentService
      .createTextOutput("Erreur calendrier : " + error.message)
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function validateCalendarDate_(value) {
  const date = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("date invalide");
  }

  return date;
}

function validateCalendarTime_(value) {
  const time = String(value || "").trim();
  const match = time.match(/^(\d{2}):(\d{2})$/);

  if (!match) {
    throw new Error("heure invalide");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 23 || minutes > 59) {
    throw new Error("heure invalide");
  }

  return time;
}

function validateCalendarDuration_(value) {
  const duration = Number(value);

  if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
    throw new Error("durée invalide");
  }

  return duration;
}

function cleanCalendarText_(value, fallback, maximumLength) {
  const text = String(value || fallback)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();

  return text.slice(0, maximumLength) || fallback;
}

function escapeCalendarValue_(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatCalendarLocal_(date) {
  return Utilities.formatDate(
    date,
    CALENDAR_TIME_ZONE,
    "yyyyMMdd'T'HHmmss"
  );
}

function formatCalendarUTC_(date) {
  return Utilities.formatDate(
    date,
    "UTC",
    "yyyyMMdd'T'HHmmss'Z'"
  );
}
