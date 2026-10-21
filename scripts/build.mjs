import {readFileSync,writeFileSync,mkdirSync,cpSync} from "node:fs";
import {createHash} from "node:crypto";
const feeds=JSON.parse(readFileSync("feeds.json","utf8")),outl=JSON.parse(readFileSync("outlets.json","utf8"));
const SITE=process.env.SITE_URL||"";
const TOPIC=process.env.NTFY_TOPIC||"contraste-"+createHash("sha1").update(SITE).digest("hex").slice(0,10);
const KW={
 es:/espa[nñ]a|español|sánchez|feijóo|\bpp\b|psoe|vox|moncloa|madrid|catalu|valenci|alicante|andaluc|ayuso|generalitat|guardia civil|aemet/i,
 geo:/guerra|ucrania|rusia|putin|zelenski|gaza|israel|hamás|irán|otan|taiw[aá]n|china|misil|sanciones|onu\b|diplom[aá]tic|ataque/i,
 eco:/econom[ií]a|inflaci[oó]n|bolsa|ibex|\bbce\b|reserva federal|\bfed\b|\bpib\b|aranceles|petr[oó]leo|d[oó]lar|mercados|tipos de inter[eé]s|\bipc\b|banco central/i,
 fut:/f[uú]tbol|laliga|champions|real madrid|bar[cç]a|atl[eé]tico|selecci[oó]n|entrenador|premier league|copa del rey/i,
 eu:/europa|europe|\bue\b|bruselas|comisi[oó]n europea|parlamento europeo|alemania|francia|italia|reino unido|macron|merz|starmer|eurozona/i,
 us:/estados unidos|ee\.? ?uu|trump|casa blanca|washington|pent[aá]gono|republican|dem[oó]crata|wall street/i};
const STOP=new Set("para como pero esta este esto estos estas sobre entre desde hasta tras cuando donde porque tambien segun mas muy sus del los las una uno unos unas que con por sin ser fue son han hay ante bajo contra hace dice dicen nuevo nueva tiene ahora hoy".split(" "));
const decode=s=>s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/<[^>]+>/g,"").replace(/&#x([0-9a-f]+);/gi,(_,h)=>String.fromCodePoint(parseInt(h,16))).replace(/&#(\d+);/g,(_,d)=>String.fromCodePoint(+d)).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/\s+/g," ").trim();
const tag=(x,t)=>{const m=x.match(new RegExp("<"+t+"[^>]*>([\\s\\S]*?)</"+t+">","i"));return m?decode(m[1]):""};
const tok=t=>new Set(t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").split(/[^a-z0-9]+/).filter(w=>w.length>3&&!STOP.has(w)));
function sim(a,b){let i=0;for(const w of a)if(b.has(w))i++;const j=i/(a.size+b.size-i||1);return((i>=3&&j>=.25)||j>=.4)?j:0}
const bias=h=>{h=h.replace(/^www\./,"");for(const d in outl)if(h===d||h.endsWith("."+d))return outl[d];return null};
const gurl=f=>"https://news.google.com/rss/"+(f.topic?"headlines/section/topic/"+f.topic+"?":"search?q="+encodeURIComponent(f.q)+"&")+"hl=es&gl=ES&ceid=ES:es";
function parse(xml,f){const out=[];
 for(const m of xml.matchAll(/<item>[\s\S]*?<\/item>/gi)){const x=m[0];
  let title=tag(x,"title");const link=tag(x,"link");
  const sm=x.match(/<source[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/source>/i);if(!sm)continue;
  let host;try{host=new URL(sm[1]).hostname}catch{continue}
  const o=bias(host);if(!o)continue;const sn=decode(sm[2]);
  if(title.endsWith(" - "+sn))title=title.slice(0,-(sn.length+3));
  const d=new Date(tag(x,"pubDate"));if(!title||!link||isNaN(d))continue;
  out.push({title,url:link,t:d.getTime(),n:o[0],b:o[1],c:f.cat});if(out.length>=40)break}
 return out}
const res=await Promise.all(feeds.map(async f=>{try{
 const r=await fetch(gurl(f),{headers:{"user-agent":"Mozilla/5.0 Contraste/2.0"},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error("HTTP "+r.status);return{f,items:parse(await r.text(),f)}}catch(e){return{f,err:String(e.message||e)}}}));
const seen0=new Set();
const items=res.flatMap(r=>r.items||[]).filter(i=>i.t>Date.now()-48*36e5&&!seen0.has(i.n+i.title)&&seen0.add(i.n+i.title)).sort((a,b)=>a.t-b.t);
const cl=[];
for(const it of items){it.k=tok(it.title);let best=null,bs=0;
 for(const c of cl)for(const m of c)if(m.k.size){const s=sim(it.k,m.k);if(s>bs){bs=s;best=c}}
 best?best.push(it):cl.push([it])}
const clusters=cl.map(c=>{const seen=new Set(),src=[];
 for(const i of c){if(seen.has(i.n))continue;seen.add(i.n);src.push({n:i.n,b:i.b,u:i.url,h:i.title})}
 const all=c.map(i=>i.title).join(" "),cats=new Set(c.map(i=>i.c).filter(Boolean));
 const al2=all.replace(/real madrid|atl[eé]tico de madrid/gi,"");for(const k in KW)if(KW[k].test(k==="es"?al2:all))cats.add(k);
 return{id:createHash("sha1").update(c[0].n+c[0].title).digest("hex").slice(0,12),t:Math.max(...c.map(i=>i.t)),cats:[...cats],title:c[0].title,src}})
 .sort((a,b)=>b.t-a.t).slice(0,200);
let prev=null;
try{const r=await fetch(SITE+"/news.json",{signal:AbortSignal.timeout(15000)});if(r.ok)prev=await r.json()}catch{}
const notified=new Set(prev?.notified||[]);
const fresh=clusters.filter(c=>c.src.length>=(c.cats.length===1&&c.cats[0]==="fut"?6:3)&&!notified.has(c.id));
if(prev){for(const c of fresh.slice(0,5)){
 let L=0,C=0,R=0,n=0;c.src.forEach(s=>{if(s.b==="N")return;n++;s.b[0]==="L"?L++:s.b[0]==="R"?R++:C++});const p=x=>Math.round(x/n*100);
 try{await fetch("https://ntfy.sh",{method:"POST",body:JSON.stringify({topic:TOPIC,title:c.title,message:c.src.length+" fuentes"+(n?` · Izquierda ${p(L)}% · Centro ${p(C)}% · Derecha ${p(R)}%`:""),click:SITE,tags:["newspaper"]})})}catch{}}}
fresh.forEach(c=>notified.add(c.id));
mkdirSync("site",{recursive:true});cpSync("public","site",{recursive:true});
writeFileSync("site/news.json",JSON.stringify({updated:Date.now(),topic:process.env.NTFY_TOPIC?"":TOPIC,errors:res.filter(r=>r.err).map(r=>({n:r.f.topic||r.f.q.slice(0,25),e:r.err})),notified:[...notified].slice(-500),clusters}));
console.log(clusters.length+" noticias; fallos:",res.filter(r=>r.err).map(r=>r.err).join(", ")||"ninguno");
