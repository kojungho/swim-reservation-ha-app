import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
const queues=new Map();
export class BookingRecords {
 constructor(dir){this.file=path.join(dir,'reservation-submitted-records.json');}
 async list(){await (queues.get(this.file)||Promise.resolve());try{return JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
 locked(action){const next=(queues.get(this.file)||Promise.resolve()).then(action);queues.set(this.file,next.catch(()=>{}));return next;}
 async read(){try{return JSON.parse(await readFile(this.file,'utf8'));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
 async write(entries){await mkdir(path.dirname(this.file),{recursive:true});await writeFile(this.file+'.tmp',JSON.stringify(entries),{mode:0o600});await rename(this.file+'.tmp',this.file);}
 begin(record){return this.locked(async()=>{
  if(!/^[a-f0-9-]{36}$/.test(record.id)||!record.entered?.name||!/^01\d{8,9}$/.test(record.entered.phone))throw new Error('제출 정보 보존 검증 실패');
  const entered={};for(const key of ['name','phone','depositor','request','arrival']){const value=String(record.entered[key]||'');if(value.length>4096)throw new Error('제출 정보 크기 초과');entered[key]=value;}
  if(!Array.isArray(record.entered.fields)||record.entered.fields.length>16)throw new Error('제출 필드 형식 불일치');
  entered.fields=record.entered.fields.map(field=>{if(!['name','phone','depositor','request','arrive_time'].includes(field.role)||typeof field.value!=='string'||field.value.length>4096||typeof field.name!=='string'||field.name.length>100)throw new Error('제출 필드 검증 실패');return {role:field.role,name:field.name,value:field.value};});
  const entries=await this.read();if(entries.some(entry=>entry.id===record.id))return record.id;if(entries.length>=200)throw new Error('예약 제출 기록이 200개입니다. 불필요한 기록을 삭제해 주세요.');
  const stay={};for(const key of ['checkin','checkout','nights','site','adults'])stay[key]=record.stay?.[key]??'';
  entries.unshift({id:record.id,state:'check_required',createdAt:Date.now(),entered,stay});await this.write(entries);return record.id;
 });}
 complete(id,receipt){return this.locked(async()=>{const entries=await this.read(),entry=entries.find(item=>item.id===id);if(!entry)return;entry.state='complete';entry.completedAt=Date.now();entry.receipt={id:String(receipt.id||''),total:String(receipt.total||''),status:String(receipt.status||'')};await this.write(entries);});}
 delete(id){return this.locked(async()=>{await this.write((await this.read()).filter(entry=>entry.id!==id));});}
}
