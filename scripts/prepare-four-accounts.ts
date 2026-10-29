import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('.runtime',{recursive:true});
const file='.runtime/demo-credentials.json';
try {const rows=JSON.parse(await readFile(file,'utf8'));if(rows.length!==4)throw Error('INVALID_EXISTING_ACCOUNTS');console.log('Reusing four local demo accounts.');}
catch(error:any){if(error.code!=='ENOENT')throw error;
 const names=['김민준 (가명·합성)','이서연 (가명·합성)','박영희 (가명·합성)','최정호 (가명·합성)'];
 const rows=names.map((name,i)=>({name,identifier:`caregap-demo-${i+1}`,password:randomBytes(24).toString('base64url'),user_id:randomUUID(),role:i<2?'staff':'patient',...(i>=2?{person_id:randomUUID(),staff_user_id:''}:{})}));
 rows[2].staff_user_id=rows[0].user_id;rows[3].staff_user_id=rows[1].user_id;
 await writeFile(file,JSON.stringify(rows,null,2),{flag:'wx',mode:0o600});console.log('Created four local demo accounts.');
}
console.log('Credentials: .runtime/demo-credentials.json (gitignored; do not publish)');
