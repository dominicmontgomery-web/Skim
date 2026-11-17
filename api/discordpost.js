// ============================================================
// discordpost.js  —  Updated with account-specific channel routing
//
// New env vars to add in Vercel:
//   DISCORD_WEBHOOK_PM_RESIDENCE  — PM's residence channel webhook URL
//   DISCORD_WEBHOOK_GOVERNMENT    — Government channel webhook URL
//
// The API now:
//   1. Sends to the country webhook (as before)
//   2. ALSO sends to any channels assigned to the author
//      via the account_webhooks table
// ============================================================

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.headers['x-skim-secret'];
  const expectedSecret = process.env.SKIM_WEBHOOK_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    console.error('[discordpost] secret mismatch');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const { post_id } = body;
  if (!post_id) {
    return res.status(400).json({ error: 'Missing post_id' });
  }

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
    // ---- Fetch the post + author profile ----
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

    // ---- Fetch followers + post stats + ASSIGNED CHANNELS ----
    let followers = 0, likeCount = 0, viewCount = 0;
    let assignedChannels = [];

    if (authorId) {
      const [statsResp, postStatsResp, channelsResp] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/profile_stats?id=eq.${encodeURIComponent(authorId)}&select=followers&limit=1`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/post_stats?post_id=eq.${encodeURIComponent(post_id)}&select=like_count,views&limit=1`, { headers: sbHeaders }),
        fetch(`${supabaseUrl}/rest/v1/account_webhooks?profile_id=eq.${encodeURIComponent(authorId)}&select=channel_key`, { headers: sbHeaders }),
      ]);

      try {
        const statsData = await statsResp.json();
        if (Array.isArray(statsData) && statsData[0]) followers = statsData[0].followers || 0;
      } catch (e) {}

      try {
        const psData = await postStatsResp.json();
        if (Array.isArray(psData) && psData[0]) {
          likeCount = Number(psData[0].like_count) || 0;
          viewCount = Number(psData[0].views) || 0;
        }
      } catch (e) {}

      try {
        const chData = await channelsResp.json();
        if (Array.isArray(chData)) {
          assignedChannels = chData.map(c => c.channel_key);
        }
      } catch (e) {}
    }

    // ---- Build webhook list: country routing + assigned channels ----
    const webhooks = [];

    // 1. Country routing (as before)
    const globalWebhook = process.env.DISCORD_WEBHOOK_URL;
    const countryWebhook =
      country === 'gaul'  ? process.env.DISCORD_WEBHOOK_GAUL  :
      country === 'usa'   ? process.env.DISCORD_WEBHOOK_USA   :
                            process.env.DISCORD_WEBHOOK_VORASNIA;
    if (globalWebhook)      webhooks.push(globalWebhook);
    else if (countryWebhook) webhooks.push(countryWebhook);

    // 2. Account-specific channels (from account_webhooks table)
    for (const key of assignedChannels) {
      const envVar = `DISCORD_WEBHOOK_${key.toUpperCase()}`;
      const url = process.env[envVar];
      if (url) {
        // Avoid duplicates (if the same URL is already in the list)
        if (!webhooks.includes(url)) {
          webhooks.push(url);
        }
      } else {
        console.warn(`[discordpost] channel "${key}" assigned but env var ${envVar} not set`);
      }
    }

    if (webhooks.length === 0) {
      console.log('[discordpost] no webhook configured for country:', country, 'or assigned channels:', assignedChannels);
      return res.status(200).json({ ok: true, message: 'No webhook configured', country, assignedChannels });
    }

    // ---- Build Discord embed ----
    const isVid = u => /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i.test(u || '');
    const content = (post.content || '').slice(0, 1800);
    const images = (post.images || []).filter(u => !isVid(u));

    const badgeEmojiId =
      author.verified_type === 'blue'  ? '1568692966724341983' :
      author.verified_type === 'gray'  ? '1568591410876260453' :
      author.verified_type === 'gold'  ? '1568693021564739755' : null;
    const badgeCdnUrl = badgeEmojiId ? `https://cdn.discordapp.com/emojis/${badgeEmojiId}.png` : null;

    const embedColor =
      author.verified_type === 'gray'  ? 0x829AAB :
      author.verified_type === 'gold'  ? 0xE2B719 :
      author.verified_type === 'blue'  ? 0x1D9BF0 :
      0x1D9BF0;

    const fmtCount = n => {
      n = Number(n) || 0;
      if (n < 1000) return String(n);
      if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
      if (n < 1000000) return Math.floor(n / 1000) + 'k';
      if (n < 10000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
      return Math.floor(n / 1000000) + 'M';
    };

    const authorName = author.display_name || author.username || 'Unknown';
    const handleLine = `@${author.username || ''} · ${fmtCount(followers)} Followers`;
    const footerLine = `❤️ ${fmtCount(likeCount)}   👀 ${fmtCount(viewCount)}`;

    const embed = {
      author: {
        name: authorName,
        url: `${siteUrl}/@${author.username || ''}`,
        ...(badgeCdnUrl
          ? { icon_url: badgeCdnUrl }
          : author.avatar_url ? { icon_url: author.avatar_url } : {}),
      },
      description: `${handleLine}\n\n${content}\n\u200B`,
      timestamp: post.created_at,
      footer: {
        text: footerLine,
        icon_url: `${siteUrl}/logo.png`,
      },
      color: embedColor,
    };

    if (badgeCdnUrl && author.avatar_url) {
      embed.thumbnail = { url: author.avatar_url };
    }

    if (images.length > 0) {
      embed.image = { url: images[0] };
    }

    const payload = {
      username: 'Skim',
      avatar_url: `${siteUrl}/logo.png`,
      embeds: [embed],
    };

    for (let i = 1; i < Math.min(images.length, 4); i++) {
      payload.embeds.push({ image: { url: images[i] } });
    }

    // ---- Send to ALL webhooks (country + assigned) ----
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
    console.log('[discordpost] sent:', { post_id, country, assignedChannels, webhookCount: webhooks.length, results });
    return res.status(allOk ? 200 : 502).json({ ok: allOk, country, assignedChannels, results });
  } catch (err) {
    console.error('[discordpost] error:', err);
    return res.status(500).json({ error: err.message });
  }
}
