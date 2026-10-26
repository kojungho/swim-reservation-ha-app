import test from 'node:test';
import assert from 'node:assert/strict';
import {validPersonName} from '../src/person-name.js';
import {validateProfile} from '../src/config.js';
export const acceptedNames=['고중호','홍 길동','O’Neill','Jean-Luc','José','Jose\u0301','김'.normalize('NFD'),'王小明'];
export const rejectedNames=['',' ','ㄴ','ㄱㅏ','ㅏ','홍ㄴ','ᄂ','123','홍123','홍😀','-홍','홍-','\u0301','홍\n길동','a'.repeat(51)];
test('완성된 국제 이름은 허용하고 미완성 한글 자모·숫자·기호 이름은 거부한다',()=>{
 for(const value of acceptedNames)assert.equal(validPersonName(value),true,value);
 for(const value of [...rejectedNames,null,123])assert.equal(validPersonName(value),false,String(value));
});
test('예약자 저장·예약 실행의 서버 검증도 이름 형식을 검사한다',()=>{
 for(const name of rejectedNames){const errors=[];validateProfile({reserverName:name,phone:'01000000000'},'예약자',errors);assert.match(errors.join(','),/예약자명/);}
 const errors=[];validateProfile({reserverName:'고중호',phone:'01000000000'},'예약자',errors);assert.deepEqual(errors,[]);
});
