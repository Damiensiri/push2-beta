const THEME_ADMIN_CONFIG = {
  themeProperty: "PWA_ACTIVE_THEME",
  updatedAtProperty: "PWA_THEME_UPDATED_AT",
  tokenProperty: "PWA_THEME_ADMIN_TOKEN",
  defaultTheme: "summer",
  allowedThemes: ["summer", "autumn", "christmas", "winter", "spring"]
};

function initialiserThemeAdmin() {
  const props = PropertiesService.getScriptProperties();

  if (!props.getProperty(THEME_ADMIN_CONFIG.themeProperty)) {
    props.setProperty(THEME_ADMIN_CONFIG.themeProperty, THEME_ADMIN_CONFIG.defaultTheme);
  }

  if (!props.getProperty(THEME_ADMIN_CONFIG.updatedAtProperty)) {
    props.setProperty(THEME_ADMIN_CONFIG.updatedAtProperty, new Date().toISOString());
  }

  if (!props.getProperty(THEME_ADMIN_CONFIG.tokenProperty)) {
    props.setProperty(THEME_ADMIN_CONFIG.tokenProperty, "REMPLACER_PAR_UN_CODE_ADMIN");
  }
}

function doGet() {
  return jsonThemeResponse_({
    ok: true,
    theme: getActiveTheme_(),
    updatedAt: PropertiesService.getScriptProperties().getProperty(THEME_ADMIN_CONFIG.updatedAtProperty) || ""
  });
}

function doPost(e) {
  try {
    const payload = parsePayload_(e);
    const action = String(payload.action || "").trim();

    if (action !== "setTheme") {
      throw new Error("Action inconnue.");
    }

    verifyAdminToken_(payload.token);

    const theme = String(payload.theme || "").trim().toLowerCase();
    if (!THEME_ADMIN_CONFIG.allowedThemes.includes(theme)) {
      throw new Error("Thème invalide : " + theme);
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(5000);

    try {
      const props = PropertiesService.getScriptProperties();
      const updatedAt = new Date().toISOString();

      props.setProperty(THEME_ADMIN_CONFIG.themeProperty, theme);
      props.setProperty(THEME_ADMIN_CONFIG.updatedAtProperty, updatedAt);

      return jsonThemeResponse_({
        ok: true,
        theme,
        updatedAt
      });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return jsonThemeResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  }
}

function getActiveTheme_() {
  const props = PropertiesService.getScriptProperties();
  const theme = String(props.getProperty(THEME_ADMIN_CONFIG.themeProperty) || "").trim().toLowerCase();

  if (THEME_ADMIN_CONFIG.allowedThemes.includes(theme)) {
    return theme;
  }

  return THEME_ADMIN_CONFIG.defaultTheme;
}

function verifyAdminToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty(THEME_ADMIN_CONFIG.tokenProperty);

  if (!expected || expected === "REMPLACER_PAR_UN_CODE_ADMIN") {
    throw new Error("Code admin non configuré dans les propriétés du script.");
  }

  if (String(token || "") !== String(expected)) {
    throw new Error("Code admin incorrect.");
  }
}

function parsePayload_(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
  return JSON.parse(raw);
}

function jsonThemeResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
