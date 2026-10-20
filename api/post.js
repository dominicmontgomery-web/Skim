// Link previews (Discord, Twitter, Slack...). Only link-preview bots are routed here (see vercel.json); people get the normal app.
const fs=require("fs"),path=require("path");
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function cfg(origin){
  let t="";
  try{t=fs.readFileSync(path.join(process.cwd(),"config.js"),"utf8")}catch(e){}
  if(!t){try{t=await(await fetch(origin+"/config.js")).text()}catch(e){}}
  return{url:(t.match(/SUPABASE_URL:\s*"([^"]+)"/)||[])[1],key:(t.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)||[])[1]};
}
module.exports=async(req,res)=>{
  const host=req.headers["x-forwarded-host"]||req.headers.host,origin="https://"+host;
  const {id,u,debug}=req.query,dbg={};
  const pagePath=id?"/post/"+id:"/@"+u;
  let title="Skim",desc="Join the conversation on Skim.",img=origin+"/logo.png",big=false;
  try{
    const {url,key}=await cfg(origin);dbg.hasConfig=!!(url&&key);
    let q=null;
    if(id&&/^[0-9a-f-]{36}$/i.test(id))q=`posts?id=eq.${id}&select=content,images,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)`;
    else if(u&&/^[a-zA-Z0-9_]{3,20}$/.test(u))q=`profiles?username=eq.${u.toLowerCase()}&select=username,display_name,bio,avatar_url`;
    if(q&&url&&key){
      const headers={apikey:key};if(key.startsWith("eyJ"))headers.Authorization="Bearer "+key;
      const r=await fetch(`${url}/rest/v1/${q}`,{headers});dbg.status=r.status;
      const j=await r.json();dbg.rows=Array.isArray(j)?j.length:j;
      const row=Array.isArray(j)&&j[0];
      if(row){
        const a=row.profiles||row;
        title=`${a.display_name} (@${a.username}) on Skim`;
        desc=(id?(row.content||"Shared an image"):(row.bio||"Profile on Skim")).slice(0,200);
        if(id&&row.images&&row.images[0]){img=row.images[0];big=true}else if(a.avatar_url)img=a.avatar_url;
      }
    }
  }catch(e){dbg.error=String(e)}
  if(debug)return res.status(200).json({title,desc,img,dbg});
  const meta=`<meta property="og:site_name" content="Skim"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(origin+pagePath)}"><meta name="theme-color" content="#fffcfc"><meta name="twitter:card" content="${big?"summary_large_image":"summary"}"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`;
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=30, stale-while-revalidate=120");
  res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${meta}</head><body><a href="${esc(origin+pagePath)}">${esc(title)}</a></body></html>`);
};
