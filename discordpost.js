// Sends every new top-level Skim post into a Discord channel as an embed.
// Called by the database (see schema-v32.sql). Needs these Vercel environment variables:
//   SKIM_WEBHOOK_SECRET        any long random text (the same text goes into the SQL setup)
//   SUPABASE_SERVICE_ROLE_KEY  already set for botted comments
//   DISCORD_WEBHOOK_VORASNIA   Discord webhook URL for posts by Vorasnia accounts
//   DISCORD_WEBHOOK_GAUL       Discord webhook URL for posts by Gaul accounts
//   DISCORD_WEBHOOK_URL        (optional) one webhook used for both countries / as a fallback
//   EMOJI_BLUE, EMOJI_GRAY, EMOJI_GOLD   (optional) badge symbols shown after the name
const BADGE = { blue: process.env.EMOJI_BLUE || "", gray: process.env.EMOJI_GRAY || "", gold: process.env.EMOJI_GOLD || "" };
const VID = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const SEC = process.env.SKIM_WEBHOOK_SECRET, SK = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SEC || req.headers["x-skim-secret"] !== SEC) return res.status(401).json({ error: "Not allowed" });
    if (!SK) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY is missing" });
    const id = String((req.body || {}).post_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: "Bad post id" });
    const host = req.headers["x-forwarded-host"] || req.headers.host, origin = "https://" + host;
    const cfg = await (await fetch(origin + "/config.js")).text();
    const url = (cfg.match(/SUPABASE_URL:\s*"([^"]+)"/) || [])[1];
    if (!url) return res.status(500).json({ error: "Could not read config.js" });
    const h = { apikey: SK }; if (SK.startsWith("eyJ")) h.Authorization = "Bearer " + SK;
    const r = await (await fetch(`${url}/rest/v1/posts?id=eq.${id}&select=id,content,images,created_at,reply_to,bot_seq,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url,verified_type,country,is_bot)`, { headers: h })).json();
    const p = Array.isArray(r) && r[0];
    if (!p) return res.status(200).json({ skipped: "post not found" });
    const a = p.profiles || {};
    if (p.reply_to || p.bot_seq || a.is_bot) return res.status(200).json({ skipped: "not a top-level post" });
    const hook = (a.country === "gaul" ? process.env.DISCORD_WEBHOOK_GAUL : process.env.DISCORD_WEBHOOK_VORASNIA) || process.env.DISCORD_WEBHOOK_URL;
    if (!hook) return res.status(200).json({ skipped: "no webhook set for this country" });

    const postUrl = `${origin}/post/${p.id}`, logo = origin + "/logo.png";
    const imgs = (p.images || []).filter(u => !VID.test(u)).slice(0, 4), vid = (p.images || []).find(u => VID.test(u));
    const badge = BADGE[a.verified_type] ? " " + BADGE[a.verified_type] : "";
    const main = {
      author: { name: `${a.display_name} (@${a.username})${badge}`.slice(0, 256), icon_url: a.avatar_url || logo, url: `${origin}/@${a.username}` },
      description: ((p.content || "") + `\n\n[View on Skim](${postUrl})`).slice(0, 4000),
      url: postUrl, color: 0x1e3a8a, footer: { text: "Skim", icon_url: logo }, timestamp: new Date(p.created_at).toISOString()
    };
    if (imgs[0]) main.image = { url: imgs[0] };
    const embeds = [main, ...imgs.slice(1).map(u => ({ url: postUrl, image: { url: u } }))];   // same url = Discord shows them as one gallery
    const body = { username: "Skim", avatar_url: logo, allowed_mentions: { parse: [] }, embeds };
    if (vid) body.content = vid;                                                                // a plain link makes Discord show a video player
    const dr = await fetch(hook + (hook.includes("?") ? "&" : "?") + "wait=false", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!dr.ok) return res.status(502).json({ error: "Discord said " + dr.status, detail: (await dr.text()).slice(0, 200) });
    return res.status(200).json({ sent: true });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
