const fs = require("fs");
const path = require("path");

const esc = s =>
  String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));

async function cfg(origin) {
  let t = "";

  try {
    t = fs.readFileSync(path.join(process.cwd(), "config.js"), "utf8");
  } catch {}

  if (!t) {
    try {
      t = await (await fetch(origin + "/config.js")).text();
    } catch {}
  }

  return {
    url: (t.match(/SUPABASE_URL:\s*"([^"]+)"/) || [])[1],
    key: (t.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/) || [])[1]
  };
}

module.exports = async (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = "https://" + host;
  const { id, u, debug } = req.query;

  const pagePath = id ? "/post/" + id : "/@" + (u || "");
  const pageUrl = origin + pagePath;

  let title = "Skim";
  let desc = "A place for your community to connect.";
  let img = origin + "/logo.png";
  let big = false;
  let authorName = "Skim";
  let authorAvatar = "";
  const dbg = {};

  try {
    const { url, key } = await cfg(origin);
    dbg.hasConfig = !!(url && key);

    let query = "";

    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      query =
        "posts?id=eq." + encodeURIComponent(id) +
        "&select=content,images,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)";
    } else if (u && /^[a-zA-Z0-9_]{3,20}$/.test(u)) {
      query =
        "profiles?username=eq." + encodeURIComponent(u.toLowerCase()) +
        "&select=username,display_name,bio,avatar_url";
    }

    if (query && url && key) {
      const headers = { apikey: key };

      if (key.startsWith("eyJ")) {
        headers.Authorization = "Bearer " + key;
      }

      const response = await fetch(
        `${url}/rest/v1/${query}`,
        { headers }
      );

      dbg.status = response.status;
      const data = await response.json();
      const row = Array.isArray(data) ? data[0] : null;

      dbg.rows = Array.isArray(data) ? data.length : 0;

      if (row) {
        const account = row.profiles || row;

        authorName =
          account.display_name ||
          account.username ||
          "Skim user";

        authorAvatar = account.avatar_url || "";

        if (id) {
          title = `${authorName} (@${account.username || "user"})`;
          desc = row.content || "Shared a photo on Skim.";

          if (Array.isArray(row.images) && row.images[0]) {
            img = row.images[0];
            big = true;
          } else if (authorAvatar) {
            img = authorAvatar;
          }
        } else {
          title = `${authorName} (@${account.username || "user"})`;
          desc = row.bio || `View ${authorName}'s profile on Skim.`;

          if (authorAvatar) img = authorAvatar;
        }
      }
    }
  } catch (error) {
    dbg.error = String(error);
  }

  // Discord and other link-preview crawlers use these tags.
  // The page image remains the post image when one is attached.
  const metadata = `
    <meta property="og:site_name" content="Skim">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(desc.slice(0, 300))}">
    <meta property="og:image" content="${esc(img)}">
    <meta property="og:url" content="${esc(pageUrl)}">
    <meta name="theme-color" content="#24212d">

    <meta name="twitter:card"
      content="${big ? "summary_large_image" : "summary"}">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(desc.slice(0, 300))}">
    <meta name="twitter:image" content="${esc(img)}">
  `;

  if (debug === "1") {
    return res.status(200).json({
      title, desc, img, authorName, authorAvatar, dbg
    });
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=30, stale-while-revalidate=120"
  );

  return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Skim</title>
  ${metadata}
</head>
<body>
  <main>
    <a href="${esc(pageUrl)}">${esc(title)}</a>
    <p>${esc(desc)}</p>
  </main>
</body>
</html>`);
};
