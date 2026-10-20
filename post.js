// Serves the Skim app with per-post / per-profile link previews (so Discord shows a nice embed).
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
module.exports=async(req,res)=>{
  const host=req.headers["x-forwarded-host"]||req.headers.host,origin="https://"+host;
  let html=await(await fetch(origin+"/index.html")).text();
  try{
    const cfg=await(await fetch(origin+"/config.js")).text();
    const url=(cfg.match(/SUPABASE_URL:"([^"]+)"/)||[])[1],key=(cfg.match(/SUPABASE_ANON_KEY:"([^"]+)"/)||[])[1];
    const {id,u}=req.query;let q=null;
    if(id&&/^[0-9a-f-]{36}$/i.test(id))q=`posts?id=eq.${id}&select=content,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)`;
    else if(u&&/^[a-zA-Z0-9_]{3,20}$/.test(u))q=`profiles?username=eq.${u.toLowerCase()}&select=username,display_name,bio,avatar_url`;
    if(q&&url&&key){
      const r=await(await fetch(`${url}/rest/v1/${q}`,{headers:{apikey:key,Authorization:"Bearer "+key}})).json();
      const row=r&&r[0];
      if(row){
        const a=row.profiles||row;
        const title=id?`${a.display_name} (@${a.username}) on Skim`:`${a.display_name} (@${a.username}) | Skim`;
        const desc=(id?row.content:row.bio||"Profile on Skim").slice(0,200);
        const img=a.avatar_url||origin+"/logo.png";
        const meta=`<title>${esc(title)}</title><meta property="og:site_name" content="Skim"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:image" content="${esc(img)}"><meta property="og:url" content="${esc(origin+req.url)}"><meta name="twitter:card" content="summary">`;
        html=html.replace(/<title>.*?<\/title>/,meta);
      }
    }
  }catch(e){}
  res.setHeader("Content-Type","text/html; charset=utf-8");
  res.setHeader("Cache-Control","public, s-maxage=60, stale-while-revalidate=300");
  res.status(200).send(html);
};
