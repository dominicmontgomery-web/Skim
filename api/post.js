// Link previews (Discord, Twitter, Slack...). Only link-preview bots are routed here (see vercel.json); people get the normal app.
const V="v7-no-avatar-image";
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
  let title="Skim",desc="View this on Skim.",imgs=[],avatar=null,when=null,big=false;
  desc="View this page.";
  try{
    const {url,key}=await cfg(origin);dbg.hasConfig=!!(url&&key);
    let q=null;
    if(id&&/^[0-9a-f-]{36}$/i.test(id))q=`posts?id=eq.${id}&select=content,images,created_at,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)`;
    else if(u&&/^[a-zA-Z0-9_]{3,20}$/.test(u))q=`profiles?username=eq.${u.toLowerCase()}&select=username,display_name,bio,avatar_url,created_at`;
    if(q&&url&&key){
      const headers={apikey:key};if(key.startsWith("eyJ"))headers.Authorization="Bearer "+key;
      const r=await fetch(`${url}/rest/v1/${q}`,{headers});dbg.status=r.status;
      const j=await r.json();dbg.rows=Array.isArray(j)?j.length:j;
      const row=Array.isArray(j)&&j[0];
      if(row){
        const a=row.profiles||row;
        title=`${a.display_name} (@${a.username})`;
        desc=(id?(row.content||""):(row.bio||"")).slice(0,700);
        avatar=a.avatar_url;when=row.created_at;
        if(id&&row.images&&row.images.length){imgs=row.images.slice(0,4);big=true}
        if(id){try{const st=await(await fetch(`${url}/rest/v1/post_stats?post_id=eq.${id}&select=like_count,repost_count,reply_count`,{headers})).json();const c=st&&st[0];if(c)desc+=`${desc?"\n\n":""}❤️ ${c.like_count}   🔁 ${c.repost_count}   💬 ${c.reply_count}`}catch(e){}}
      }
    }
  }catch(e){dbg.error=String(e)}
  if(!id&&avatar)imgs.push(avatar);
  if(debug)return res.status(200).json({version:V,title,desc,imgs,dbg});
  const m=(k,v,p)=>`<meta ${p||"property"}="${k}" content="${esc(v)}">`;
  const meta=m("og:site_name","Skim")+m("og:type","article")+m("og:title",title)+m("og:description",desc)+m("og:url",origin+pagePath)+imgs.map(i=>m("og:image",i)).join("")+(when?m("article:published_time",new Date(when).toISOString()):"")+m("theme-color","#1e3a8a","name")+m("twitter:card",big?"summary_large_image":"summary","name")+m("twitter:title",title,"name")+m("twitter:description",desc,"name")+(imgs.length?m("twitter:image",imgs[0],"name"):"")+m("skim-version",V,"name");
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=30, stale-while-revalidate=120");
  res.status(200).send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${meta}</head><body><a href="${esc(origin+pagePath)}">${esc(title)}</a></body></html>`);
};
