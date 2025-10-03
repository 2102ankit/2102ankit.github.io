const projects = [
  {
    name: "Nyaydoot",
    desc: "AI legal assistant with vernacular support, trained on 8 law textbooks and the Indian Constitution",
    tags: ["React", "Tailwind", "Node.js", "MongoDB", "Botpress"],
    url: "https://github.com/2102ankit/SIH-2023",
    thumb: "Nyaydoot",
  },
  {
    name: "RecomZone",
    desc: "Personalized recommendation engine using content-based filtering on movie and music datasets",
    tags: ["Pandas", "NumPy", "Scikit-learn", "MERN"],
    url: "https://github.com/2102ankit/recomzone",
    thumb: "RecomZone",
  },
  {
    name: "Swift Reader",
    desc: "Summarizes news articles into bite-sized content (60-100 words) with fast processing.",
    tags: ["MERN", "Distilbart", "Bing News API", "BeautifulSoup"],
    url: "https://github.com/2102ankit/Swift-Reader",
    thumb: "Swift Reader",
  },
  {
    name: "DevStar Toolkit",
    desc: "Free online developer toolkit for maximizing efficiency and productivity.",
    tags: ["Svelte", "Full-Stack", "DevOps"],
    url: "https://github.com/2102ankit/devstar",
    thumb: "DevStar",
  },
  {
    name: "Airbnb Clone",
    desc: "Full-stack Airbnb clone with real-time booking and user authentication.",
    tags: ["MERN", "React", "Node.js"],
    url: "https://github.com/2102ankit/airbnb-clone",
    thumb: "Airbnb",
  },
  {
    name: "Major Project",
    desc: "Academic project exploring advanced computing concepts in Python.",
    tags: ["Python", "Distributed Systems"],
    url: "https://github.com/2102ankit/major",
    thumb: "Major Project",
  },
];

let currentIndex = 0;

function renderCarousel() {
  const carousel = document.getElementById("projectCarousel");
  carousel.innerHTML = "";

  // Render 5 projects: left, left-center, center, right-center, right
  for (let i = -2; i <= 2; i++) {
    const index = (currentIndex + i + projects.length) % projects.length;
    const project = projects[index];
    const card = document.createElement("div");
    card.className = `project-card ${
      i === 0 ? "active" : i === -1 || i === 1 ? "side" : "edge"
    }`;
    card.innerHTML = `
                    <div class="project-thumb">${project.thumb}</div>
                    <div class="project-info">
                        <h3 class="project-title">${project.name}</h3>
                        <p class="project-desc">${project.desc}</p>
                        <div class="project-tags">
                            ${project.tags
                              .map((tag) => `<span class="tag">${tag}</span>`)
                              .join("")}
                        </div>
                        <div class="project-links">
                            <a href="${
                              project.url
                            }" class="project-link" target="_blank">GitHub</a>
                        </div>
                    </div>
                `;
    carousel.appendChild(card);
  }
}

function nextProject() {
  currentIndex = (currentIndex + 1) % projects.length;
  renderCarousel();
}

function prevProject() {
  currentIndex = (currentIndex - 1 + projects.length) % projects.length;
  renderCarousel();
}

// Auto-rotate every 5 seconds
setInterval(nextProject, 5000);

// Initial render
renderCarousel();

// Navbar scroll effect
window.addEventListener("scroll", () => {
  const nav = document.querySelector("nav");
  if (window.scrollY > 50) {
    nav.classList.add("scrolled");
  } else {
    nav.classList.remove("scrolled");
  }
});

// Active nav link
const sections = document.querySelectorAll("section");
const navLinks = document.querySelectorAll("nav a");
window.addEventListener("scroll", () => {
  let current = "";
  sections.forEach((section) => {
    const sectionTop = section.offsetTop;
    if (scrollY >= sectionTop - 200) {
      current = section.getAttribute("id");
    }
  });
  navLinks.forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === `#${current}`) {
      link.classList.add("active");
    }
  });
});

// Scroll animations
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("animate");
      }
    });
  },
  { threshold: 0.1 }
);

sections.forEach((section) => observer.observe(section));

// Smooth scroll for nav links
navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    target.scrollIntoView({ behavior: "smooth" });
  });
});