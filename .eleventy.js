const syntaxHighlight = require("@11ty/eleventy-plugin-syntaxhighlight");

module.exports = function (eleventyConfig) {
    eleventyConfig.addPlugin(syntaxHighlight);
    eleventyConfig.addPassthroughCopy("assets");
    eleventyConfig.addPassthroughCopy("images");
    eleventyConfig.addPassthroughCopy("favicon.ico");
    eleventyConfig.addPassthroughCopy("favicon-16x16.png");
    eleventyConfig.addPassthroughCopy("favicon-32x32.png");
    eleventyConfig.addPassthroughCopy("apple-touch-icon.png");
    eleventyConfig.addPassthroughCopy("android-chrome-192x192.png");
    eleventyConfig.addPassthroughCopy("android-chrome-512x512.png");

    eleventyConfig.addGlobalData("site", {
        url: "https://2102ankit.github.io",
        name: "Ankit Mishra"
    });

    ["index.html", "blog.html", "blog-posts.js", "posts-manifest.json", "hello-world.md", "isolaton-levels.md", "pagination-strategies.md", "understanding-sql-indexes.md", "posts/isolaton-levels.md"].forEach(function (file) {
        eleventyConfig.ignores.add(file);
    });

    eleventyConfig.addFilter("isoDate", function (value) {
        return new Date(value).toISOString().slice(0, 10);
    });

    eleventyConfig.addFilter("postDate", function (value) {
        return new Intl.DateTimeFormat("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric"
        }).format(new Date(value));
    });

    eleventyConfig.addFilter("postDateShort", function (value) {
        return new Intl.DateTimeFormat("en-US", {
            month: "short",
            year: "numeric"
        }).format(new Date(value));
    });

    eleventyConfig.addCollection("posts", function (collectionApi) {
        return collectionApi
            .getFilteredByGlob("posts/*.md")
            .filter(function (post) {
                return post.data.show === true;
            })
            .sort(function (a, b) {
                return b.date - a.date;
            });
    });

    return {
        dir: {
            input: ".",
            includes: "src/_includes",
            output: "_site"
        },
        templateFormats: ["md", "njk", "html"],
        markdownTemplateEngine: "njk",
        htmlTemplateEngine: "njk"
    };
};