import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/index.js';
import { validateEnvironment } from '../lib/env.js';
if(process.env.NODE_ENV!=='test')validateEnvironment();
await import('./build.mjs');
const root=path.resolve('public');
http.createServer(async(req,res)=>{
 res.status=n=>{res.statusCode=n;return res;};res.json=x=>res.end(JSON.stringify(x));
 try{
  const u=new URL(req.url,'http://localhost');
  if(u.pathname==='/api'||u.pathname==='/api/index'){
   let body='';for await(const chunk of req){body+=chunk;if(body.length>3100000){res.statusCode=413;return res.end('Too large');}}
   try{req.body=body?JSON.parse(body):{};}catch{res.statusCode=400;return res.json({error:'Invalid JSON'});}return await handler(req,res);
  }
  const file=path.resolve(root,'.'+decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname));
  if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end();}
  const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8','.jpg':'image/jpeg','.css':'text/css'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
 }catch{res.statusCode=404;res.end('Not found');}
}).listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log('http://localhost:'+ (process.env.PORT||3000)));
