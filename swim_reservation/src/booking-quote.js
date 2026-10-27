import {catalog,campUrl,checkoutDate} from './camp-site.js';

// Public site detail GET only. Never follows a booking form or sends identity data.
export function parseQuote(html,{startDate,nights,adults=2},siteId){
  const forms=[...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].filter(m=>/\bjs-quote\b/.test(m[1]));
  if(forms.length!==1)return null;
  const attr=name=>new RegExp('\\b'+name+'=["\x27]([^"\x27]*)["\x27]','i').exec(forms[0][1])?.[1];
  if(attr('data-ci')!==startDate||attr('data-co')!==checkoutDate(startDate,nights)||attr('data-site')!==String(siteId))return null;
  if(!new RegExp('<input\\b(?=[^>]*\\bname=["\x27]ad["\x27])(?=[^>]*\\bvalue=["\x27]'+adults+'["\x27])[^>]*>','i').test(forms[0][2]))return null;
  const totals=[...forms[0][2].matchAll(/<div\b[^>]*class=["']sum-row total["'][^>]*>\s*<span>\s*총 금액\s*<\/span>\s*<span>\s*([\d,]+)원\s*<\/span>\s*<\/div>/gi)];
  if(totals.length!==1)return null;
  const amount=Number(totals[0][1].replaceAll(',',''));return Number.isSafeInteger(amount)&&amount>0&&amount<100000000?amount:null;
}
export async function bookingQuote(input,{fetcher=fetch,now=Date.now()}={}){
  const config={startDate:String(input.startDate||''),nights:Number(input.nights),adults:Number(input.adults||2)};
  checkoutDate(config.startDate,config.nights);
  const names=[...new Set(input.roomNames||[])];
  if(!names.length||names.length>14||names.some(name=>!catalog.has(name))||![1,2].includes(config.adults))throw Error('숙박 기간·선택 사이트·성인 인원을 확인하세요.');
  const [year,month]=config.startDate.split('-').map(Number),opening=Date.UTC(year,month-3,1)-9*3600000;
  const quotes=names.map(name=>({name,total:null}));if(now<opening)return {quotes,reason:'오픈 전 · 금액 미확인'};
  const signal=AbortSignal.timeout(12000);let reason='공식 금액 미확인';
  for(const quote of quotes){
    if(signal.aborted)break;
    try{
      const siteId=catalog.get(quote.name).siteId,url=campUrl(config,'site.php',siteId);
      const response=await fetcher(url,{method:'GET',redirect:'error',signal});
      if(!response.ok){reason='금액 조회 HTTP '+response.status;if([403,429].includes(response.status))break;continue;}
      const html=await response.text();if(html.length>1000000)break;
      quote.total=parseQuote(html,config,siteId);
    }catch{break;}
  }
  return {quotes,reason:quotes.every(q=>q.total!==null)?'공식 금액 확인':reason};
}
