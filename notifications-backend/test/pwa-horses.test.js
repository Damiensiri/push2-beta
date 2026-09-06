import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../../',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');

test('la PWA expose Mes chevaux avec une fiche et un planning agrégé',async()=>{
  const [home,page,script,worker,manifest]=await Promise.all([read('index.html'),read('mes-chevaux.html'),read('assets/js/pages/mes-chevaux.js'),read('OneSignalSDKWorker.js'),read('manifest.json')]);
  assert.match(home,/go\('mes-chevaux\.html'\)/);
  assert.match(page,/id="horseDetail"/);assert.match(page,/id="activityForm"/);
  assert.match(script,/\/api\/me\/horses/);assert.match(script,/planning\/tasks/);assert.match(script,/event\.canEdit/);
  assert.doesNotMatch(page+script,/adminNotes|horse_owners|photo_key|notifications-prod/i);
  for(const text of [home,worker,manifest])assert.match(text,/20260906-5/);
});
