    "use strict";

    const WEATHER_CONFIG = {
      latitude: 48.391,
      longitude: 4.527,
      timezone: "Europe/Paris",
      city: "Brienne-le-Château"
    };

    const WEATHER_LABELS = new Map([
      [0, "Ciel dégagé"],
      [1, "Principalement clair"],
      [2, "Peu nuageux"],
      [3, "Couvert"],
      [45, "Brouillard"],
      [48, "Brouillard givrant"],
      [51, "Bruine légère"],
      [53, "Bruine modérée"],
      [55, "Bruine dense"],
      [56, "Bruine verglaçante légère"],
      [57, "Bruine verglaçante dense"],
      [61, "Pluie faible"],
      [63, "Pluie modérée"],
      [65, "Pluie forte"],
      [66, "Pluie verglaçante faible"],
      [67, "Pluie verglaçante forte"],
      [71, "Neige faible"],
      [73, "Neige modérée"],
      [75, "Neige forte"],
      [77, "Grains de neige"],
      [80, "Averses faibles"],
      [81, "Averses modérées"],
      [82, "Averses violentes"],
      [85, "Averses de neige faibles"],
      [86, "Averses de neige fortes"],
      [95, "Orage"],
      [96, "Orage avec grêle faible"],
      [99, "Orage avec grêle forte"]
    ]);

    const elements = {};

    document.addEventListener("DOMContentLoaded", () => {
      cacheElements();
      initializeAnimations();
      initializeInteractions();
      renderVigilance(window.METEOALARM_VIGILANCE);
      loadWeather();
    });

    function cacheElements() {
      const ids = [
        "app", "temperature", "heroIcon", "cityName", "description",
        "localTime", "updatedAt", "windSpeed",
        "windGust", "rainChance", "rainAmount",
        "dailyForecast", "hourlyForecast", "errorBox", "cloudField", "rainField",
        "snowField", "starField", "backButton", "vigilanceCard", "vigilanceBadge",
        "vigilanceLevel", "vigilancePhenomenon", "vigilancePeriod", "vigilanceUpdated"
      ];

      ids.forEach((id) => {
        elements[id] = document.getElementById(id);
      });
    }

    function initializeInteractions() {
      elements.backButton.addEventListener("click", () => {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }

        window.location.href = "./";
      });
    }

    function renderVigilance(data) {
      const levels = {
        green: { label: "Vert", title: "Vigilance verte", rgb: "49, 170, 53" },
        yellow: { label: "Jaune", title: "Vigilance jaune", rgb: "255, 240, 0" },
        orange: { label: "Orange", title: "Vigilance orange", rgb: "241, 142, 0" },
        red: { label: "Rouge", title: "Vigilance rouge", rgb: "225, 0, 15" }
      };
      const current = data && levels[data.level] ? data : {
        level: "green",
        phenomenon: "Aucun phénomène dangereux signalé pour l'Aube.",
        period: "Aucune alerte active",
        updatedAt: "Données locales en attente"
      };
      const level = levels[current.level];

      elements.vigilanceCard.style.setProperty("--vigilance-rgb", level.rgb);
      elements.vigilanceBadge.textContent = level.label;
      elements.vigilanceLevel.textContent = level.title;
      elements.vigilancePhenomenon.textContent = current.phenomenon;
      elements.vigilancePeriod.textContent = current.period;
      elements.vigilanceUpdated.textContent = current.updatedAt;

      document.querySelectorAll("[data-vigilance-level]").forEach((item) => {
        item.classList.toggle("active", item.dataset.vigilanceLevel === current.level);
      });
    }

    function initializeAnimations() {
      buildClouds();
      buildRain();
      buildSnow();
      buildStars();
      renderWeatherIcon(elements.heroIcon, "sun");
    }

    function buildClouds() {
      const cloudSpecs = [
        { x: "-4%", y: "14%", w: 240, d: 54, o: 0.58, delay: -12, blur: 0.2 },
        { x: "18%", y: "26%", w: 190, d: 46, o: 0.50, delay: -24, blur: 0.8 },
        { x: "42%", y: "18%", w: 280, d: 66, o: 0.42, delay: -36, blur: 1.4 },
        { x: "70%", y: "34%", w: 220, d: 58, o: 0.48, delay: -18, blur: 0.6 },
        { x: "8%", y: "58%", w: 310, d: 74, o: 0.32, delay: -42, blur: 2.2 },
        { x: "62%", y: "66%", w: 250, d: 62, o: 0.28, delay: -8, blur: 1.8 }
      ];

      elements.cloudField.innerHTML = "";
      cloudSpecs.forEach((spec, index) => {
        const cloud = document.createElement("span");
        cloud.className = index > 2 ? "cloud dark" : "cloud";
        cloud.style.setProperty("--cloud-x", spec.x);
        cloud.style.setProperty("--cloud-y", spec.y);
        cloud.style.setProperty("--cloud-w", spec.w + "px");
        cloud.style.setProperty("--cloud-d", spec.d + "s");
        cloud.style.setProperty("--cloud-o", spec.o);
        cloud.style.setProperty("--cloud-delay", spec.delay + "s");
        cloud.style.setProperty("--cloud-blur", spec.blur + "px");
        elements.cloudField.appendChild(cloud);
      });
    }

    function buildRain() {
      elements.rainField.innerHTML = "";
      const count = 58;
      for (let i = 0; i < count; i += 1) {
        const line = document.createElement("span");
        const x = Math.round((i / count) * 112 + pseudoRandom(i) * 8) - 6;
        const duration = 0.72 + pseudoRandom(i + 12) * 0.58;
        line.className = "rain-line";
        line.style.setProperty("--x", x + "%");
        line.style.setProperty("--h", Math.round(52 + pseudoRandom(i + 4) * 58) + "px");
        line.style.setProperty("--o", (0.24 + pseudoRandom(i + 8) * 0.42).toFixed(2));
        line.style.setProperty("--d", duration.toFixed(2) + "s");
        line.style.setProperty("--delay", (-pseudoRandom(i + 16) * 1.8).toFixed(2) + "s");
        elements.rainField.appendChild(line);
      }
    }

    function buildSnow() {
      elements.snowField.innerHTML = "";
      const count = 42;
      for (let i = 0; i < count; i += 1) {
        const flake = document.createElement("span");
        const size = 3 + pseudoRandom(i + 2) * 5;
        flake.className = "snow-flake";
        flake.style.setProperty("--x", Math.round(pseudoRandom(i) * 104 - 2) + "%");
        flake.style.setProperty("--s", size.toFixed(1) + "px");
        flake.style.setProperty("--o", (0.34 + pseudoRandom(i + 9) * 0.58).toFixed(2));
        flake.style.setProperty("--d", (7.4 + pseudoRandom(i + 14) * 8.2).toFixed(2) + "s");
        flake.style.setProperty("--delay", (-pseudoRandom(i + 21) * 9).toFixed(2) + "s");
        flake.style.setProperty("--drift", Math.round(-34 + pseudoRandom(i + 31) * 68) + "px");
        elements.snowField.appendChild(flake);
      }
    }

    function buildStars() {
      elements.starField.innerHTML = "";
      const count = 64;
      for (let i = 0; i < count; i += 1) {
        const star = document.createElement("span");
        const size = 1.2 + pseudoRandom(i + 3) * 2.3;
        star.className = "star";
        star.style.setProperty("--x", Math.round(pseudoRandom(i + 17) * 100) + "%");
        star.style.setProperty("--y", Math.round(pseudoRandom(i + 27) * 68 + 3) + "%");
        star.style.setProperty("--s", size.toFixed(1) + "px");
        star.style.setProperty("--o", (0.34 + pseudoRandom(i + 33) * 0.58).toFixed(2));
        star.style.setProperty("--d", (2.6 + pseudoRandom(i + 42) * 4.8).toFixed(2) + "s");
        star.style.setProperty("--delay", (-pseudoRandom(i + 53) * 5).toFixed(2) + "s");
        elements.starField.appendChild(star);
      }
    }

    function pseudoRandom(seed) {
      const x = Math.sin(seed * 999.97) * 10000;
      return x - Math.floor(x);
    }

    async function loadWeather() {
      try {
        const data = await fetchWeather();
        renderWeather(data);
        elements.app.classList.remove("loading");
        elements.errorBox.classList.remove("visible");
      } catch (error) {
        console.error(error);
        renderFallbackState();
      }
    }

    async function fetchWeather() {
      const params = new URLSearchParams({
        latitude: WEATHER_CONFIG.latitude,
        longitude: WEATHER_CONFIG.longitude,
        timezone: WEATHER_CONFIG.timezone,
        forecast_days: "4",
        current: [
          "temperature_2m",
          "weather_code",
          "is_day",
          "wind_speed_10m",
          "wind_gusts_10m",
          "precipitation",
          "rain"
        ].join(","),
        hourly: [
          "temperature_2m",
          "weather_code",
          "is_day",
          "precipitation_probability",
          "precipitation",
          "wind_speed_10m"
        ].join(","),
        daily: [
          "weather_code",
          "temperature_2m_max",
          "temperature_2m_min",
          "precipitation_sum",
          "precipitation_probability_max"
        ].join(",")
      });

      const response = await fetch("https://api.open-meteo.com/v1/forecast?" + params.toString(), {
        method: "GET",
        headers: { "Accept": "application/json" }
      });

      if (!response.ok) {
        throw new Error("Open-Meteo a retourné une erreur " + response.status);
      }

      return response.json();
    }

    function renderWeather(data) {
      const current = data.current;
      const daily = data.daily;
      const hourly = data.hourly;
      const currentHourIndex = findCurrentHourIndex(hourly.time, current.time);
      const rainProbability = getHourlyValue(hourly.precipitation_probability, currentHourIndex);
      const todayRain = firstNumber(daily.precipitation_sum, 0);
      const weatherCode = current.weather_code;
      const isDay = current.is_day === 1;
      const ambiance = getAmbianceForWeather(weatherCode, isDay);

      applyWeatherAmbiance(weatherCode, isDay);
      renderWeatherIcon(elements.heroIcon, ambiance);
      updateMetaTheme(ambiance);

      elements.cityName.textContent = WEATHER_CONFIG.city;
      elements.temperature.textContent = roundNumber(current.temperature_2m);
      elements.description.textContent = getWeatherDescription(weatherCode, isDay);
      elements.localTime.textContent = formatLocalTime(current.time);
      elements.updatedAt.textContent = "Mis à jour " + formatShortTime(current.time);
      elements.windSpeed.textContent = roundNumber(current.wind_speed_10m);
      elements.windGust.textContent = roundNumber(current.wind_gusts_10m);
      elements.rainChance.textContent = rainProbability === null ? "0" : roundNumber(rainProbability);
      elements.rainAmount.textContent = formatDecimal(todayRain);

      renderDailyForecast(daily);
      renderHourlyForecast(hourly, currentHourIndex);
    }

    function renderFallbackState() {
      elements.app.classList.remove("loading");
      elements.errorBox.textContent = "La météo n'a pas pu être chargée pour le moment. L'interface reste disponible et se reconnectera au prochain rafraîchissement.";
      elements.errorBox.classList.add("visible");
      applyWeatherAmbiance(0, true);
      renderWeatherIcon(elements.heroIcon, "sun");
      elements.temperature.textContent = "—";
      elements.description.textContent = "Connexion météo indisponible";
      elements.updatedAt.textContent = "Hors ligne";
      elements.windSpeed.textContent = "—";
      elements.windGust.textContent = "—";
      elements.rainChance.textContent = "—";
      elements.rainAmount.textContent = "—";
      renderDailyForecast(null);
      renderHourlyForecast(null, 0);
    }

    function applyWeatherAmbiance(weatherCode, isDay) {
      const ambiance = getAmbianceForWeather(weatherCode, isDay);
      document.body.dataset.ambiance = ambiance;
    }

    function getAmbianceForWeather(weatherCode, isDay) {
      if (!isDay) return "night";
      if ([95, 96, 99].includes(weatherCode)) return "storm";
      if ([71, 73, 75, 77, 85, 86].includes(weatherCode)) return "snow";
      if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(weatherCode)) return "rain";
      if ([3, 45, 48].includes(weatherCode)) return "overcast";
      if ([1, 2].includes(weatherCode)) return "clouds";
      return "sun";
    }

    function renderDailyForecast(daily) {
      elements.dailyForecast.innerHTML = "";

      if (!daily || !daily.time) {
        for (let i = 0; i < 3; i += 1) {
          elements.dailyForecast.appendChild(createDailyTile({
            date: new Date(Date.now() + i * 86400000).toISOString(),
            code: 0,
            min: null,
            max: null,
            rain: null
          }, i));
        }
        return;
      }

      daily.time.slice(0, 3).forEach((date, index) => {
        elements.dailyForecast.appendChild(createDailyTile({
          date,
          code: daily.weather_code[index],
          min: daily.temperature_2m_min[index],
          max: daily.temperature_2m_max[index],
          rain: daily.precipitation_probability_max[index]
        }, index));
      });
    }

    function createDailyTile(day, index) {
      const tile = document.createElement("div");
      tile.className = "day-tile";

      const name = document.createElement("p");
      name.className = "day-name";
      name.textContent = index === 0 ? "Aujourd'hui" : formatDayName(day.date);

      const date = document.createElement("div");
      date.className = "day-date";
      date.textContent = formatDayDate(day.date);

      const icon = document.createElement("div");
      icon.className = "day-icon";
      renderWeatherIcon(icon, getAmbianceForWeather(day.code, true));

      const temps = document.createElement("div");
      temps.className = "day-temps";
      temps.innerHTML = '<span class="max-temp">' + formatSignedTemp(day.max) + '</span><span class="min-temp">' + formatSignedTemp(day.min) + '</span>';

      const rain = document.createElement("div");
      rain.className = "rain-mini";
      rain.textContent = "Pluie " + (day.rain === null || day.rain === undefined ? "—" : roundNumber(day.rain) + "%");

      tile.append(name, date, icon, temps, rain);
      return tile;
    }

    function renderHourlyForecast(hourly, startIndex) {
      elements.hourlyForecast.innerHTML = "";

      if (!hourly || !hourly.time) {
        return;
      }

      const start = Math.max(0, startIndex);
      const end = Math.min(hourly.time.length, start + 24);

      for (let i = start; i < end; i += 1) {
        const tile = document.createElement("div");
        tile.className = "hour-tile";

        const label = document.createElement("div");
        label.className = "hour-label";
        label.textContent = i === start ? "Maint." : formatHour(hourly.time[i]);

        const icon = document.createElement("div");
        icon.className = "hour-icon";
        renderWeatherIcon(icon, getAmbianceForWeather(hourly.weather_code[i], hourly.is_day[i] === 1));

        const temp = document.createElement("div");
        temp.className = "hour-temp";
        temp.textContent = formatSignedTemp(hourly.temperature_2m[i]);

        const rain = document.createElement("div");
        rain.className = "hour-rain";
        rain.textContent = (hourly.precipitation_probability[i] || 0) + "%";

        tile.append(label, icon, temp, rain);
        elements.hourlyForecast.appendChild(tile);
      }
    }

    function renderWeatherIcon(target, type) {
      target.innerHTML = [
        '<div class="weather-icon ' + type + '">',
        '<span class="icon-sun"></span>',
        '<span class="icon-cloud ' + (type === "overcast" || type === "rain" || type === "storm" ? "dark" : "") + '"></span>',
        '<span class="icon-drop"></span>',
        '<span class="icon-drop"></span>',
        '<span class="icon-drop"></span>',
        '<span class="icon-flake"></span>',
        '<span class="icon-flake"></span>',
        '<span class="icon-flake"></span>',
        '<span class="icon-bolt"></span>',
        '</div>'
      ].join("");
    }

    function getWeatherDescription(code, isDay) {
      if (!isDay && [0, 1].includes(code)) return "Nuit claire";
      if (!isDay && code === 2) return "Nuit peu nuageuse";
      return WEATHER_LABELS.get(code) || "Conditions météo variables";
    }

    function findCurrentHourIndex(times, currentTime) {
      if (!Array.isArray(times) || !currentTime) return 0;
      const currentHour = currentTime.slice(0, 13);
      const exactIndex = times.findIndex((time) => time.slice(0, 13) === currentHour);
      if (exactIndex >= 0) return exactIndex;

      const now = new Date(currentTime).getTime();
      let closestIndex = 0;
      let closestDistance = Infinity;
      times.forEach((time, index) => {
        const distance = Math.abs(new Date(time).getTime() - now);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = index;
        }
      });
      return closestIndex;
    }

    function getHourlyValue(values, index) {
      if (!Array.isArray(values) || values.length === 0) return null;
      if (Number.isFinite(values[index])) return values[index];
      const fallback = values.find((value) => Number.isFinite(value));
      return Number.isFinite(fallback) ? fallback : null;
    }

    function firstNumber(values, fallback) {
      if (!Array.isArray(values)) return fallback;
      const value = values.find((entry) => Number.isFinite(entry));
      return Number.isFinite(value) ? value : fallback;
    }

    function roundNumber(value) {
      if (!Number.isFinite(value)) return "—";
      return Math.round(value).toString();
    }

    function formatDecimal(value) {
      if (!Number.isFinite(value)) return "—";
      return value < 10 ? value.toFixed(1).replace(".", ",") : Math.round(value).toString();
    }

    function formatSignedTemp(value) {
      if (!Number.isFinite(value)) return "—";
      return Math.round(value) + "°";
    }

    function formatLocalTime(value) {
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: WEATHER_CONFIG.timezone,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    }

    function formatShortTime(value) {
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: WEATHER_CONFIG.timezone,
        hour: "2-digit",
        minute: "2-digit"
      }).format(new Date(value));
    }

    function formatHour(value) {
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: WEATHER_CONFIG.timezone,
        hour: "2-digit"
      }).format(new Date(value));
    }

    function formatDayName(value) {
      const label = new Intl.DateTimeFormat("fr-FR", {
        timeZone: WEATHER_CONFIG.timezone,
        weekday: "short"
      }).format(new Date(value));
      return label.charAt(0).toUpperCase() + label.slice(1).replace(".", "");
    }

    function formatDayDate(value) {
      return new Intl.DateTimeFormat("fr-FR", {
        timeZone: WEATHER_CONFIG.timezone,
        day: "2-digit",
        month: "short"
      }).format(new Date(value)).replace(".", "");
    }

    function updateMetaTheme(ambiance) {
      const colors = {
        sun: "#287fbd",
        clouds: "#2c86c5",
        overcast: "#62798c",
        rain: "#2e5b81",
        storm: "#18243b",
        snow: "#6f9fc5",
        night: "#061225"
      };
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", colors[ambiance] || colors.sun);
    }
