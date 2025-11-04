// Service Worker for "You Just Had It"

let activeTabTimer = null;
let currentTabId = null;
let currentUrl = null;

// Track tab activation
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  clearTimeout(activeTabTimer);
  currentTabId = activeInfo.tabId;

  const tab = await chrome.tabs.get(activeInfo.tabId);
  handleTabChange(tab);
});

// Track tab updates (URL changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active) {
    clearTimeout(activeTabTimer);
    handleTabChange(tab);
  }
});

function handleTabChange(tab) {
  // Skip chrome:// and extension pages
  if (
    !tab.url ||
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://")
  ) {
    return;
  }

  // Skip if same URL
  if (tab.url === currentUrl) {
    return;
  }

  currentUrl = tab.url;
  currentTabId = tab.id;

  // Start 5-second timer
  activeTabTimer = setTimeout(() => {
    capturePage(tab);
  }, 5000);
}

async function capturePage(tab) {
  try {
    // CRITICAL: Check sensitive sites FIRST (before any other checks)
    const isSensitive = await checkSensitiveSite(tab.url, tab.title);
    if (isSensitive) {
      console.log("🛡️ Sensitive site detected, skipping capture:", tab.url);
      return;
    }

    // Check if URL is blacklisted (user-defined)
    const isBlacklisted = await checkBlacklist(tab.url);
    if (isBlacklisted) {
      console.log("Blacklisted site, skipping capture:", tab.url);
      return;
    }

    // Get custom extraction rules
    const customRules = await getCustomRules(tab.url);

    // Inject content script to extract page data
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageData,
      args: [customRules],
    });

    if (results && results[0] && results[0].result) {
      const pageData = results[0].result;
      await savePage(tab, pageData);
    }
  } catch (error) {
    console.error("Error capturing page:", error);
  }
}

async function checkSensitiveSite(url, title = "") {
  try {
    const urlLower = url.toLowerCase();
    const titleLower = title.toLowerCase();

    // WHITELIST: Sites that are safe even if they contain sensitive keywords
    const SAFE_DOMAINS = [
      // News & Media
      "nytimes.com",
      "wsj.com",
      "washingtonpost.com",
      "reuters.com",
      "bloomberg.com",
      "forbes.com",
      "fortune.com",
      "businessinsider.com",
      "cnbc.com",
      "cnn.com",
      "bbc.com",
      "theguardian.com",
      "npr.org",
      "apnews.com",
      "usatoday.com",
      "latimes.com",
      "chicagotribune.com",

      // Social Media (articles/posts are safe, login pages are not)
      "twitter.com",
      "x.com",
      "reddit.com",
      "linkedin.com",
      "facebook.com",
      "instagram.com",
      "tiktok.com",

      // Content Platforms
      "youtube.com",
      "medium.com",
      "substack.com",
      "wordpress.com",
      "blogger.com",
      "tumblr.com",
      "quora.com",
      "stackoverflow.com",

      // Wikipedia & Education
      "wikipedia.org",
      "wikihow.com",
      "britannica.com",
      "khanacademy.org",
      "coursera.org",
      "udemy.com",

      // Tech & Developer
      "github.com",
      "gitlab.com",
      "stackoverflow.com",
      "dev.to",
      "hackernews.com",
      "techcrunch.com",
      "theverge.com",
      "arstechnica.com",

      // Finance News (not banking)
      "marketwatch.com",
      "seekingalpha.com",
      "fool.com",
      "investopedia.com",
    ];

    // Check if domain is whitelisted (safe for content)
    const domain = new URL(url).hostname.replace("www.", "");
    for (const safeDomain of SAFE_DOMAINS) {
      if (domain.includes(safeDomain)) {
        // Still block login/signin pages on these platforms
        if (
          urlLower.includes("/login") ||
          urlLower.includes("/signin") ||
          urlLower.includes("/sign-in") ||
          urlLower.includes("/authenticate") ||
          urlLower.includes("accounts.") ||
          urlLower.includes("account.")
        ) {
          console.log(`🛡️ Blocked login page on safe domain: ${url}`);
          return true;
        }
        // Safe domain, allow content
        console.log(`✅ Safe content domain: ${domain}`);
        return false;
      }
    }

    // CRITICAL DOMAINS: Always block these exact domains regardless of path
    const CRITICAL_DOMAINS = [
      "chase.com",
      "bankofamerica.com",
      "wellsfargo.com",
      "citibank.com",
      "usbank.com",
      "capitalone.com",
      "pnc.com",
      "ally.com",
      "paypal.com",
      "venmo.com",
      "zelle.com",
      "cashapp.com",
      "mail.google.com",
      "outlook.live.com",
      "mail.yahoo.com",
      "mychart.com",
      "patient.",
      "healthrecord",
      "irs.gov",
      "ssa.gov",
    ];

    for (const criticalDomain of CRITICAL_DOMAINS) {
      if (domain.includes(criticalDomain)) {
        console.log(`🛡️ Blocked critical domain: ${criticalDomain}`);
        return true;
      }
    }

    // Check for authentication/account management paths (high priority)
    const CRITICAL_PATHS = [
      "/login",
      "/signin",
      "/sign-in",
      "/log-in",
      "/authenticate",
      "/auth/",
      "/account/settings",
      "/account/security",
      "/myaccount",
      "/checkout",
      "/payment",
      "/billing",
      "/portal",
      "/patient-portal",
      "/member-portal",
    ];

    const urlPath = new URL(url).pathname.toLowerCase();
    for (const path of CRITICAL_PATHS) {
      if (urlPath.includes(path)) {
        console.log(`🛡️ Blocked by critical path: ${path}`);
        return true;
      }
    }

    // Check for sensitive patterns ONLY if not on a content platform
    // These patterns suggest actual sensitive pages, not content about them
    const SENSITIVE_URL_PATTERNS = [
      "online-banking",
      "onlinebanking",
      "digital-banking",
      "creditcard-login",
      "credit-card-account",
      "patient-access",
      "medical-records",
      "health-records",
      "insurance-member",
      "claims-portal",
      "tax-return",
      "tax-filing",
    ];

    for (const pattern of SENSITIVE_URL_PATTERNS) {
      if (urlLower.includes(pattern)) {
        console.log(`🛡️ Blocked by URL pattern: ${pattern}`);
        return true;
      }
    }

    // Check title for authentication indicators (not just keywords)
    const AUTH_TITLE_PATTERNS = [
      "sign in to",
      "log in to",
      "login to",
      "sign in -",
      "log in -",
      "login -",
      "member login",
      "customer login",
      "patient login",
      "account login",
      "secure login",
      "password reset",
      "forgot password",
      "verify your identity",
      "two-factor authentication",
    ];

    for (const pattern of AUTH_TITLE_PATTERNS) {
      if (titleLower.includes(pattern)) {
        console.log(`🛡️ Blocked by auth title pattern: ${pattern}`);
        return true;
      }
    }

    // If we got here, it's likely safe content (article, blog, social post)
    return false;
  } catch (error) {
    console.error("Error checking sensitive site:", error);
    // Only block on error if it looks like a suspicious URL
    const urlLower = url.toLowerCase();
    if (
      urlLower.includes("login") ||
      urlLower.includes("account") ||
      urlLower.includes("portal")
    ) {
      return true; // Fail-safe for suspicious URLs
    }
    return false; // Allow on error for normal-looking URLs
  }
}

