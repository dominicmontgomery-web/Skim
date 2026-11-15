// ============================================================
// api/discordpost.js  —  Vercel serverless function
// hm
// Flow:
//   1. User posts in Skim
//   2. Supabase trigger fires on posts INSERT
//   3. Trigger calls net.http_post to THIS endpoint
//      with header x-skim-secret and body { post_id }
//   4. This function fetches the post + author from Supabase
//   5. Forwards to the right Discord webhook based on country
//
// Required Vercel env vars (Settings → Environment Variables):
//   SKIM_WEBHOOK_SECRET          — same text as in discord_settings.secret
//   SUPABASE_URL                 — https://YOURPROJECT.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    — service role key (preferred) OR
//   SUPABASE_ANON_KEY            — anon key (fallback)
//   DISCORD_WEBHOOK_VORASNIA     — Vorasnia channel webhook URL
//   DISCORD_WEBHOOK_GAUL         — Gaul channel webhook URL
//   DISCORD_WEBHOOK_USA          — USA channel webhook URL
//   SITE_URL (optional)          — https://yoursite.vercel.app
//
// If DISCORD_WEBHOOK_URL is set, ALL posts go there (overrides country routing).
//
// File path in your repo:  api/discordpost.js
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---- 1. Verify secret ----
  const secret = req.headers['x-skim-secret'];
  const expectedSecret = process.env.SKIM_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    console.error('[discordpost] secret mismatch:', {
      received: secret ? '[set]' : '[missing]',
      expected: expectedSecret ? '[set]' : '[not set]',
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // ---- 2. Parse body ----
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { post_id } = body;
  if (!post_id) {
    return res.status(400).json({ error: 'Missing post_id' });
  }

  // ---- 3. Supabase credentials ----
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error('[discordpost] missing Supabase env vars');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const siteUrl = (process.env.SITE_URL || `https://${req.headers.host || 'yoursite.vercel.app'}`).replace(/\/$/, '');

  try {
    // ---- 4. Fetch the post + author profile ----
    const select = 'id,content,images,created_at,author_id,profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,verified_type,country)';
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/posts?id=eq.${encodeURIComponent(post_id)}&select=${encodeURIComponent(select)}`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[discordpost] Supabase fetch failed:', resp.status, text);
      return res.status(502).json({ error: 'Failed to fetch post', detail: text });
    }

    const rows = await resp.json();
    const post = rows[0];
    if (!post) {
      console.error('[discordpost] post not found:', post_id);
      return res.status(404).json({ error: 'Post not found' });
    }

    const author = post.profiles || {};
    const country = author.country || 'vorasnia';

    // ---- 5. Pick webhook(s) ----
    const globalWebhook = process.env.DISCORD_WEBHOOK_URL;
    const countryWebhook =
      country === 'gaul'  ? process.env.DISCORD_WEBHOOK_GAUL  :
      country === 'usa'   ? process.env.DISCORD_WEBHOOK_USA   :
                            process.env.DISCORD_WEBHOOK_VORASNIA;

    const webhooks = [];
    if (globalWebhook)      webhooks.push(globalWebhook);
    else if (countryWebhook) webhooks.push(countryWebhook);

    if (webhooks.length === 0) {
      console.log('[discordpost] no webhook configured for country:', country);
      return res.status(200).json({ ok: true, message: 'No webhook configured', country });
    }

    // ---- 6. Build Discord payload ----
    const isVid = u => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u || '');
    const content  = (post.content || '').slice(0, 2000); // Discord embed description cap
    const images   = (post.images || []).filter(u => !isVid(u));

    const authorName = author.display_name || author.username || 'Unknown';
    const profileUrl = `${siteUrl}/@${author.username || ''}`;
    const avatarUrl   = author.avatar_url || undefined;

    const embed = {
      author: {
        name: authorName,
        url: profileUrl,
        ...(avatarUrl ? { icon_url: avatarUrl } : {}),
      },
      description: content,
      timestamp: post.created_at,
      footer: {
        text: 'Skim',
        icon_url: `${siteUrl}/logo.png`,
      },
    };

    if (images.length > 0) {
      embed.image = { url: images[0] };
    }

    const payload = {
      username: 'Skim',
      avatar_url: `${siteUrl}/logo.png`,
      embeds: [embed],
    };

    // Add up to 3 more images as separate embeds (Discord max 10 per message)
    for (let i = 1; i < Math.min(images.length, 4); i++) {
      payload.embeds.push({ image: { url: images[i] } });
    }

    // ---- 7. Send to Discord ----
    const results = await Promise.all(webhooks.map(async (url) => {
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const errText = r.ok ? '' : await r.text().catch(() => '');
        return { ok: r.ok, status: r.status, error: errText };
      } catch (e) {
        return { ok: false, status: 0, error: e.message };
      }
    }));

    const allOk = results.every(r => r.ok);
    console.log('[discordpost] sent:', { post_id, country, results });
    return res.status(allOk ? 200 : 502).json({ ok: allOk, country, results });
  } catch (err) {
    console.error('[discordpost] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
