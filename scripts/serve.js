import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
const root=resolve(process.argv[2] || 'dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');let pathname;
 try{pathname=decodeURIComponent(url.pathname)}catch{res.writeHead(400);res.end();return}
 const file=resolve(join(root,pathname.replace(/^\/+/,'')));
 if(file!==root && !file.startsWith(root+sep)){res.writeHead(403);res.end();return}
 let target=file;
 try{if(!(await stat(target)).isFile())target=join(root,'index.html');}
 catch{target=extname(file)?file:join(root,'index.html');}
 try{const body=await readFile(target);res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});res.end(body)}catch{res.writeHead(404);res.end('Not found')}
});server.listen(4173,'127.0.0.1',()=>console.log('http://127.0.0.1:4173'));
