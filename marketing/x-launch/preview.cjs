// Local-only launch artwork renderer. Serves synthetic posts, never reads X.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const assets=new Set(['/content.css','/pages.js','/layout.js','/video.js','/content.js','/icons/icon-128.png',
 '/marketing/x-launch/index.html','/marketing/x-launch/grid.png','/marketing/x-launch/native.png',
 '/marketing/x-launch/two-columns.png','/marketing/x-launch/one-column.png']);
http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');let file=u.pathname;
 if(file==='/i/history/likes')file='/marketing/x-launch/demo.html';
 else if(!assets.has(file)){res.writeHead(404);res.end('Not found');return;}
 const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'};
 try{res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});res.end(fs.readFileSync(path.join(root,file)));}
 catch{res.writeHead(404);res.end('Not found');}
}).listen(4174,'127.0.0.1',()=>console.log('Launch previews: http://127.0.0.1:4174/i/history/likes'));
