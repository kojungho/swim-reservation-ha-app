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
  console.log('Offline form-target frame and connection-only check passed: no card data entered');
} finally { await review.stop(); }
