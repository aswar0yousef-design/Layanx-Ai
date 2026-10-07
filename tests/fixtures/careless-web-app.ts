import http from "node:http";

/**
 * A deliberately careless web app for security-scan tests: no security headers, leaky cookies,
 * reflected CORS with credentials, stack traces, a third-party script without SRI, and it serves .env and .git.
 */
export function startCarelessApp(host="127.0.0.1"):Promise<{server:http.Server;port:number}>{
  const server=http.createServer((req,res)=>{
    const url=req.url??"/";
    const base:Record<string,string>={"content-type":"text/html; charset=utf-8","server":"nginx/1.25.3","x-powered-by":"Express"};
    if(req.headers.origin)Object.assign(base,{"access-control-allow-origin":String(req.headers.origin),"access-control-allow-credentials":"true"});
    if(url==="/"){res.writeHead(200,{...base,"set-cookie":["session_id=abc; Path=/","theme=dark; Path=/; HttpOnly; SameSite=Lax"]});
      res.end(`<html><head><title>Shop</title><script src="https://cdn.example.com/lib.js"></script></head><body><a href="/about">About</a><a href="/crash">x</a><a href="https://other.example/">ext</a><img src="/logo.png"><form action="/login" method="post"><input name="user"><input type="password" name="pass"></form></body></html>`);return;}
    if(url==="/about"){res.writeHead(200,{...base,"content-security-policy":"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'"});res.end("<html><body>About <a href='/'>home</a></body></html>");return;}
    if(url==="/crash"){res.writeHead(500,base);res.end("<pre>TypeError: x is undefined\n    at Object.handler (C:\\app\\server.js:10:5)\n    at next (C:\\app\\node_modules\\express\\router.js:1:2)</pre>");return;}
    if(url==="/.env"){res.writeHead(200,{"content-type":"text/plain"});res.end("DATABASE_URL=postgres://u:p@h/db\nAPI_KEY=123\n");return;}
    if(url==="/.git/HEAD"){res.writeHead(200,{"content-type":"text/plain"});res.end("ref: refs/heads/main\n");return;}
    res.writeHead(404,{"content-type":"text/plain"});res.end("not found");
  });
  return new Promise(r=>server.listen(0,host,()=>r({server,port:(server.address() as {port:number}).port})));
}
