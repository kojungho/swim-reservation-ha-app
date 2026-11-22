import { catalog, checkoutDate } from './camp-site.js';
import { normalizeProfile, validateProfile } from './config.js';
import { bookingQuote } from './booking-quote.js';
import { cardError } from './card-vault.js';

// Resolve the existing booking editor into independently reviewed orders.
// Candidates stay candidates: choose one explicitly before creating an unpaid order.
export async function prepareBookingReview(input, { quote = bookingQuote, now = Date.now() } = {}) {
  const startDate = String(input?.startDate || ''), nights = Number(input?.nights), adults = Number(input?.adults || 2);
  try { checkoutDate(startDate, nights); } catch { throw cardError('REVIEW_INPUT'); }
  if (startDate < new Date(now + 9 * 3600000).toISOString().slice(0,10) || ![1,2].includes(adults)) throw cardError('REVIEW_INPUT');
  const source = input?.bookingMode === 'profiles-parallel' ? input.profiles : [input?.profile1 || input?.profile];
  if (!Array.isArray(source) || !source.length || source.length > catalog.size) throw cardError('REVIEW_INPUT');
  const groups = source.map(raw => {
    const profile = normalizeProfile(raw), errors = [];
    validateProfile(profile, '예약자', errors);
    const candidates = (input.bookingMode === 'profiles-parallel' ? raw.roomPriority : input.roomPriority) || [];
    const names = candidates.filter(r=>r.enabled).map(r=>r.name);
    if (errors.length || !names.length || names.length > catalog.size || new Set(names).size !== names.length || names.some(n=>!catalog.has(n))) throw cardError('REVIEW_INPUT');
    return {profile:{reserverName:profile.reserverName,phone:profile.phone},names};
  });
  const arrivalTime=String(input.arrivalTime||''),request=String(input.request||'');
  if(request.length>1000 || (arrivalTime&&!['14:00 ~ 15:00','15:00 ~ 16:00','16:00 ~ 17:00','17:00 ~ 18:00','18:00 ~ 19:00','19:00 이후'].includes(arrivalTime))) throw cardError('REVIEW_INPUT');
  const roomNames = [...new Set(groups.flatMap(g=>g.names))];
  const priced = await quote({startDate,nights,adults,roomNames});
  const jobs = groups.flatMap((g,profileIndex)=>g.names.map(name=>{
    const amount = priced.quotes?.find(q=>q.name===name)?.total;
    if (!Number.isSafeInteger(amount) || amount < 1 || amount >= 300000) throw cardError('ORDER_MISMATCH');
    return {startDate,nights,adults,arrivalTime,request,siteId:catalog.get(name).siteId,roomName:name,amount,profileIndex,profile:g.profile};
  }));
  return jobs;
}
export function publicBookingJobs(jobs) {
  return jobs.map((j,index)=>({index,profileIndex:j.profileIndex,reserverName:j.profile.reserverName,roomName:j.roomName,startDate:j.startDate,nights:j.nights,adults:j.adults,amount:j.amount}));
}
