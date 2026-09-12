/* ---------- Shared blog-post loading ----------
   Each post is a `<slug>.md` file with a small frontmatter block at the
   top:

     ---
     title: Post Title
     description: One-line description shown under the title
     date: 2026-09-12
     show: true
     ---

     The rest of the file is the post body, in normal markdown.

   `show: true` is required for a post to appear in the blog list on
   index.html. Anything else (false, or the line left out entirely) is
   treated as a draft: it's skipped in the list but still reachable
   directly via blog.html?post=<slug> if you know the link.

   Optional: `external: https://...` — for a post that actually lives
   elsewhere. The list links straight out to that URL in a new tab
   instead of opening it through blog.html; the .md file can be a bare
   frontmatter stub in that case, since its body is never rendered.

   ---------- Where the .md files come from ----------
   BLOG_SOURCE.type controls discovery:

   - 'github' (default below): posts live in a separate GitHub repo,
     directly at the repo root — no subfolder required (path: ''). Every
     push there shows up here automatically — nothing to edit on this
     site when you publish a new post. Uses the GitHub Contents API
     (github.com REST docs: repos/contents), which lists a folder's
     files as JSON and is CORS-enabled, so it can be called straight
     from the browser. No auth needed for a public repo.
     A non-post file at the root (a README, say) doesn't need filtering
     out: without the frontmatter block it has no `show: true`, so
     loadPublishedPosts() just drops it like any other draft.
     Trade-off: 60 unauthenticated requests/hour *per visitor's IP* —
     one listing call per pageview, so this is a non-issue at portfolio
     traffic. Reflects the repo's current state with no extra caching
     lag beyond GitHub's own (~1 min).

   - 'local': posts live as sibling .md files right next to this script,
     and posts-manifest.json is a flat array of their filenames — the
     one thing you still add a line to by hand when publishing, since a
     static host can't be asked "what files are in this folder".

   Swap BLOG_SOURCE.type to switch between them; nothing else in this
   file or in index.html/blog.html needs to change either way. */

const BLOG_SOURCE = {
  type: 'github', // 'github' | 'local'
  github: {
    owner: '2102ankit',
    repo: 'blogs',
    branch: 'main',
    path: '' // '' = repo root; set to e.g. 'posts' if you'd rather use a subfolder
  },
  // local: {
  //   manifest: 'posts-manifest.json'
  // }
};

function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!match) return { data: {}, content: raw };
  const data = {};
  match[1].split(/\r?\n/).forEach(function (line) {
    const i = line.indexOf(':');
    if (i === -1) return;
    const key = line.slice(0, i).trim();
    let value = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    data[key] = value;
  });
  return { data: data, content: raw.slice(match[0].length) };
}

/* Returns a normalized list of { name, url } for every .md file found,
   regardless of source — 'name' is the filename (used to derive the
   slug), 'url' is wherever its raw content can be fetched from. */
async function discoverPostFiles() {
  if (BLOG_SOURCE.type === 'github') {
    const g = BLOG_SOURCE.github;
    const pathSegment = g.path ? `/${g.path}` : '';
    const api = `https://api.github.com/repos/${g.owner}/${g.repo}/contents${pathSegment}?ref=${g.branch}`;
    try {
      const res = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
      if (!res.ok) {
        console.warn('GitHub contents API returned', res.status, '— check owner/repo/path/branch in BLOG_SOURCE.');
        return [];
      }
      const items = await res.json();
      if (!Array.isArray(items)) return [];
      return items
        .filter(function (item) { return item.type === 'file' && /\.md$/i.test(item.name); })
        .map(function (item) { return { name: item.name, url: item.download_url }; });
    } catch (e) {
      console.warn('Could not reach GitHub contents API:', e);
      return [];
    }
  }

  // 'local' fallback
  try {
    const res = await fetch(BLOG_SOURCE.local.manifest);
    if (!res.ok) return [];
    const files = await res.json();
    return Array.isArray(files) ? files.map(function (name) { return { name: name, url: name }; }) : [];
  } catch (e) {
    return [];
  }
}

async function loadPostFile(fileRef) {
  const slug = fileRef.name.replace(/\.md$/i, '');
  const res = await fetch(fileRef.url);
  if (!res.ok) throw new Error("Couldn't load " + fileRef.name);
  const raw = await res.text();
  const parsed = parseFrontmatter(raw);
  const data = parsed.data;
  return {
    slug: slug,
    title: data.title || slug,
    description: data.description || '',
    date: data.date || '1970-01-01',
    show: data.show === true,
    external: data.external || null,
    content: parsed.content
  };
}

/* Every post with show:true, newest first — what the blog list on
   index.html renders. A post that fails to load (missing file, bad
   frontmatter) is dropped rather than breaking the whole list. */
async function loadPublishedPosts() {
  const files = await discoverPostFiles();
  const posts = await Promise.all(files.map(function (f) {
    return loadPostFile(f).catch(function () { return null; });
  }));
  return posts
    .filter(function (p) { return p && p.show; })
    .sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}

/* A single post by slug, regardless of its show flag, so a direct link
   to a draft still works even though it's hidden from the list. */
async function loadPostBySlug(slug) {
  const files = await discoverPostFiles();
  const match = files.find(function (f) { return f.name.replace(/\.md$/i, '') === slug; });
  if (!match) throw new Error('not found');
  return loadPostFile(match);
}
