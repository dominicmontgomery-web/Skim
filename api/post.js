
const fs = require("fs");
const path = require("path");

const esc = value =>
  String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));

async function getConfig(origin) {
  let source = "";

  try {
    source = fs.readFileSync(
      path.join(process.cwd(), "config.js"), "utf8"
    );
  } catch {}

  if (!source) {
    try {
      const response = await fetch(origin + "/config.js");
      source = await response.text();
    } catch {}
  }

  return {
    url: (source.match(/SUPABASE_URL:\s*"([^"]+)"/) || [])[1],
    key: (source.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/) || [])[1]
  };
}

module.exports = async (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const origin = "https://" + host;
  const { id, u, debug } = req.query;
  const pagePath = id ? "/post/" + id : "/@" + (u || "");
  const pageUrl = origin + pagePath;

  let title = "Skim — Made for your community";
  let description = "Join the conversation on Skim.";
  let image = origin + "/logo.png";
  let authorIcon = "";
  let isLarge = false;

  try {
    const { url, key } = await getConfig(origin);

    let query = "";

    if (id && /^[0-9a-f-]{36}$/i.test(id)) {
      query = "posts?id=eq." + encodeURIComponent(id) +
        "&select=content,images,profiles:profiles!posts_author_id_fkey(username,display_name,avatar_url)";
    } else if (u && /^[a-zA-Z0-9_]{3,20}$/.test(u)) {
      query = "profiles?username=eq." + encodeURIComponent(u.toLowerCase()) +
        "&select=username,display_name,bio,avatar_url";
    }

    if (url && key && query) {
      const headers = { apikey: key };

      if (key.startsWith("eyJ")) {
        headers.Authorization = "Bearer " + key;
      }

      const response = await fetch(
        `${url}/rest/v1/${query}`, { headers }
      );

      if (response.ok) {
        const rows = await response.json();
        const row = rows[0];

        if (row) {
          const account = row.profiles || row;
          const name = account.display_name || account.username || "Skim user";
          const username = account.username || "user";
          authorIcon = account.avatar_url || "";

          title = `${name} (@${username})`;

          if (id) {
            description = row.content || "Shared a photo on Skim.";

            if (Array.isArray(row.images) && row.images[0]) {
              image = row.images[0];
              isLarge = true;
            } else if (authorIcon) {
              image = authorIcon;
            }
          } else {
            description = row.bio || `Discover @${username} on Skim.`;
            if (authorIcon) image = authorIcon;
          }
        }
      }
    }
  } catch (error) {
    console.error("Skim preview error:", error);
  }

  if (debug === "1") {
    return res.status(200).json({
      title, description, image, authorIcon, pageUrl
    });
  }

  const meta = `
    <meta property="og:site_name" content="Skim">
    <meta property="og:type" content="website">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description.slice(0, 300))}">
    <meta property="og:image" content="${esc(image)}">
    <meta property="og:url" content="${esc(pageUrl)}">
    <meta name="theme-color" content="#ffffff">
    <meta name="twitter:card" content="${isLarge ? "summary_large_image" : "summary"}">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description.slice(0, 300))}">
    <meta name="twitter:image" content="${esc(image)}">
  `;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=120");

  return res.status(200).send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title)} · Skim</title>
${meta}
</head>
<body>
<a href="${esc(pageUrl)}">${esc(title)}</a>
<p>${esc(description)}</p>
</body>
</html>`);
};
