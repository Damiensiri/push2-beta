#!/usr/bin/env python3
"""Generate static Aube vigilance data from the public MeteoAlarm Atom feed."""

from __future__ import annotations

import json
import os
import tempfile
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


FEED_URL = os.environ.get(
    "METEOALARM_FEED_URL",
    "https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-france",
)
OUTPUT_DIR = Path(__file__).resolve().parents[1]
DEPARTMENT = "Aube"
PARIS = ZoneInfo("Europe/Paris")
ATOM = "{http://www.w3.org/2005/Atom}"
CAP = "{urn:oasis:names:tc:emergency:cap:1.2}"

LEVEL_RANK = {"green": 0, "yellow": 1, "orange": 2, "red": 3}
LEVEL_LABEL = {
    "green": "Vert",
    "yellow": "Jaune",
    "orange": "Orange",
    "red": "Rouge",
}
MONTHS = (
    "janvier",
    "février",
    "mars",
    "avril",
    "mai",
    "juin",
    "juillet",
    "août",
    "septembre",
    "octobre",
    "novembre",
    "décembre",
)


def text(entry: ET.Element, tag: str) -> str:
    node = entry.find(tag)
    return (node.text or "").strip() if node is not None else ""


def parse_date(value: str) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def detect_level(title: str, severity: str) -> str:
    lowered = title.lower()
    for color in ("red", "orange", "yellow", "green"):
        if color in lowered:
            return color
    return {
        "extreme": "red",
        "severe": "orange",
        "moderate": "yellow",
        "minor": "yellow",
    }.get(severity.lower(), "yellow")


def translate_event(value: str) -> str:
    lowered = value.lower()
    translations = (
        (("high-temperature", "high temperature", "heat"), "Canicule"),
        (("low-temperature", "low temperature", "cold"), "Grand froid"),
        (("thunderstorm", "storm"), "Orages"),
        (("rain", "flood"), "Pluie-inondation"),
        (("snow", "ice", "freezing"), "Neige-verglas"),
        (("wind",), "Vent violent"),
        (("coastal", "wave"), "Vagues-submersion"),
        (("avalanche",), "Avalanches"),
        (("forest-fire", "forest fire"), "Feux de forêt"),
    )
    for needles, label in translations:
        if any(needle in lowered for needle in needles):
            return label
    cleaned = value.replace(" warning", "").replace("Warning", "").strip()
    return cleaned or "Phénomène météorologique surveillé"


def format_date(value: datetime | None) -> str:
    if value is None:
        return ""
    local = value.astimezone(PARIS)
    return f"{local.day} {MONTHS[local.month - 1]} à {local:%H:%M}"


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def fetch_feed() -> bytes:
    request = urllib.request.Request(
        FEED_URL,
        headers={"User-Agent": "Aube-Vigilance-GitHub-Action/1.0"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def build_payload(xml_data: bytes) -> dict[str, object]:
    root = ET.fromstring(xml_data)
    now = datetime.now(timezone.utc)
    alerts: list[dict[str, object]] = []

    for entry in root.findall(f"{ATOM}entry"):
        if text(entry, f"{CAP}areaDesc").casefold() != DEPARTMENT.casefold():
            continue

        expires = parse_date(text(entry, f"{CAP}expires"))
        if expires is not None and expires <= now:
            continue

        title = text(entry, f"{ATOM}title")
        severity = text(entry, f"{CAP}severity")
        event = text(entry, f"{CAP}event")
        alerts.append(
            {
                "level": detect_level(title, severity),
                "phenomenon": translate_event(event),
                "starts_at": parse_date(
                    text(entry, f"{CAP}onset")
                    or text(entry, f"{CAP}effective")
                ),
                "ends_at": expires,
                "sent_at": parse_date(text(entry, f"{CAP}sent"))
                or parse_date(text(entry, f"{ATOM}updated")),
            }
        )

    if not alerts:
        return {
            "department": DEPARTMENT,
            "level": "green",
            "label": LEVEL_LABEL["green"],
            "phenomenon": "Aucun phénomène dangereux signalé pour l'Aube.",
            "period": "Aucune alerte active",
            "updatedAt": "Vérification automatique active",
            "source": "MeteoAlarm / EUMETNET",
            "sourceUrl": "https://meteoalarm.org",
        }

    alerts.sort(key=lambda alert: LEVEL_RANK[str(alert["level"])], reverse=True)
    level = str(alerts[0]["level"])
    phenomena = unique([str(alert["phenomenon"]) for alert in alerts])
    starts = [alert["starts_at"] for alert in alerts if alert["starts_at"]]
    ends = [alert["ends_at"] for alert in alerts if alert["ends_at"]]
    sent_dates = [alert["sent_at"] for alert in alerts if alert["sent_at"]]
    start = min(starts) if starts else None
    end = max(ends) if ends else None
    sent = max(sent_dates) if sent_dates else now
    period = (
        f"Du {format_date(start)} au {format_date(end)}"
        if start and end
        else "Période précisée dans le bulletin"
    )

    return {
        "department": DEPARTMENT,
        "level": level,
        "label": LEVEL_LABEL[level],
        "phenomenon": " · ".join(phenomena),
        "period": period,
        "updatedAt": format_date(sent),
        "source": "MeteoAlarm / EUMETNET",
        "sourceUrl": "https://meteoalarm.org",
    }


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    ) as temporary:
        temporary.write(content)
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def main() -> None:
    payload = build_payload(fetch_feed())
    encoded = json.dumps(payload, ensure_ascii=False, indent=2)
    atomic_write(OUTPUT_DIR / "vigilance.json", encoded + "\n")
    atomic_write(
        OUTPUT_DIR / "vigilance-data.js",
        "window.METEOALARM_VIGILANCE = " + encoded + ";\n",
    )
    print(f"Vigilance {payload['label']} générée pour {DEPARTMENT}.")


if __name__ == "__main__":
    main()
