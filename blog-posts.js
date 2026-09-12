
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

async function discoverPostFiles() {
  try {
    const res = await fetch("posts-manifest.json");
    if (!res.ok) {
      console.warn('posts-manifest.json missing or failed:', res.status);
      return [];
    }
    const files = await res.json();
    return Array.isArray(files)
      ? files.map(function (name) { return { name: name, url: name }; })
      : [];
  } catch (e) {
    console.warn('discoverPostFiles failed:', e);
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

async function loadPublishedPosts() {
  const files = await discoverPostFiles();
  const posts = await Promise.all(files.map(function (f) {
    return loadPostFile(f).catch(function (e) {
      console.warn('Failed to load post', f.name, e);
      return null;
    });
  }));
  return posts
    .filter(function (p) { return p && p.show; })
    .sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}

async function loadPostBySlug(slug) {
  const files = await discoverPostFiles();
  const match = files.find(function (f) {
    return f.name.replace(/\.md$/i, '') === slug;
  });
  if (!match) throw new Error('not found');
  return loadPostFile(match);
}