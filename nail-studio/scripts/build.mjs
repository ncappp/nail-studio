import { mkdir,copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
await mkdir('public/vendor',{recursive:true});
const require=createRequire(import.meta.url);
await copyFile(path.join(path.dirname(require.resolve('luxon/package.json')),'build/global/luxon.min.js'),'public/vendor/luxon.min.js');
console.log('Pearl frontend готов.');
