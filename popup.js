// Popup UI Logic

let allPages = [];
let filteredPages = [];
let currentFilter = "all";
let currentModalUrl = null;
let currentSearchTerms = []; // Store current search terms for highlighting

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  await loadPages();
  setupEventListeners();
});

async function loadPages() {
  const result = await chrome.storage.local.get(["pages"]);
  allPages = result.pages || [];
  applyFilters();
  renderResults();
  updateStats();
}

function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById("searchInput");
  searchInput.addEventListener("input", (e) => {
    performSearch(e.target.value);
  });

  // Filter buttons
  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      applyFilters();
      renderResults();
    });
  });

  // Clear all button
  document.getElementById("clearAll").addEventListener("click", async (e) => {
    e.preventDefault();
    if (
      confirm(
        "Are you sure you want to clear all saved pages? This cannot be undone."
      )
    ) {
      await chrome.storage.local.set({ pages: [] });
      allPages = [];
      filteredPages = [];
      renderResults();
      updateStats();
    }
  });

  // Export data button
  document.getElementById("exportData").addEventListener("click", exportToJSON);

  // Open settings button
  document.getElementById("openSettings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Modal controls
  document.getElementById("modalClose").addEventListener("click", closeModal);
  document
    .getElementById("modalCloseBtn")
    .addEventListener("click", closeModal);
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") closeModal();
  });
  document.getElementById("modalOpen").addEventListener("click", () => {
    if (currentModalUrl) {
      chrome.tabs.create({ url: currentModalUrl });
      closeModal();
    }
  });
}

function applyFilters() {
  currentSearchTerms = []; // Clear search terms when applying filters
  if (currentFilter === "all") {
    filteredPages = [...allPages];
  } else {
    filteredPages = allPages.filter((page) => page.platform === currentFilter);
  }
}

function performSearch(query) {
  if (!query.trim()) {
    applyFilters();
    renderResults();
    return;
  }

  // Split query into individual words and clean them
  const searchTerms = query
    .toLowerCase()
    .split(/\s+/) // Split by whitespace
    .filter((term) => term.length > 0); // Remove empty strings

  if (searchTerms.length === 0) {
    applyFilters();
    renderResults();
    return;
  }

  // Search with current filter applied
  const basePages =
    currentFilter === "all"
      ? allPages
      : allPages.filter((page) => page.platform === currentFilter);

  // Score-based search: pages matching more terms rank higher
  const scoredPages = basePages.map((page) => {
    // Create searchable text from page
    const searchText = `
      ${page.title} 
      ${page.description} 
      ${page.content} 
      ${page.domain} 
      ${page.url}
      ${page.notes}
      ${page.tags.join(" ")}
    `.toLowerCase();

    // Count how many search terms match
    let matchCount = 0;
    let matchedTerms = [];

    searchTerms.forEach((term) => {
      if (searchText.includes(term)) {
        matchCount++;
        matchedTerms.push(term);
      }
    });

    return {
      page,
      score: matchCount,
      matchedTerms,
      totalTerms: searchTerms.length,
    };
  });

  // Filter to pages that match at least one term
  const matchedPages = scoredPages
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      // Sort by score (descending) - pages matching more terms appear first
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      // If same score, sort by last visit (most recent first)
      return b.page.lastVisit - a.page.lastVisit;
    });

  filteredPages = matchedPages.map((item) => item.page);

  // Store search info for highlighting
  currentSearchTerms = searchTerms;

  renderResults();
  updateStats();
}

