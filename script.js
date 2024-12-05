const blogContent = document.getElementById("blog-content");
const blogList = document.getElementById("blog-list");
const closeBtn = document.getElementById("close-btn");
const username = "2102ankit"; // Replace with your GitHub username
const repo = "2102ankit.github.io"; // Replace with your repository name
const branch = "main"; // Replace with the branch name if different

// Function to load and display the blog content
async function loadBlog(url, timestampFilename = "") {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch blog content");
    }
    const content = await response.text();
    const { title, date, markdownContent } = extractMetadata(content);

    blogContent.innerHTML = `
      <div id="blog-title">${title}</div>
      <p><strong>Date:</strong> ${date}</p>
      <div class="line"></div>
      <div id="blog-details">
        ${marked.parse(markdownContent)}
      </div>
    `;

    // Show the blog content and hide the blog list
    blogList.style.display = "none";
    blogContent.style.display = "block";
    closeBtn.style.display = "block";

    // URL format for the browser's history and hash (use the title and timestamp)
    const timestamp =
      timestampFilename ||
      `${new Date(date).getTime()}_${encodeURIComponent(
        title.replace(/\s+/g, "_")
      )}`;

    // Update browser history, store both pathname and hash
    const newUrl = `${window.location.pathname}#${timestamp}`;
    history.pushState({ blog: timestamp }, title, newUrl);
  } catch (error) {
    console.error("Error loading blog:", error);
    // Reset the URL to the homepage or desired fallback state
    history.replaceState("", document.title, window.location.pathname); // Keep the history intact
    window.location.hash = ""; // Reset the hash
  }
}

// Function to extract title, date, and content from YAML front matter
function extractMetadata(content) {
  const metadataMatch = content.match(/^---\n([\s\S]*?)\n---/); // Match the front matter
  if (metadataMatch) {
    const metadata = metadataMatch[1];
    const titleMatch = metadata.match(/title:\s*(.+)/);
    const dateMatch = metadata.match(/date:\s*(.+)/);

    const title = titleMatch ? titleMatch[1] : "Untitled Blog";
    const date = dateMatch ? dateMatch[1] : "No Date Provided";
    const markdownContent = content.replace(metadataMatch[0], "").trim(); // Remove front matter

    return { title, date, markdownContent };
  }

  return {
    title: "Untitled Blog",
    date: "No Date Provided",
    markdownContent: content,
  };
}

// Clear content and return to the blog list
function clearContent() {
  closeBtn.style.display = "none";
  blogContent.style.display = "none";
  blogList.style.display = "block";

  // Use replaceState to keep the current state in the history stack
  history.replaceState("", document.title, window.location.pathname); // Clear URL
}

// Close button to clear content and go back to the main page
closeBtn.addEventListener("click", clearContent);

// Function to handle manual navigation (when user goes back in URL)
window.addEventListener("popstate", function (event) {
  const state = event.state;
  if (state && state.blog) {
    const blogUrl = `${state.blog}.md`;
    const fileUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${blogUrl}`;
    loadBlog(fileUrl, state.blog);
  } else {
    clearContent();
  }
});

// Function to populate the blog list dynamically
async function populateBlogList() {
  try {
    const files = await fetchMarkdownFiles();
    const blogList = document.getElementById("blog-list").querySelector("ul");

    // Clear existing list before adding new ones
    blogList.innerHTML = "";

    files.forEach((file) => {
      const listItem = document.createElement("li");
      const link = document.createElement("a");

      // Construct file URL
      const fileUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${file.name}`;

      // Fetch content for each file and extract title and date
      fetch(fileUrl)
        .then((response) => response.text())
        .then((content) => {
          const { title, date } = extractMetadata(content);

          // URL format: timestamp_filename (using date)
          const timestampFilename = `${new Date(
            date
          ).getTime()}_${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
          link.href = `#${timestampFilename}`;
          link.textContent = title; // Display title instead of filename
          link.addEventListener("click", (e) => {
            e.preventDefault();
            loadBlog(fileUrl, timestampFilename);
          });

          listItem.appendChild(link);
          blogList.appendChild(listItem);
        })
        .catch((error) => {
          console.error("Error loading blog content:", error);
          // Reset the URL in case of error
          history.replaceState("", document.title, window.location.pathname);
          window.location.hash = ""; // Reset the hash
        });
    });
  } catch (error) {
    console.error("Error populating blog list:", error);
    // Reset the URL in case of error
    history.replaceState("", document.title, window.location.pathname);
    window.location.hash = ""; // Reset the hash
  }
}

// Function to fetch markdown files from GitHub repository
async function fetchMarkdownFiles() {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${username}/${repo}/contents`
    );
    if (!response.ok) {
      throw new Error("Failed to fetch markdown files");
    }
    const data = await response.json();

    return data.filter((file) => file.name.endsWith(".md"));
  } catch (error) {
    console.error("Error fetching markdown files:", error);
    // Reset the URL in case of error
    history.replaceState("", document.title, window.location.pathname);
    window.location.hash = ""; // Reset the hash
    return [];
  }
}

// Initialize the blog list
populateBlogList();

// Handle the initial page load based on the URL hash
if (window.location.hash) {
  const blogUrl = window.location.hash.slice(1) + ".md";
  const fileUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${blogUrl}`;
  loadBlog(fileUrl, window.location.hash.slice(1));
}

// Check if the current URL hash is '#NaN_Untitled_Blog'
if (window.location.hash === "#NaN_Untitled_Blog") {
  // Redirect to the homepage
  window.location.href = "/";
}
