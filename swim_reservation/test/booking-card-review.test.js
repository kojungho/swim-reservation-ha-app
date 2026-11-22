import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBookingReview,publicBookingJobs} from '../src/booking-card-review.js';
import {ROOM_NAMES} from '../src/config.js';
const person=(name='검토자',site=0)=>({reserverName:name,phone:'01000000000',roomPriority:[{name:ROOM_NAMES[site],enabled:true}]});
const config=profiles=>({startDate:'2099-01-27',nights:1,adults:2,bookingMode:'profiles-parallel',profiles});
const quote=async({roomNames})=>({quotes:roomNames.map(name=>({name,total:60000}))});
test('unified editor resolves single, different people and same-person multiple orders',async()=>{
  for(const profiles of [[person()],[person(),person('다른이',1)],[person(),person('검토자',1)]]){
    const jobs=await prepareBookingReview(config(profiles),{quote});assert.equal(jobs.length,profiles.length);
    jobs.forEach((job,i)=>{assert.equal(job.profile.reserverName,profiles[i].reserverName);assert.equal(job.siteId,i+1);assert.equal(job.amount,60000);});
    assert.equal(JSON.stringify(publicBookingJobs(jobs)).includes('01000000000'),false);
  }
});
test('priority candidates remain alternatives and amount must come from official quote',async()=>{
  const p=person();p.roomPriority.push({name:ROOM_NAMES[1],enabled:true});
  const jobs=await prepareBookingReview(config([p]),{quote});assert.deepEqual(jobs.map(j=>j.profileIndex),[0,0]);
  await assert.rejects(prepareBookingReview(config([p]),{quote:async()=>({quotes:[]})}),{code:'ORDER_MISMATCH'});
  await assert.rejects(prepareBookingReview(config([person('bad-name')]),{quote}),{code:'REVIEW_INPUT'});
  await assert.rejects(prepareBookingReview({...config([p]),startDate:'2099-02-30'},{quote}),{code:'REVIEW_INPUT'});
});