function renderResults() {
  const resultsContainer = document.getElementById("results");

  if (filteredPages.length === 0) {
    resultsContainer.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <h3>${allPages.length === 0 ? "No pages yet" : "No results found"}</h3>
        <p>${
          allPages.length === 0
            ? "Visit websites for more than 5 seconds and they'll automatically appear here."
            : "Try a different search term or filter."
        }</p>
      </div>
    `;
    return;
  }

  resultsContainer.innerHTML = filteredPages
    .map((page) => createResultCard(page))
    .join("");

  // Add click handlers
  attachEventHandlers();
}

function attachEventHandlers() {
  // Open page on title click
  document.querySelectorAll(".result-title").forEach((title) => {
    title.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = title.closest(".result-item").dataset.url;
      chrome.tabs.create({ url });
    });
  });

  // Delete buttons
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const pageId = btn.dataset.id;
      await deletePage(pageId);
    });
  });

  // Preview toggle buttons
  document.querySelectorAll(".preview-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pageId = btn.dataset.id;
      togglePreview(pageId, btn);
    });
  });

  // View full content buttons
  document.querySelectorAll(".view-content-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pageId = btn.dataset.id;
      showFullContent(pageId);
    });
  });

  // Open page buttons
  document.querySelectorAll(".open-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const url = btn.closest(".result-item").dataset.url;
      chrome.tabs.create({ url });
    });
  });
}

function createResultCard(page) {
  const timeAgo = getTimeAgo(page.lastVisit);
  const platformEmoji = getPlatformEmoji(page.platform);
  const firstVisitDate = new Date(page.firstVisit).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Truncate content for preview
  const contentPreview = page.content ? page.content.substring(0, 500) : "";
  const hasMoreContent = page.content && page.content.length > 500;

  // Highlight search terms if searching
  let displayTitle = escapeHtml(page.title);
  let displayDescription = page.description ? escapeHtml(page.description) : "";

  if (currentSearchTerms.length > 0) {
    displayTitle = highlightTerms(displayTitle, currentSearchTerms);
    displayDescription = displayDescription
      ? highlightTerms(displayDescription, currentSearchTerms)
      : "";
  }

  return `
    <div class="result-item" data-url="${escapeHtml(page.url)}" data-id="${
    page.id
  }">
      <div class="result-header">
        ${
          page.favicon
            ? `<img src="${escapeHtml(
                page.favicon
              )}" class="result-favicon" onerror="this.style.display='none'">`
            : `<span class="result-favicon">${platformEmoji}</span>`
        }
        <div class="result-content">
          <div class="result-title">${displayTitle}</div>
          <div class="result-meta">
            <span class="result-domain">${escapeHtml(page.domain)}</span>
            <span>•</span>
            <span>${timeAgo}</span>
            ${
              page.visitCount > 1
                ? `<span class="visit-badge">👁️ ${page.visitCount} visit${
                    page.visitCount > 1 ? "s" : ""
                  }</span>`
                : ""
            }
          </div>
          ${
            displayDescription
              ? `<div class="result-description">${displayDescription}</div>`
              : ""
          }
          ${
            contentPreview
              ? `<div class="result-preview" id="preview-${page.id}">
                 ${escapeHtml(contentPreview)}${hasMoreContent ? "..." : ""}
               </div>`
              : ""
          }
        </div>
      </div>
      
      <div class="result-actions">
        <button class="action-btn primary open-btn" title="Open page">
          🔗 Open
        </button>
        ${
          contentPreview
            ? `<button class="action-btn preview-btn" data-id="${page.id}" title="Toggle content preview">
               👁️ Preview
             </button>`
            : ""
        }
        ${
          hasMoreContent || (contentPreview && page.content.length > 200)
            ? `<button class="action-btn view-content-btn" data-id="${page.id}" title="View full content">
               📄 Full Content
             </button>`
            : ""
        }
        <button class="action-btn danger delete-btn" data-id="${
          page.id
        }" title="Delete this page">
          🗑️ Delete
        </button>
      </div>
      
      <div style="font-size: 11px; color: #80868b; margin-top: 8px; padding-top: 8px; border-top: 1px solid #f1f3f4;">
        First visited: ${firstVisitDate} • Last visited: ${timeAgo}
      </div>
    </div>
  `;
}

// Highlight search terms in text
function highlightTerms(text, terms) {
  let result = text;

  terms.forEach((term) => {
    // Create case-insensitive regex
    const regex = new RegExp(`(${escapeRegex(term)})`, "gi");
    result = result.replace(regex, '<span class="highlight">$1</span>');
  });

  return result;
}

// Escape special regex characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Create result card
function createResultCard(page) {
  const timeAgo = getTimeAgo(page.lastVisit);
  const platformEmoji = getPlatformEmoji(page.platform);
  const firstVisitDate = new Date(page.firstVisit).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  // Truncate content for preview
  const contentPreview = page.content ? page.content.substring(0, 500) : "";
  const hasMoreContent = page.content && page.content.length > 500;

  return `
    <div class="result-item" data-url="${escapeHtml(page.url)}" data-id="${
    page.id
  }">
      <div class="result-header">
        ${
          page.favicon
            ? `<img src="${escapeHtml(
                page.favicon
              )}" class="result-favicon" onerror="this.style.display='none'">`
            : `<span class="result-favicon">${platformEmoji}</span>`
        }
        <div class="result-content">
          <div class="result-title">${escapeHtml(page.title)}</div>
          <div class="result-meta">
            <span class="result-domain">${escapeHtml(page.domain)}</span>
            <span>•</span>
            <span>${timeAgo}</span>
            ${
              page.visitCount > 1
                ? `<span class="visit-badge">👁️ ${page.visitCount} visit${
                    page.visitCount > 1 ? "s" : ""
                  }</span>`
                : ""
            }
          </div>
          ${
            page.description
              ? `<div class="result-description">${escapeHtml(
                  page.description
                )}</div>`
              : ""
          }
          ${
            contentPreview
              ? `<div class="result-preview" id="preview-${page.id}">
                 ${escapeHtml(contentPreview)}${hasMoreContent ? "..." : ""}
               </div>`
              : ""
          }
        </div>
      </div>
      
      <div class="result-actions">
        <button class="action-btn primary open-btn" title="Open page">
          🔗 Open
        </button>
        ${
          contentPreview
            ? `<button class="action-btn preview-btn" data-id="${page.id}" title="Toggle content preview">
               👁️ Preview
             </button>`
            : ""
        }
        ${
          hasMoreContent || (contentPreview && page.content.length > 200)
            ? `<button class="action-btn view-content-btn" data-id="${page.id}" title="View full content">
               📄 Full Content
             </button>`
            : ""
        }
        <button class="action-btn danger delete-btn" data-id="${
          page.id
        }" title="Delete this page">
          🗑️ Delete
        </button>
      </div>
      
      <div style="font-size: 11px; color: #80868b; margin-top: 8px; padding-top: 8px; border-top: 1px solid #f1f3f4;">
        First visited: ${firstVisitDate} • Last visited: ${timeAgo}
      </div>
    </div>
  `;
}

function togglePreview(pageId, button) {
  const preview = document.getElementById(`preview-${pageId}`);
  if (preview) {
    const isExpanded = preview.classList.toggle("expanded");
    button.classList.toggle("active", isExpanded);
    button.innerHTML = isExpanded ? "👁️ Hide" : "👁️ Preview";
  }
}

function showFullContent(pageId) {
  const page = allPages.find((p) => p.id === pageId);
  if (!page) return;

  const modal = document.getElementById("modalOverlay");
  const modalTitle = document.getElementById("modalTitle");
  const modalContent = document.getElementById("modalContent");

  modalTitle.textContent = page.title;
  currentModalUrl = page.url;

  // Format content nicely
  let content = `
    <div style="margin-bottom: 16px; padding-bottom: 16px; border-bottom: 1px solid #e0e0e0;">
      <div style="color: #667eea; font-weight: 600; margin-bottom: 4px;">${escapeHtml(
        page.domain
      )}</div>
      <div style="font-size: 12px; color: #5f6368;">${escapeHtml(
        page.url
      )}</div>
      ${
        page.description
          ? `<div style="margin-top: 8px; font-style: italic; color: #5f6368;">${escapeHtml(
              page.description
            )}</div>`
          : ""
      }
    </div>
  `;

  if (page.content) {
    content += `
      <div style="white-space: pre-wrap; line-height: 1.6;">
        ${escapeHtml(page.content)}
      </div>
    `;
  } else {
    content += `<p style="color: #5f6368; font-style: italic;">No content preview available for this page.</p>`;
  }

  if (page.platformData && Object.keys(page.platformData).length > 0) {
    content += `
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
        <div style="font-weight: 600; margin-bottom: 8px;">Platform Details:</div>
        <pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; font-size: 12px; overflow-x: auto;">${JSON.stringify(
          page.platformData,
          null,
          2
        )}</pre>
      </div>
    `;
  }

  modalContent.innerHTML = content;
  modal.classList.add("active");
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("active");
  currentModalUrl = null;
}

async function deletePage(pageId) {
  if (!confirm("Delete this page from your history?")) return;

  allPages = allPages.filter((page) => page.id !== pageId);
  await chrome.storage.local.set({ pages: allPages });

  applyFilters();
  renderResults();
  updateStats();
}

function updateStats() {
  const statsText = document.getElementById("statsText");
  const totalPages = allPages.length;
  const totalVisits = allPages.reduce((sum, page) => sum + page.visitCount, 0);

  if (totalPages === 0) {
    statsText.textContent = "No pages captured yet";
    return;
  }

  // Show search-specific stats if searching
  if (currentSearchTerms.length > 0) {
    const matchInfo = `Showing ${filteredPages.length} result${
      filteredPages.length !== 1 ? "s" : ""
    } matching "${currentSearchTerms.join(" ")}"`;
    statsText.textContent = `${matchInfo} • ${totalPages} total pages`;
  } else {
    statsText.textContent = `${filteredPages.length} of ${totalPages} pages • ${totalVisits} total visits`;
  }
}

function exportToJSON() {
  const dataStr = JSON.stringify(allPages, null, 2);
  const dataBlob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `you-just-had-it-export-${Date.now()}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getPlatformEmoji(platform) {
  const emojis = {
    youtube: "🎥",
    twitter: "🐦",
    instagram: "📸",
    tiktok: "🎵",
    linkedin: "💼",
    web: "📄",
  };
  return emojis[platform] || "📄";
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Listen for storage changes (real-time updates)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local" && changes.pages) {
    loadPages();
  }
});
