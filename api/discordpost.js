// ============================================================
// api/discordpost.js  —  Vercel serverless function
// Discord embed layout:
//
//   Dominic Montgomery<:badge:>        [avatar thumbnail]
//   @username · 1,234 Followers
//   Post content here...
//   [post image if any]
//   ❤️ 42   👀 130
//
// The name + badge are in the TITLE field (bold, clickable,
// and supports custom emoji — unlike author.name).
// The badge emoji sits right after the name with no gap.
// Avatar goes to the thumbnail slot on the right.
//
// Required Vercel env vars:
//   SKIM_WEBHOOK_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY)
//   DISCORD_WEBHOOK_VORASNIA / GAUL / USA (or DISCORD_WEBHOOK_URL for all)
//   SITE_URL (optional)
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ---- 1. Verify secret ----
  const secret = req.headers['x-skim-secret'];
  const expectedSecret = process.env.SKIM_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    console.error('[discordpost] secret mismatch');
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
  const sbHeaders = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    // ---- 4. Fetch the post + author profile ----
    const select = 'id,content,images,created_at,author_id,profiles:profiles!posts_author_id_fkey(id,username,display_name,avatar_url,verified_type,country)';
    const resp = await fetch(
      `${supabaseUrl}/rest/v1/posts?id=eq.${encodeURIComponent(post_id)}&select=${encodeURIComponent(select)}`,
      { headers: sbHeaders }
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
    const authorId = author.id;
    const country = author.country || 'vorasnia';

    // ---- 5. Fetch author's follower count + THIS post's likes/views ----
    let followers = 0, likeCount = 0, viewCount = 0;
    if (authorId) {
      const statsResp = await fetch(
        `${supabaseUrl}/rest/v1/profile_stats?id=eq.${encodeURIComponent(authorId)}&select=followers&limit=1`,
        { headers: sbHeaders }
      );
      try {
        const statsData = await statsResp.json();
        if (Array.isArray(statsData) && statsData[0]) followers = statsData[0].followers || 0;
      } catch (e) {}
    }

    const postStatsResp = await fetch(
      `${supabaseUrl}/rest/v1/post_stats?post_id=eq.${encodeURIComponent(post_id)}&select=like_count,views&limit=1`,
      { headers: sbHeaders }
    );
    try {
      const psData = await postStatsResp.json();
      if (Array.isArray(psData) && psData[0]) {
        likeCount = Number(psData[0].like_count) || 0;
        viewCount = Number(psData[0].views) || 0;
      }
    } catch (e) {}

    // ---- 6. Pick webhook(s) ----
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

    // ---- 7. Build Discord embed ----
    const isVid = u => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u || '');
    const content = (post.content || '').slice(0, 1800);
    const images = (post.images || []).filter(u => !isVid(u));

    // Custom emoji — NO leading space so the badge sits right against the name
    const badgeEmoji =
      author.verified_type === 'blue'  ? '<:Blueverificationbadge:1568692966724341983>' :
      author.verified_type === 'gray'  ? '<:governmentbadge:1568591410876260453>' :
      author.verified_type === 'gold'  ? '<:goldverificationbadge:1568693021564739755>' :
      '';

    // Embed color based on badge type
    const embedColor =
      author.verified_type === 'gray'  ? 0x829AAB :
      author.verified_type === 'gold'  ? 0xE2B719 :
      author.verified_type === 'blue'  ? 0x1D9BF0 :
      0x1D9BF0;

    const authorName = author.display_name || author.username || 'Unknown';
    const handleLine = `@${author.username || ''} · ${Number(followers).toLocaleString()} Followers`;
    const footerLine = `❤️ ${Number(likeCount).toLocaleString()}   👀 ${Number(viewCount).toLocaleString()}`;

    const embed = {
      // Title supports custom emoji (author.name does not)
      // Name + badge sit on the same line, badge right after name, no gap
      title: `${authorName}${badgeEmoji}`,
      url: `${siteUrl}/@${author.username || ''}`,
      description: `${handleLine}\n\n${content}`,
      timestamp: post.created_at,
      footer: {
        text: footerLine,
        icon_url: `${siteUrl}/logo.png`,
      },
      color: embedColor,
    };

    // Avatar as thumbnail (right side of the embed)
    if (author.avatar_url) {
      embed.thumbnail = { url: author.avatar_url };
    }

    // First image from the post (large, below content)
    if (images.length > 0) {
      embed.image = { url: images[0] };
    }

    const payload = {
      username: 'Skim',
      avatar_url: `${siteUrl}/logo.png`,
      embeds: [embed],
    };

    // Add up to 3 more images as separate embeds
    for (let i = 1; i < Math.min(images.length, 4); i++) {
      payload.embeds.push({ image: { url: images[i] } });
    }

    // ---- 8. Send to Discord ----
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
    console.log('[discordpost] sent:', { post_id, country, followers, likeCount, viewCount, badge: author.verified_type, results });
    return res.status(allOk ? 200 : 502).json({ ok: allOk, country, results });
  } catch (err) {
    console.error('[discordpost] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
