import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const index=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
const schedules=readFileSync(new URL("../../assets/js/pages/horaires.js",import.meta.url),"utf8");

test("l’alerte temporaire utilise le bandeau sans remplacer les horaires",()=>{
  assert.match(index,/const activeException=/);
  assert.match(index,/alertBox\.textContent="⚠️ "\+alertMessage/);
  assert.match(index,/activeException\.color\|\|"orange"/);
  assert.doesNotMatch(index,/status\.textContent=ex\.message/);
  assert.doesNotMatch(schedules,/EXCEPTIONS_URL|exceptions\[row\.jour\]/);
  assert.match(schedules,/contenu=`\$\{formatTime\(row\.ouvert\)\} - \$\{formatTime\(row\.ferme\)\}/);
});
