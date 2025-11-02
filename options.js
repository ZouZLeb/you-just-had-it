// Settings Page Logic

let blacklist = [];
let customRules = {};

// Initialize on load
document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  setupEventListeners();
});

async function loadSettings() {
  const result = await chrome.storage.local.get(["blacklist", "customRules"]);
  blacklist = result.blacklist || [];
  customRules = result.customRules || {};

  renderBlacklist();
  renderCustomRules();
}

function setupEventListeners() {
  // Blacklist
  document
    .getElementById("addBlacklist")
    .addEventListener("click", addToBlacklist);
  document
    .getElementById("blacklistInput")
    .addEventListener("keypress", (e) => {
      if (e.key === "Enter") addToBlacklist();
    });

  // Custom rules
  document.getElementById("addRule").addEventListener("click", addCustomRule);
  document
    .getElementById("clearRuleForm")
    .addEventListener("click", clearRuleForm);

  // Danger zone
  document
    .getElementById("clearAllSettings")
    .addEventListener("click", resetAllSettings);
}

// Blacklist Functions
async function addToBlacklist() {
  const input = document.getElementById("blacklistInput");
  const value = input.value.trim();

  if (!value) {
    alert("Please enter a website pattern");
    return;
  }

  // Check for duplicates
  if (blacklist.includes(value)) {
    alert("This pattern is already in the blacklist");
    return;
  }

  blacklist.push(value);
  await saveBlacklist();

  input.value = "";
  renderBlacklist();
  showSuccessAlert();
}

async function removeFromBlacklist(pattern) {
  if (!confirm(`Remove "${pattern}" from blacklist?`)) return;

  blacklist = blacklist.filter((item) => item !== pattern);
  await saveBlacklist();
  renderBlacklist();
  showSuccessAlert();
}

async function saveBlacklist() {
  await chrome.storage.local.set({ blacklist });
}

function renderBlacklist() {
  const container = document.getElementById("blacklistContainer");

  if (blacklist.length === 0) {
    container.innerHTML =
      '<div class="empty-list">No blacklisted websites yet</div>';
    return;
  }

  container.innerHTML = blacklist
    .map(
      (pattern) => `
    <div class="list-item">
      <span class="list-item-text">${escapeHtml(pattern)}</span>
      <button class="list-item-remove" data-pattern="${escapeHtml(pattern)}">
        Remove
      </button>
    </div>
  `
    )
    .join("");

  // Attach event listeners
  container.querySelectorAll(".list-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeFromBlacklist(btn.dataset.pattern);
    });
  });
}

// Custom Rules Functions
async function addCustomRule() {
  const patternInput = document.getElementById("rulePattern");
  const selectorsInput = document.getElementById("ruleSelectors");

  const pattern = patternInput.value.trim();
  const selectorsText = selectorsInput.value.trim();

  if (!pattern) {
    alert("Please enter a website pattern");
    return;
  }

  if (!selectorsText) {
    alert("Please enter at least one CSS selector");
    return;
  }

  // Parse selectors (one per line)
  const selectors = selectorsText
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (selectors.length === 0) {
    alert("Please enter at least one valid CSS selector");
    return;
  }

  // Check if pattern already exists
  if (customRules[pattern]) {
    if (!confirm(`A rule for "${pattern}" already exists. Overwrite?`)) {
      return;
    }
  }

  customRules[pattern] = { selectors };
  await saveCustomRules();

  clearRuleForm();
  renderCustomRules();
  showSuccessAlert();
}

async function removeCustomRule(pattern) {
  if (!confirm(`Remove custom rule for "${pattern}"?`)) return;

  delete customRules[pattern];
  await saveCustomRules();
  renderCustomRules();
  showSuccessAlert();
}

async function saveCustomRules() {
  await chrome.storage.local.set({ customRules });
}

function clearRuleForm() {
  document.getElementById("rulePattern").value = "";
  document.getElementById("ruleSelectors").value = "";
}

function renderCustomRules() {
  const container = document.getElementById("rulesContainer");
  const ruleEntries = Object.entries(customRules);

  if (ruleEntries.length === 0) {
    container.innerHTML = '<div class="empty-list">No custom rules yet</div>';
    return;
  }

  container.innerHTML = ruleEntries
    .map(
      ([pattern, rule]) => `
    <div class="rule-item">
      <div class="rule-header">
        <div class="rule-pattern">${escapeHtml(pattern)}</div>
        <button class="list-item-remove" data-pattern="${escapeHtml(pattern)}">
          Remove
        </button>
      </div>
      <div class="rule-selectors">
        ${rule.selectors.map((s) => escapeHtml(s)).join("<br>")}
      </div>
    </div>
  `
    )
    .join("");

  // Attach event listeners
  container.querySelectorAll(".list-item-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      removeCustomRule(btn.dataset.pattern);
    });
  });
}

// Danger Zone Functions
async function resetAllSettings() {
  const confirmed = confirm(
    "Are you sure you want to reset ALL settings?\n\n" +
      "This will clear:\n" +
      "• All blacklisted websites\n" +
      "• All custom extraction rules\n\n" +
      "Your saved pages will NOT be deleted.\n\n" +
      "This action cannot be undone!"
  );

  if (!confirmed) return;

  // Double confirmation
  const doubleConfirm = confirm(
    "Are you absolutely sure? This cannot be undone!"
  );
  if (!doubleConfirm) return;

  blacklist = [];
  customRules = {};

  await chrome.storage.local.set({
    blacklist: [],
    customRules: {},
  });

  renderBlacklist();
  renderCustomRules();
  showSuccessAlert();
}

// Utility Functions
function showSuccessAlert() {
  const alert = document.getElementById("successAlert");
  alert.classList.add("show");

  setTimeout(() => {
    alert.classList.remove("show");
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Add default examples on first install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // Add some common default blacklist items
    const defaultBlacklist = [
      "accounts.google.com",
      "mail.google.com",
      "chrome://extensions",
      "chrome://settings",
    ];

    await chrome.storage.local.set({
      blacklist: defaultBlacklist,
      customRules: {},
    });
  }
});
