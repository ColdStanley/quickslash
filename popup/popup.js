const STORAGE_KEY = 'quickSlashSnippets';
const ICONS = {
  delete:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1h5a1 1 0 1 1 0 2h-1.06l-1.15 15.09A2.5 2.5 0 0 1 15.3 22H8.7a2.5 2.5 0 0 1-2.49-1.91L5.06 5H4a1 1 0 1 1 0-2zm7.94 4H7.06l1.07 14.07a.5.5 0 0 0 .49.44h6.76a.5.5 0 0 0 .49-.44zM14 9a1 1 0 0 1 2 0v9a1 1 0 0 1-2 0zm-5 0a1 1 0 0 1 2 0v9a1 1 0 0 1-2 0zm1-4v1h4V5z" fill="currentColor"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-1v1a5 5 0 0 1-5 5H5a5 5 0 0 1-5-5V10a5 5 0 0 1 5-5h1zm2 0v7h7V3a1 1 0 0 0-1-1h-5a1 1 0 0 0-1 1zm-6 4a3 3 0 0 0-3 3v9a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-9a3 3 0 0 0-3-3z" fill="currentColor"/></svg>'
};

const form = document.getElementById('snippet-form');
const nameInput = document.getElementById('nameInput');
const valueInput = document.getElementById('valueInput');
const snippetList = document.getElementById('snippetList');
const emptyState = document.getElementById('emptyState');
const settingsButton = document.getElementById('settingsButton');
const settingsMenu = document.getElementById('settingsMenu');
const usageButton = document.getElementById('usageButton');
const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const importInput = document.getElementById('importInput');
const tabButtons = document.querySelectorAll('.qs-tab');
const panels = document.querySelectorAll('.qs-panel');
const usageOverlay = document.getElementById('usageOverlay');
const usageClose = document.getElementById('usageClose');
const toastRegion = document.getElementById('toastRegion');

let snippets = [];
let settingsOpen = false;
let usageOpen = false;
let activeTab = 'list';
let dragName = null;

init();

function init() {
  loadSnippets().then((items) => {
    snippets = items;
    renderList();
  });

  form.addEventListener('submit', handleSubmit);
  snippetList.addEventListener('click', handleListClick);
  snippetList.addEventListener('dragstart', handleDragStart);
  snippetList.addEventListener('dragover', handleDragOver);
  snippetList.addEventListener('drop', handleDrop);
  snippetList.addEventListener('dragend', handleDragEnd);
  settingsButton.addEventListener('click', toggleSettings);
  usageButton.addEventListener('click', () => {
    openUsageOverlay();
    closeSettings();
  });
  usageClose.addEventListener('click', closeUsageOverlay);
  usageOverlay.addEventListener('click', (event) => {
    if (event.target === usageOverlay) {
      closeUsageOverlay();
    }
  });
  exportButton.addEventListener('click', handleExport);
  importButton.addEventListener('click', () => importInput.click());
  importInput.addEventListener('change', handleImport);
  document.addEventListener('mousedown', handleDocumentClick, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (settingsOpen) closeSettings();
      if (usageOpen) closeUsageOverlay();
    }
  });
  tabButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveTab(button.dataset.tab));
  });
  setActiveTab('list');

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      snippets = changes[STORAGE_KEY].newValue || [];
      renderList();
    }
  });
}

async function handleSubmit(event) {
  event.preventDefault();

  const rawName = nameInput.value.trim();
  const rawValue = valueInput.value;

  if (!rawName) {
    return showToast('Name is required.', 'error');
  }

  if (!rawValue.trim()) {
    return showToast('Value is required.', 'error');
  }

  const duplicate = snippets.some((item) => item.name.toLowerCase() === rawName.toLowerCase());
  if (duplicate) {
    return showToast('Name must be unique.', 'error');
  }

  const next = [...snippets, { name: rawName, value: rawValue }];
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
  showToast('Snippet saved.', 'success');
}

async function handleListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, name } = button.dataset;
  if (!action || !name) return;

  const snippet = snippets.find((item) => item.name === name);
  if (!snippet) return;

  if (action === 'delete') {
    const next = snippets.filter((item) => item.name !== name);
    try {
      await persist(next);
      snippets = next;
      renderList();
      showToast(`Deleted ${name}.`, 'success');
    } catch (error) {
      console.error(error);
      showToast(`Failed to delete ${name}.`, 'error');
    }
    return;
  }

  if (action === 'copy') {
    try {
      await copyToClipboard(snippet.value);
      showToast(`Copied ${name}.`, 'success');
    } catch (error) {
      console.error(error);
      showToast('Failed to copy snippet.', 'error');
    }
  }
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
    li.dataset.name = item.name;
    li.setAttribute('draggable', 'true');

    const content = document.createElement('div');
    content.className = 'snippet-body';
    const title = document.createElement('strong');
    title.textContent = item.name;
    const preview = document.createElement('span');
    preview.textContent = summarize(item.value);
    content.appendChild(title);
    content.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'snippet-actions';

    const copyBtn = createIconButton('copy', item.name, `Copy ${item.name}`);
    const deleteBtn = createIconButton('delete', item.name, `Delete ${item.name}`);

    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);

    li.appendChild(content);
    li.appendChild(actions);
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
        showToast('Failed to save.', 'error');
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  settingsMenu.classList.toggle('is-open', settingsOpen);
  settingsMenu.setAttribute('aria-hidden', String(!settingsOpen));
}

