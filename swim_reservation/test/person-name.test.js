import test from 'node:test';
import assert from 'node:assert/strict';
import {validPersonName} from '../src/person-name.js';
import {validateProfile} from '../src/config.js';
export const acceptedNames=['고중호','홍길','김수'.normalize('NFD'),'가'.repeat(50)];
export const rejectedNames=['',' ','김','김'.normalize('NFD'),'홍 길동','John Smith','John','김John','王小明','やまだ','Иван','José','Jose\u0301','O’Neill','Jean-Luc','홍·길동','홍-길동',"홍'길동",'홍\t길동','ㄴ','ㄱㅏ','ㅏ','홍ㄴ','ᄂ','123','홍123','홍😀','-홍','홍-','\u0301','홍\n길동','가'.repeat(51)];
test('완성된 한글 2~50글자만 허용하고 외국어·혼합 이름도 거부한다',()=>{
 for(const value of acceptedNames)assert.equal(validPersonName(value),true,value);
 for(const value of [...rejectedNames,null,123])assert.equal(validPersonName(value),false,String(value));
});
test('예약자 저장·예약 실행의 서버 검증도 이름 형식을 검사한다',()=>{
 for(const name of rejectedNames){const errors=[];validateProfile({reserverName:name,phone:'01000000000'},'예약자',errors);assert.match(errors.join(','),/예약자명/);}
 const errors=[];validateProfile({reserverName:'고중호',phone:'01000000000'},'예약자',errors);assert.deepEqual(errors,[]);
});
