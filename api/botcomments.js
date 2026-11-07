// Admin-only: writes realistic replies to ONE post with Claude, each from a different made-up account (with a profile picture).
// Needs two secrets in Vercel -> Settings -> Environment Variables:  ANTHROPIC_API_KEY  and  SUPABASE_SERVICE_ROLE_KEY
const crypto = require("crypto");
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const GMODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const STYLES = ["avataaars", "lorelei", "micah", "personas", "adventurer", "big-smile", "notionists", "open-peeps"];
const MOODS = {
  mixed: "a realistic mix: roughly 40% supportive, 25% critical, 20% jokes or irony, 15% neutral questions or observations",
  supportive: "mostly supportive (about 70%), with a few critical or neutral replies",
  critical: "mostly critical, angry or skeptical (about 65%), with some supporters and a few jokes",
  funny: "mostly jokes, memes and sarcasm (about 60%), with some real opinions mixed in"
};
const J = (res, code, obj) => res.status(code).json(obj);
async function cfg(origin) {
  let t = "";
  try { t = await (await fetch(origin + "/config.js")).text(); } catch (e) {}
  return { url: (t.match(/SUPABASE_URL:\s*"([^"]+)"/) || [])[1], anon: (t.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/) || [])[1] };
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return J(res, 405, { error: "POST only" });
  try {
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const { url, anon } = await cfg("https://" + host);
    const SK = process.env.SUPABASE_SERVICE_ROLE_KEY, AK = process.env.ANTHROPIC_API_KEY, GK = process.env.GEMINI_API_KEY;
    if (!SK || !(AK || GK)) return J(res, 500, { error: "Not set up yet: add SUPABASE_SERVICE_ROLE_KEY and either GEMINI_API_KEY (free) or ANTHROPIC_API_KEY in Vercel > Settings > Environment Variables, then redeploy." });
    if (!url || !anon) return J(res, 500, { error: "Could not read config.js" });
    const token = (req.headers.authorization || "").replace(/^Bearer /, "");
    const adm = await fetch(`${url}/rest/v1/rpc/is_admin`, { method: "POST", headers: { apikey: anon, Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" }).then(r => r.json()).catch(() => false);
    if (adm !== true) return J(res, 403, { error: "Admins only." });

    const { post_id, count, total, mood } = req.body || {};
    if (!/^[0-9a-f-]{36}$/i.test(String(post_id))) return J(res, 400, { error: "Bad post id" });
    const n = Math.max(1, Math.min(5, parseInt(count, 10) || 5)), T0 = Math.max(1, Math.min(80, parseInt(total, 10) || n));
    const sh = { apikey: SK, "Content-Type": "application/json" };
    if (SK.startsWith("eyJ")) sh.Authorization = "Bearer " + SK;
    const rest = (p, o = {}) => fetch(`${url}/rest/v1/${p}`, { ...o, headers: { ...sh, ...(o.headers || {}) } });

    const pr = await (await rest(`posts?id=eq.${post_id}&select=id,content,images,profiles:profiles!posts_author_id_fkey(username,display_name,bio,verified_type)`)).json();
    const post = Array.isArray(pr) && pr[0];
    if (!post) return J(res, 404, { error: "Post not found" });
    const ex = await (await rest(`posts?reply_to=eq.${post_id}&bot_seq=not.is.null&select=content,bot_seq&order=bot_seq.desc&limit=60`)).json();
    const maxSeq = Array.isArray(ex) && ex.length ? ex[0].bot_seq : 0;
    const author = post.profiles || {};

    const prompt = `Post by ${author.display_name} (@${author.username})${author.bio ? ", bio: " + author.bio : ""}${author.verified_type ? " (a verified public account)" : ""}:
"""
${post.content || "(no text)"}
"""
${post.images && post.images.length ? "The post also has an attached image or GIF that you cannot see; do not describe it.\n" : ""}
Write ${n} replies from ${n} DIFFERENT fictional users reacting to THIS post. Each reply must genuinely respond to what the post actually says: pick up its specific points, names, policies, numbers or hashtags, sometimes address the author directly, and sometimes push back on what other commenters would say. Overall mood: ${MOODS[mood] || MOODS.mixed}.
Make them read like real social media comments: mostly 3 to 30 words, a few longer (up to about 250 characters), casual grammar, an occasional typo or all-lowercase, emoji only sparingly, no hashtag spam. Never mention being a bot or an AI. No slurs, harassment or threats.
Each user needs: a unique, believable display name (vary the style: full names, first name plus initial, nicknames, job titles, regional names that fit a fictional European-style setting), a handle (lowercase letters, digits and underscores only, 4 to 16 characters), and a short one-line bio (may be empty).
${ex.length ? "Do not repeat the wording of these existing replies: " + JSON.stringify(ex.slice(0, 15).map(e => e.content)) + "\n" : ""}Return ONLY a JSON array of exactly ${n} objects: [{"name":"","handle":"","bio":"","text":""}]`;

    const SYS = "You write realistic social media replies for a fictional political roleplay world (countries such as Vorasnia and Gaul). Every person and place is fictional. Output only valid JSON.";
    let txt = "";
    if (AK) {
      const ar = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": AK, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1800, system: SYS, messages: [{ role: "user", content: prompt }] })
      });
      const aj = await ar.json();
      if (!ar.ok) return J(res, 502, { error: "AI error: " + ((aj.error && aj.error.message) || ar.status) });
      txt = (aj.content || []).map(b => b.text || "").join("");
    } else {
      const gr = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent?key=${GK}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 1, maxOutputTokens: 2000, responseMimeType: "application/json" } })
      });
      const gj = await gr.json();
      if (!gr.ok) return J(res, 502, { error: "AI error: " + ((gj.error && gj.error.message) || gr.status) });
      txt = (((gj.candidates || [])[0] || {}).content || {}).parts ? gj.candidates[0].content.parts.map(x => x.text || "").join("") : "";
    }
    let arr;
    try { arr = JSON.parse(txt.slice(txt.indexOf("["), txt.lastIndexOf("]") + 1)); } catch (e) { return J(res, 502, { error: "The AI reply could not be read. Try again." }); }
    arr = (Array.isArray(arr) ? arr : []).filter(x => x && typeof x.text === "string" && x.text.trim()).slice(0, n);
    if (!arr.length) return J(res, 502, { error: "No comments were produced. Try again." });

    // unique handles
    const clean = h => String(h || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16);
    const used = new Set();
    let handles = arr.map((x, i) => { let h = clean(x.handle); if (h.length < 4) h = clean(x.name).slice(0, 12) || "user" + crypto.randomInt(1000, 9999); return h; });
    let taken = new Set();
    const q = await (await rest(`profiles?username=in.(${handles.join(",")})&select=username`)).json();
    if (Array.isArray(q)) q.forEach(r => taken.add(r.username));
    handles = handles.map(h => { let u = h; while (used.has(u) || taken.has(u)) u = (h.slice(0, 16) + crypto.randomInt(10, 999)).slice(0, 20); used.add(u); return u; });

    const now = Date.now();
    const profiles = arr.map((x, i) => ({
      id: crypto.randomUUID(), owner_id: null, username: handles[i],
      display_name: String(x.name || handles[i]).replace(/[\u0000-\u001f]/g, "").slice(0, 50) || handles[i],
      bio: String(x.bio || "").slice(0, 160),
      avatar_url: `https://api.dicebear.com/9.x/${STYLES[crypto.randomInt(0, STYLES.length)]}/svg?seed=${encodeURIComponent(handles[i] + crypto.randomInt(0, 99999))}`,
      is_bot: true, created_at: new Date(now - crypto.randomInt(20, 500) * 864e5).toISOString()
    }));
    let r1 = await rest("profiles", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(profiles) });
    if (!r1.ok) return J(res, 500, { error: "Could not create accounts: " + (await r1.text()).slice(0, 200) });

    const T = Math.max(T0 + maxSeq, 1);
    const rows = arr.map((x, i) => {
      const seq = maxSeq + 1 + i, m = 3 * (Math.exp(5.5 * Math.min(seq, T) / T) - 1);
      return { author_id: profiles[i].id, content: String(x.text).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 500), reply_to: post_id, created_at: new Date(now + m * 60000).toISOString(), bot_seq: seq };
    });
    const r2 = await rest("posts", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(rows) });
    if (!r2.ok) return J(res, 500, { error: "Could not save comments: " + (await r2.text()).slice(0, 200) });
    await rest("bot_posts?on_conflict=post_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ post_id, target: T, generated: maxSeq + rows.length, mood: MOODS[mood] ? mood : "mixed", updated_at: new Date().toISOString() }) });
    return J(res, 200, { created: rows.length });
  } catch (e) {
    return J(res, 500, { error: String(e && e.message || e) });
  }
};
