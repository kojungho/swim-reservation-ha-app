import {prepareBookingReview} from './booking-card-review.js';
// Offline image/runtime check. No credentials, vault, real guests or live orders.
import { CardReview } from './card-review.js';
import { createReviewFixture, FIXTURE_CARD } from './card-review-fixture.js';
const config = { startDate: '2027-01-27', nights: 1, adults: 2, siteId: 1, amount: 60000, profile: { reserverName: '로컬 검토', phone: '01000000000' } };
const review = new CardReview();
try {
  review.start(config, { ...FIXTURE_CARD }, { fixture: createReviewFixture(config) });
  await review.work;
  const status = review.status();
  if (status.state !== 'ready' || !status.fixture || !status.networkBlocked || status.finalPaymentAttempted || !Object.values(status.fieldsVerified || {}).every(Boolean)) throw Error('Offline card review failed: ' + (status.code || status.state));
  console.log('Offline card review passed: all fields verified, approval blocked, no live network');
  await review.stop();
  review.start(config, {}, { fixture: createReviewFixture(config), connectionOnly: true }); await review.work;
  const connection = review.status();
  if (connection.state !== 'connected' || connection.cardDataEntered !== false || !connection.networkBlocked) throw Error('Offline connection-only check failed: ' + (connection.code || connection.state));
  await review.stop();
  const row=(name,room)=>({reserverName:name,phone:'01000000000',roomPriority:[{name:room,enabled:true}]});
  const a=row('검토자','해_하늘존'), b=row('다른이','달_하늘존'), same=row('검토자','달_하늘존');
  for(const [label,profiles] of [['single',[a]],['people',[a,b]],['multiple',[a,same]]]) {
    const jobs=await prepareBookingReview({...config,bookingMode:'profiles-parallel',profiles,arrivalTime:'14:00 ~ 15:00',request:'샘플 요청'},{quote:async({roomNames})=>({quotes:roomNames.map(name=>({name,total:60000}))})});
    for(const job of jobs){
      review.start(job,{...FIXTURE_CARD},{fixture:createReviewFixture(job)});await review.work;
      const s=review.status();
      if(s.state!=='ready'||!s.networkBlocked||s.finalPaymentAttempted)throw Error('Integrated offline review failed: '+label+':'+(s.code||s.state));
      await review.stop();
    }
    console.log('Integrated '+label+' review passed: '+jobs.length+' orders, approval blocked, no live network');
  }
  console.log('Offline form-target frame and connection-only check passed: no card data entered');
} finally { await review.stop(); }
