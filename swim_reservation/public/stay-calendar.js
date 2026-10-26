// Read-only calendar counts. A checkout day is not an occupied night.
window.StayCalendarModel = class StayCalendarModel {
  constructor(fetchMonth, now = Date.now) { this.fetchMonth=fetchMonth;this.now=now;this.cache=new Map();this.pending=new Map(); }
  today(){return new Date(this.now()+9*3600000).toISOString().slice(0,10);}
  fresh(value){return value&&!value.error&&this.now()-value.at>=0&&this.now()-value.at<60000;}
  async load(month,{force=false}={}){
    if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return;
    if(!force&&this.fresh(this.cache.get(month)))return;
    if(this.pending.has(month))return this.pending.get(month);
    const task=(async()=>{try{
      const raw=await this.fetchMonth(month,{force});if(raw.month!==month||!Array.isArray(raw.days))throw Error('달력 형식 미확인');
      const days=new Map();for(const row of raw.days){if(typeof row.date!=='string'||row.date.slice(0,7)!==month)continue;
        const count=Number.isInteger(row.availableCount)&&row.availableCount>=0?row.availableCount:null;
        days.set(row.date,{state:row.beforeOpen===true||typeof raw.openThrough==='string'&&row.date>raw.openThrough?'planned':count===null?'unknown':count===0?'closed':'available',count});}
      this.cache.set(month,{at:this.now(),days});
    }catch(error){this.cache.set(month,{at:this.now(),days:new Map(),error:true});}
    finally{this.pending.delete(month);if(this.cache.size>12)this.cache.delete(this.cache.keys().next().value);}})();
    this.pending.set(month,task);return task;
  }
  day(date){if(date<this.today())return {state:'past',count:null};const entry=this.cache.get(date.slice(0,7));return this.fresh(entry)?entry.days.get(date)||{state:'unknown',count:null}:{state:'unknown',count:null};}
  allow(date,phase,start,watch=false){
    if(date<this.today())return false;
    if(phase!=='end')return watch||this.day(date).state!=='closed';
    const nights=(Date.parse(date+'T00:00:00Z')-Date.parse(start+'T00:00:00Z'))/86400000;
    if(start<this.today()||!Number.isInteger(nights)||nights<1||nights>6)return false;
    if(!watch)for(let n=0;n<nights;n++){const night=new Date(Date.parse(start+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);if(this.day(night).state==='closed')return false;}
    return true;
  }
  planned(start,nights=1){if(!start)return false;for(let i=0;i<nights;i++){const time=Date.parse(start+'T00:00:00Z')+i*86400000;if(Number.isFinite(time)&&this.day(new Date(time).toISOString().slice(0,10)).state==='planned')return true;}return false;}
  label(date){const day=this.day(date);return day.state==='past'?'':day.state==='planned'?'예정':day.state==='closed'?'마감':day.state==='available'?day.count+'곳':'미확인';}
};
