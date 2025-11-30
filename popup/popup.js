const STORAGE_KEY = 'quickSlashSnippets';

const form = document.getElementById('snippet-form');
const nameInput = document.getElementById('nameInput');
const valueInput = document.getElementById('valueInput');
const formMessage = document.getElementById('formMessage');
const snippetList = document.getElementById('snippetList');
const emptyState = document.getElementById('emptyState');
const settingsButton = document.getElementById('settingsButton');
const settingsMenu = document.getElementById('settingsMenu');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importInput = document.getElementById('importInput');

let snippets = [];
let settingsOpen = false;

init();

function init() {
  loadSnippets().then((items) => {
    snippets = items;
    renderList();
  });

  form.addEventListener('submit', handleSubmit);
  snippetList.addEventListener('click', handleListClick);
  settingsButton.addEventListener('click', toggleSettings);
  exportButton.addEventListener('click', handleExport);
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImport);
  document.addEventListener('mousedown', handleDocumentClick, true);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      snippets = changes[STORAGE_KEY].newValue || [];
      renderList();
    }
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage('');

  const rawName = nameInput.value.trim();
  const rawValue = valueInput.value;

  if (!rawName) {
    return setMessage('Name is required.');
  }

  if (!rawValue.trim()) {
    return setMessage('Value is required.');
  }

  const duplicate = snippets.some((item) => item.name.toLowerCase() === rawName.toLowerCase());
  if (duplicate) {
    return setMessage('Name must be unique.');
  }

  const next = sortSnippets([...snippets, { name: rawName, value: rawValue }]);
  try {
    await persist(next);
  } catch (error) {
    console.error(error);
    return;
  }
  snippets = next;
  renderList();
  form.reset();
  nameInput.focus();
}

async function handleListClick(event) {
  const button = event.target.closest('button[data-name]');
  if (!button) return;
  const { name } = button.dataset;
  const next = snippets.filter((item) => item.name !== name);
  try {
    await persist(next);
  } catch (error) {
    console.error(error);
    return;
  }
  snippets = next;
  renderList();
}

function renderList() {
  snippetList.innerHTML = '';
  if (!snippets.length) {
    emptyState.hidden = false;
    return;
  }

  emptyState.hidden = true;

  for (const item of snippets) {
    const li = document.createElement('li');
    li.className = 'snippet-card';

    const content = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.name;
    const preview = document.createElement('span');
    preview.textContent = summarize(item.value);
    content.appendChild(title);
    content.appendChild(preview);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.textContent = 'Delete';
    removeBtn.dataset.name = item.name;
    removeBtn.setAttribute('aria-label', `Delete ${item.name}`);

    li.appendChild(content);
    li.appendChild(removeBtn);
    snippetList.appendChild(li);
  }
}

function summarize(value) {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= 80) return singleLine;
  return `${singleLine.slice(0, 77)}...`;
}

async function loadSnippets() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
      resolve(result[STORAGE_KEY] || []);
    });
  });
}

async function persist(next) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) {
        setMessage('Failed to save.');
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

function sortSnippets(list) {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

function setMessage(message) {
  formMessage.textContent = message;
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  settingsMenu.hidden = !settingsOpen;
}

function closeSettings() {
  settingsOpen = false;
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsMenu.hidden = true;
}

function handleDocumentClick(event) {
  if (!settingsOpen) return;
  const target = event.target;
  if (target === settingsButton || settingsButton.contains(target)) return;
  if (settingsMenu.contains(target)) return;
  closeSettings();
}

function handleExport() {
  if (!snippets.length) {
    setMessage('No snippets to export.');
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    snippets
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'quickslash-snippets.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  setMessage('Exported snippets.');
  closeSettings();
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const imported = Array.isArray(data?.snippets) ? data.snippets : Array.isArray(data) ? data : [];
    if (!Array.isArray(imported) || !imported.length) {
      setMessage('Invalid file.');
      return;
    }
    const normalizedMap = new Map();
    for (const item of imported) {
      if (!item || typeof item.name !== 'string' || typeof item.value !== 'string') continue;
      const trimmedName = item.name.trim();
      if (!trimmedName) continue;
      normalizedMap.set(trimmedName, item.value);
    }
    if (!normalizedMap.size) {
      setMessage('Nothing to import.');
      return;
    }
    const next = sortSnippets(
      Array.from(normalizedMap.entries()).map(([name, value]) => ({ name, value }))
    );
    await persist(next);
    snippets = next;
    renderList();
    setMessage('Imported snippets.');
    closeSettings();
  } catch (error) {
    console.error(error);
    setMessage('Failed to import.');
  }
}