function closeSettings() {
  settingsOpen = false;
  settingsButton.setAttribute('aria-expanded', 'false');
  settingsMenu.classList.remove('is-open');
  settingsMenu.setAttribute('aria-hidden', 'true');
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
    showToast('No snippets to export.', 'info');
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
  showToast('Exported snippets.', 'success');
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
      showToast('Invalid file.', 'error');
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
      showToast('Nothing to import.', 'info');
      return;
    }
    const next = Array.from(normalizedMap.entries()).map(([name, value]) => ({ name, value }));
    await persist(next);
    snippets = next;
    renderList();
    showToast('Imported snippets.', 'success');
    closeSettings();
  } catch (error) {
    console.error(error);
    showToast('Failed to import.', 'error');
  }
}

function setActiveTab(targetTab) {
  activeTab = targetTab || activeTab;
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  panels.forEach((panel) => {
    const matches = panel.dataset.panel === activeTab;
    panel.classList.toggle('is-hidden', !matches);
    panel.setAttribute('aria-hidden', String(!matches));
  });
}

function openUsageOverlay() {
  if (usageOpen) return;
  usageOpen = true;
  usageOverlay.classList.add('is-visible');
  usageOverlay.setAttribute('aria-hidden', 'false');
}

function closeUsageOverlay() {
  if (!usageOpen) return;
  usageOpen = false;
  usageOverlay.classList.remove('is-visible');
  usageOverlay.setAttribute('aria-hidden', 'true');
}

function handleDragStart(event) {
  const li = event.target.closest('li[data-name]');
  if (!li || event.target.closest('.snippet-actions')) {
    event.preventDefault();
    return;
  }
  dragName = li.dataset.name;
  li.classList.add('is-dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', dragName);
  }
}

function handleDragOver(event) {
  if (!dragName) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  const draggingEl = snippetList.querySelector('li.is-dragging');
  const target = event.target.closest('li[data-name]');
  if (!draggingEl || !target || target === draggingEl) {
    return;
  }
  const rect = target.getBoundingClientRect();
  const shouldInsertBefore = event.clientY < rect.top + rect.height / 2;
  if (shouldInsertBefore) {
    snippetList.insertBefore(draggingEl, target);
  } else {
    snippetList.insertBefore(draggingEl, target.nextSibling);
  }
}

async function handleDrop(event) {
  if (!dragName) return;
  event.preventDefault();
  const draggingEl = snippetList.querySelector('li.is-dragging');
  if (draggingEl) {
    draggingEl.classList.remove('is-dragging');
  }
  const orderedNames = Array.from(snippetList.querySelectorAll('li[data-name]')).map(
    (node) => node.dataset.name
  );
  const next = orderedNames
    .map((name) => snippets.find((item) => item.name === name))
    .filter(Boolean);
  dragName = null;
  if (!next.length) {
    renderList();
    return;
  }
  try {
    await persist(next);
    snippets = next;
  } catch (error) {
    console.error(error);
  }
  renderList();
}

function handleDragEnd() {
  const draggingEl = snippetList.querySelector('li.is-dragging');
  if (draggingEl) {
    draggingEl.classList.remove('is-dragging');
  }
  if (dragName) {
    dragName = null;
    renderList();
  }
}

function createIconButton(type, name, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `snippet-action snippet-action-${type}`;
  button.dataset.action = type;
  button.dataset.name = name;
  button.setAttribute('aria-label', label);
  button.innerHTML = ICONS[type] || '';
  return button;
}

async function copyToClipboard(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const successful = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!successful) {
    throw new Error('Copy command failed');
  }
}

function showToast(message, variant = 'info') {
  if (!toastRegion) return;
  const toast = document.createElement('div');
  toast.className = `qs-toast qs-toast-${variant}`;

  const text = document.createElement('span');
  text.className = 'qs-toast-message';
  text.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'qs-toast-close';
  closeBtn.setAttribute('aria-label', 'Close notification');
  closeBtn.textContent = '×';

  toast.appendChild(text);
  toast.appendChild(closeBtn);
  toastRegion.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('is-visible'));

  const hide = () => {
    toast.classList.remove('is-visible');
    toast.classList.add('is-hiding');
  };

  const timer = setTimeout(hide, 5000);
  closeBtn.addEventListener('click', () => {
    clearTimeout(timer);
    hide();
  });

  toast.addEventListener(
    'transitionend',
    (event) => {
      if (event.propertyName === 'transform' && !toast.classList.contains('is-visible')) {
        toast.remove();
      }
    },
    { once: false }
  );

  return message;
}
