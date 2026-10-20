// Serves the Skim app with per-post / per-profile link previews (Discord embeds).
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
module.exports=async(req,res)=>{
  const host=req.headers["x-forwarded-host"]||req.headers.host,origin="https://"+host;
  const {id,u}=req.query;
  const path=id?"/post/"+id:"/@"+u;
  let html=await(await fetch(origin+"/index.html")).text();
  let title="Skim",desc="Join the conversation on Skim.",img=origin+"/logo.png";
  try{
    const cfg=await(await fetch(origin+"/config.js")).text();
    const url=(cfg.match(/SUPABASE_URL:"([^"]+)"/)||[])[1],key=(cfg.match(/SUPABASE_ANON_KEY:"([^"]+)"/)||[])[1];
    let q=null;
    if(id&&/^[0-9a-f-]{36}$/i.test(id))q=`posts?id=eq.${id}&select=content,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)`;
    else if(u&&/^[a-zA-Z0-9_]{3,20}$/.test(u))q=`profiles?username=eq.${u.toLowerCase()}&select=username,display_name,bio,avatar_url`;
    if(q&&url&&key){
      const headers={apikey:key};if(key.startsWith("eyJ"))headers.Authorization="Bearer "+key; // new sb_publishable keys are not JWTs
      const r=await(await fetch(`${url}/rest/v1/${q}`,{headers})).json();
      const row=Array.isArray(r)&&r[0];
      if(row){
        const a=row.profiles||row;
        title=`${a.display_name} (@${a.username}) on Skim`;
        desc=(id?row.content:(row.bio||"Profile on Skim")).slice(0,200);
        if(a.avatar_url)img=a.avatar_url;
      }
    }
  }catch(e){}
  const meta=`<title>${esc(title)}</title><meta property="og:site_name" content="Skim"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(origin+path)}"><meta name="twitter:card" content="summary"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(img)}">`;
  html=html.replace(/<title>.*?<\/title>/,meta);
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=30, stale-while-revalidate=120");
  res.status(200).send(html);
};
