import { cardError } from './card-vault.js';
import { samsungStep } from './card-review-guard.js';
import { checkoutDate } from './camp-site.js';

// Publicly documented synthetic test card. This fixture never opens the network.
export const FIXTURE_CARD = Object.freeze({ cardNumber: '378282246310005', cvc: '123', password: '123456' });
const svg = body => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="135">${body}</svg>`).toString('base64');
export function fixtureIssuer(step) {
  if (step === '400') return '<button onclick="document.querySelector(\'section\').hidden=false">다른결제 일반/SMS/로그인결제</button><section hidden><button onclick="location.href=\'/VbV/xacsv2/WBVTFX300.jsp\'">일반 결제 카드번호로 결제</button></section>';
  const password = step === '301';
  const background = svg('<rect width="250" height="135" fill="#eceef1"/><text x="8" y="19" font-size="13">보안키패드</text><path d="M232 7l10 10m0-10l-10 10" stroke="black"/>');
  return `<!doctype html><html lang="ko"><meta charset="utf-8"><style>body{font:16px Arial;padding:20px}input{display:block;width:340px;height:36px;margin:10px 0 20px}#keyboard{position:fixed;left:20px;top:260px;width:250px;height:135px}#keyboard img{position:absolute}button{padding:16px}#keyboard img.key{width:37px;height:30px}</style>
    <p>(주)쉼오지캠프</p><p>60,000원</p>
    ${password ? '<label>일반결제 비밀번호<input placeholder="숫자 6자리 입력" type="password" readonly></label><button id="next" disabled>결제하기</button>' : '<label>카드 번호<input aria-label="카드 번호" placeholder="카드번호 [-] 없이 입력" readonly></label><label>CVC번호<input aria-label="CVC번호" placeholder="CVC번호 뒤 3자리" type="password" readonly></label><form method="post" action="/VbV/xacsv2/WBVTFX301.jsp"><button id="next" disabled>다음</button></form>'}
    <div id="keyboard" hidden></div><script>
    const keyboard=document.querySelector('#keyboard'),inputs=[...document.querySelectorAll('input')],values=new Map(inputs.map(e=>[e,'']));let selected=null;
    const picture=(body,w=37,h=30)=>'data:image/svg+xml;base64,'+btoa('<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'">'+body+'</svg>');
    function update(){document.querySelector('#next').disabled=${password ? "values.get(inputs[0]).length!==6" : "values.get(inputs[0]).length!==15||values.get(inputs[1]).length!==3"};}
    inputs.forEach((input,index)=>input.onclick=()=>{
      selected=input;keyboard.hidden=false;keyboard.replaceChildren();const bg=new Image();bg.alt='키패드';bg.id='fixture'+index+'_bg_img';bg.width=250;bg.height=135;bg.src=${JSON.stringify(background)};bg.onclick=e=>{if(e.offsetX>225&&e.offsetY<26)keyboard.hidden=true};keyboard.append(bg);
      const blanks=index===0?[1,10]:[4,8];let digit=0;
      for(let cell=0;cell<12;cell++){if(blanks.includes(cell))continue;const number=String(++digit%10),key=new Image();key.alt='키패드';key.className='key';key.style.left=(6+40*(cell%6))+'px';key.style.top=(33+33*Math.floor(cell/6))+'px';key.src=picture('<rect width="37" height="30" fill="white"/><text x="18.5" y="24" text-anchor="middle" font-family="Arial" font-size="25" fill="black">'+number+'</text>');key.onclick=()=>{const limit=${password ? '6' : 'index===0?15:3'};if(values.get(input).length>=limit)return;values.set(input,values.get(input)+number);input.value=input.type==='password'?'*'.repeat(values.get(input).length*10):values.get(input);update();};keyboard.append(key);}
    });
    </script></html>`;
}
export function createReviewFixture(config) {
  const record = { networkRequests: 0, blockedApproval: false };
  return {
    record,
    async install(context, guard) {
      // Route fulfillment works offline; any uncaught redirect or missing fixture
      // must fail locally instead of reaching a real merchant or issuer.
      await context.setOffline(true);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (!guard.allow({ url: request.url(), method: request.method(), navigation: request.isNavigationRequest() })) { guard.blocked++; record.blockedApproval ||= guard.frozen; return route.abort(); }
        let html;
        if (url.hostname === 'www.swimozicamp.com' && url.pathname === '/camp/book.php') {
          html = request.method() === 'POST' ? '<iframe name="inipay" style="width:700px;height:650px" src="about:blank"></iframe><form method="post" target="inipay" action="https://stdpay.inicis.com/payMain/pay"></form><script src="https://stdux.inicis.com/stdpay/pc/js/plugins.js"></script><script>fixtureOpenPG()</script>' : `<form class="js-book" method="post" action="https://www.swimozicamp.com/camp/book.php">${Object.entries({ _csrf: 'synthetic-csrf', site: config.siteId, checkin: config.startDate, checkout: checkoutDate(config.startDate,config.nights), adults: config.adults, children: 0, infants: 0 }).map(([name, value]) => `<input type="hidden" name="${name}" value="${value}">`).join('')}<input name="name"><input name="phone"><input name="pay_method" type="radio" value="card"><input name="agree_refund" type="checkbox"><div class="sum-title">하늘존해</div><p>총 금액 60,000원</p><button type="submit">결제하기</button></form>`;
        } else if (url.hostname === 'stdux.inicis.com' && url.pathname === '/stdpay/pc/js/plugins.js') {
          return route.fulfill({status:200,contentType:'application/javascript',body:'function fixtureOpenPG(){document.forms[0].submit()}'});
        } else if (url.hostname === 'stdpay.inicis.com' && url.pathname === '/payMain/pay') {
          html = '<body><script>fetch("/payMain/Card",{method:"POST"}).then(r=>r.text()).then(html=>document.body.innerHTML=html);async function openIssuer(){await fetch("/payMain/checkAssentAll",{method:"POST"});await fetch("/jsApi/visa3d/before",{method:"POST"});window.open("/checkWin.jsp","fixtureIssuer");const form=document.createElement("form");form.method="POST";form.target="fixtureIssuer";form.action="/payAuthentication/visa3d";document.body.append(form);form.submit()}</script>';
        } else if (url.hostname === 'stdpay.inicis.com' && url.pathname === '/payMain/Card') {
          html = '<input style="display:none" type="checkbox" id="inputChk7"><label for="inputChk7">필수 약관 7</label><input style="display:none" type="checkbox" id="inputChk3"><label for="inputChk3">필수 약관 3</label><input style="display:none" type="checkbox" id="inputChk4"><label for="inputChk4">필수 약관 4</label><a href="#" onclick="fetch(\'/payMain/getCardCodeQuota\',{method:\'POST\'});return false">삼성카드</a><a id="CardBtn" href="#" onclick="openIssuer();return false">다음</a>';
        } else if (url.hostname === 'stdpay.inicis.com' && ['/jsApi/visa3d/before','/payMain/checkAssentAll','/payMain/getCardCodeQuota'].includes(url.pathname)) {
          return route.fulfill({status:200,contentType:'application/json',body:'{"resultCode":"0000"}'});
        } else if (url.hostname === 'stdpay.inicis.com' && url.pathname === '/checkWin.jsp') {
          html = '인증창 연결 중';
        } else if (url.hostname === 'stdpay.inicis.com' && url.pathname === '/payAuthentication/visa3d') {
          html = '<script>location.replace("https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX400.jsp")</script>';
        } else if (['400','300','301'].includes(samsungStep(url.href))) html = fixtureIssuer(samsungStep(url.href));
        if (!html) return route.abort();
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      });
    },
    async verifyFinalBoundary(page, guard) {
      if (!guard.frozen || guard.allow({ url: 'https://vbv.samsungcard.co.kr/VbV/xacsv2/WBVTFX999.jsp', method: 'POST', navigation: true })) throw cardError('REVIEW_FAILED');
      const blocked = await page.evaluate(async () => { try { await fetch('/VbV/xacsv2/WBVTFX999.jsp', { method: 'POST' }); return false; } catch { return true; } });
      if (!blocked || await page.getByRole('button', { name: '결제하기', exact: true }).isEnabled()) throw cardError('REVIEW_FAILED');
      record.blockedApproval = true;
    }
  };
}