async function checkBlacklist(url) {
  try {
    const result = await chrome.storage.local.get(["blacklist"]);
    const blacklist = result.blacklist || [];

    // Check if URL matches any blacklist entry
    return blacklist.some((pattern) => {
      try {
        // Support both exact domain match and wildcard patterns
        const regex = new RegExp(
          pattern.replace(/\*/g, ".*").replace(/\./g, "\\."),
          "i"
        );
        return regex.test(url);
      } catch (e) {
        // If regex fails, do simple string matching
        return url.toLowerCase().includes(pattern.toLowerCase());
      }
    });
  } catch (error) {
    console.error("Error checking blacklist:", error);
    return false;
  }
}

async function getCustomRules(url) {
  try {
    const result = await chrome.storage.local.get(["customRules"]);
    const customRules = result.customRules || {};

    // Find matching rule for this URL
    for (const [pattern, rule] of Object.entries(customRules)) {
      try {
        const regex = new RegExp(
          pattern.replace(/\*/g, ".*").replace(/\./g, "\\."),
          "i"
        );
        if (regex.test(url)) {
          return rule;
        }
      } catch (e) {
        if (url.toLowerCase().includes(pattern.toLowerCase())) {
          return rule;
        }
      }
    }
    return null;
  } catch (error) {
    console.error("Error getting custom rules:", error);
    return null;
  }
}

