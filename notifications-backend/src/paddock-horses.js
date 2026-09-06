// One bulk ownership check, independent of the weekly Backstage view.
export async function validateBookingHorses(env, value, userId) {
  const ids=value===undefined?[]:value;
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)
    return {error:'Sélection de chevaux invalide',status:400};
  if(ids.length){
    const result=await env.DB.prepare(`SELECT h.id FROM horse_owners o JOIN planning_horses h ON h.id=o.horse_id
      WHERE o.user_id=? AND h.status='active' AND h.id IN (SELECT value FROM json_each(?))`).bind(userId,JSON.stringify(ids)).all();
    if(result.results.length!==ids.length)return {error:'Un des chevaux sélectionnés ne peut pas être réservé par ce compte',status:403};
  }
  return {ids};
}
export function bookingHorseInsert(env,lockKey,ids){
  return env.DB.prepare(`INSERT INTO paddock_booking_horses(booking_id,horse_id)
    SELECT r.id,j.value FROM paddock_reservations r,json_each(?) j WHERE r.lock_key=?`)
    .bind(JSON.stringify(ids),lockKey);
}
export async function bookingHorseOptions(env,userId){
  const result=await env.DB.prepare(`SELECT h.id,h.name FROM horse_owners o JOIN planning_horses h ON h.id=o.horse_id
    WHERE o.user_id=? AND h.status='active' ORDER BY h.name,h.id`).bind(userId).all();
  return result.results;
}
export const bookingHorsesJson=`(SELECT json_group_array(json_object('id',h.id,'name',h.name))
  FROM paddock_booking_horses bh JOIN planning_horses h ON h.id=bh.horse_id WHERE bh.booking_id=r.id)`;
export const paddockLabelSql=`CASE r.paddock WHEN 'maison' THEN 'Maison' WHEN 'grande' THEN 'Grande voie' ELSE 'Beudot' END`;
