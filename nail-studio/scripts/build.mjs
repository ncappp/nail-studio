import { mkdir,copyFile } from 'node:fs/promises';
await mkdir('public/vendor',{recursive:true});
await copyFile('node_modules/luxon/build/global/luxon.min.js','public/vendor/luxon.min.js');
console.log('Pearl frontend готов.');