// This function runs in the page context
function extractPageData(customRules) {
  // Extract meta description
  const getMetaContent = (name) => {
    const meta =
      document.querySelector(`meta[name="${name}"]`) ||
      document.querySelector(`meta[property="${name}"]`) ||
      document.querySelector(`meta[property="og:${name}"]`);
    return meta ? meta.content : "";
  };

  // Sanitize and extract main content
  const getMainContent = () => {
    // If custom rules exist, ONLY use those selectors - ignore everything else
    if (
      customRules &&
      customRules.selectors &&
      customRules.selectors.length > 0
    ) {
      let content = "";
      customRules.selectors.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            const text = el.innerText || el.textContent || "";
            if (text.trim()) {
              content += text + "\n\n";
            }
          });
        } catch (e) {
          console.warn("Invalid selector:", selector, e);
        }
      });

      // If custom rules found content, return ONLY that
      if (content.trim()) {
        return sanitizeContent(content);
      }
      // If custom rules were provided but found nothing, return empty
      // This prevents fallback to full page extraction
      console.log("Custom rules provided but no content found with selectors");
      return "";
    }

    // Default extraction only when NO custom rules exist
    const clone = document.body.cloneNode(true);

    // Remove unwanted elements
    const unwantedSelectors = [
      "script",
      "style",
      "nav",
      "footer",
      "header",
      "iframe",
      "noscript",
      "svg",
      ".ad",
      ".advertisement",
      ".ads",
      ".banner",
      '[role="navigation"]',
      '[role="banner"]',
      '[role="complementary"]',
      ".sidebar",
      ".menu",
      ".navigation",
      ".nav",
      ".social-share",
      ".comments",
      ".related-posts",
    ];

    unwantedSelectors.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((el) => el.remove());
    });

    // Remove all links (keep text, remove href)
    clone.querySelectorAll("a").forEach((a) => {
      const text = document.createTextNode(a.innerText || a.textContent || "");
      a.parentNode.replaceChild(text, a);
    });

    // Remove all images
    clone.querySelectorAll("img").forEach((img) => img.remove());

    // Get text content
    let text = clone.innerText || clone.textContent || "";

    return sanitizeContent(text);
  };

  // Sanitize content: remove extra whitespace, limit length
  const sanitizeContent = (text) => {
    return text
      .replace(/\s+/g, " ") // Replace multiple spaces with single space
      .replace(/\n\s*\n/g, "\n") // Remove multiple blank lines
      .trim()
      .substring(0, 5000); // Limit to 5000 chars
  };

  // Detect platform
  const detectPlatform = () => {
    const url = window.location.href;
    if (url.includes("youtube.com")) return "youtube";
    if (url.includes("tiktok.com")) return "tiktok";
    if (url.includes("twitter.com") || url.includes("x.com")) return "twitter";
    if (url.includes("instagram.com")) return "instagram";
    if (url.includes("linkedin.com")) return "linkedin";
    return "web";
  };

  // Extract YouTube-specific data
  const getYouTubeData = () => {
    if (detectPlatform() !== "youtube") return null;

    // If custom rules exist, use ONLY the content from custom selectors
    let description = "";
    if (
      customRules &&
      customRules.selectors &&
      customRules.selectors.length > 0
    ) {
      customRules.selectors.forEach((selector) => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach((el) => {
            const text = el.innerText || el.textContent || "";
            if (text.trim()) {
              description += text + " ";
            }
          });
        } catch (e) {
          console.warn("Invalid YouTube selector:", selector, e);
        }
      });
    } else {
      // Default YouTube selectors only when no custom rules
      const descEl =
        document.querySelector("#description-inline-expander") ||
        document.querySelector("#description") ||
        document.querySelector("ytd-text-inline-expander") ||
        document.querySelector(".ytd-video-secondary-info-renderer");
      description = descEl ? descEl.innerText || descEl.textContent || "" : "";
    }

    return {
      videoTitle:
        document.querySelector("h1.ytd-video-primary-info-renderer")
          ?.innerText ||
        document.querySelector("h1.title")?.innerText ||
        document.querySelector("h1 yt-formatted-string")?.innerText ||
        "",
      channelName:
        document.querySelector("#channel-name a")?.innerText ||
        document.querySelector("ytd-channel-name a")?.innerText ||
        document.querySelector(".ytd-video-owner-renderer")?.innerText ||
        "",
      description: sanitizeContent(description),
    };
  };

  return {
    title: document.title,
    description: getMetaContent("description"),
    keywords: getMetaContent("keywords"),
    ogTitle: getMetaContent("og:title"),
    ogDescription: getMetaContent("og:description"),
    ogImage: getMetaContent("og:image"),
    content: getMainContent(),
    platform: detectPlatform(),
    platformData: getYouTubeData(),
  };
}

async function savePage(tab, pageData) {
  const now = Date.now();
  const pageId = `page_${now}_${Math.random().toString(36).substr(2, 9)}`;

  // Get domain from URL
  let domain = "";
  try {
    const url = new URL(tab.url);
    domain = url.hostname.replace("www.", "");
  } catch (e) {
    domain = "unknown";
  }

  const page = {
    id: pageId,
    url: tab.url,
    title: pageData.title || tab.title,
    description: pageData.description || pageData.ogDescription || "",
    content: pageData.content || "",
    domain: domain,
    favicon: tab.favIconUrl || "",
    platform: pageData.platform || "web",
    platformData: pageData.platformData || {},
    tags: [],
    notes: "",
    visitCount: 1,
    firstVisit: now,
    lastVisit: now,
    isFavorite: false,
  };

  // Get existing pages
  const result = await chrome.storage.local.get(["pages"]);
  let pages = result.pages || [];

  // Check if URL already exists
  const existingIndex = pages.findIndex((p) => p.url === tab.url);

  if (existingIndex !== -1) {
    // Update existing page
    pages[existingIndex].visitCount++;
    pages[existingIndex].lastVisit = now;
    pages[existingIndex].title = page.title; // Update title in case it changed
  } else {
    // Add new page
    pages.unshift(page);

    // Limit to 1000 pages for MVP
    if (pages.length > 1000) {
      pages = pages.slice(0, 1000);
    }
  }

  // Save to storage
  await chrome.storage.local.set({ pages });

  console.log("Page captured:", page.title);
}

// Initialize extension
chrome.runtime.onInstalled.addListener(() => {
  console.log("You Just Had It installed!");
});
