const SNIPPETS_KEY = 'quickSlashSnippets';
const GROUPS_KEY = 'quickSlashGroups';
const DATA_VERSION = 2;
const UNGROUPED = 'ungrouped';
const RESERVED_GROUP_NAMES = new Set(['favorites', 'all', 'ungrouped']);
const MAX_VISIBLE_CUSTOM_GROUPS = 2;

const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" /></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>'
};

const elements = {
  appShell: document.querySelector('.app-shell'),
  createButton: document.getElementById('createButton'),
  settingsButton: document.getElementById('settingsButton'),
  settingsMenu: document.getElementById('settingsMenu'),
  groupsButton: document.getElementById('groupsButton'),
  usageButton: document.getElementById('usageButton'),
  exportButton: document.getElementById('exportButton'),
  importButton: document.getElementById('importButton'),
  importInput: document.getElementById('importInput'),
  listView: document.getElementById('listView'),
  editorView: document.getElementById('editorView'),
  groupsView: document.getElementById('groupsView'),
  groupNav: document.getElementById('groupNav'),
  snippetList: document.getElementById('snippetList'),
  emptyState: document.getElementById('emptyState'),
  snippetForm: document.getElementById('snippetForm'),
  editorTitle: document.getElementById('editorTitle'),
  nameInput: document.getElementById('nameInput'),
  valueInput: document.getElementById('valueInput'),
  groupInput: document.getElementById('groupInput'),
  favoriteInput: document.getElementById('favoriteInput'),
  groupForm: document.getElementById('groupForm'),
  groupNameInput: document.getElementById('groupNameInput'),
  groupList: document.getElementById('groupList'),
  usageOverlay: document.getElementById('usageOverlay'),
  usageClose: document.getElementById('usageClose'),
  confirmOverlay: document.getElementById('confirmOverlay'),
  confirmTitle: document.getElementById('confirmTitle'),
  confirmMessage: document.getElementById('confirmMessage'),
  confirmCancel: document.getElementById('confirmCancel'),
  confirmAccept: document.getElementById('confirmAccept'),
  toastRegion: document.getElementById('toastRegion')
};

let snippets = [];
let groups = [];
let activeFilter = 'favorites';
let activeView = 'list';
let editingId = null;
let editingGroupId = null;
let openMenuId = null;
let settingsOpen = false;
let confirmAction = null;
let focusReturnTarget = null;
let menuReturnId = null;
let usageReturnTarget = null;

init();

async function init() {
  bindEvents();
  const data = await loadAndMigrate();
  snippets = data.snippets;
  groups = data.groups;
  render();
}

function bindEvents() {
  elements.createButton.addEventListener('click', () => openEditor());
  elements.settingsButton.addEventListener('click', toggleSettings);
  elements.groupsButton.addEventListener('click', () => {
    closeSettings();
    openView('groups');
  });
  elements.usageButton.addEventListener('click', () => {
    usageReturnTarget = elements.usageButton;
    closeSettings();
    elements.appShell.inert = true;
    elements.appShell.setAttribute('aria-hidden', 'true');
    elements.usageOverlay.classList.add('is-visible');
    elements.usageOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => elements.usageClose.focus());
  });
  elements.usageClose.addEventListener('click', closeUsage);
  elements.usageOverlay.addEventListener('click', (event) => {
    if (event.target === elements.usageOverlay) closeUsage();
  });
  elements.confirmCancel.addEventListener('click', closeConfirm);
  elements.confirmAccept.addEventListener('click', handleConfirmAccept);
  elements.confirmOverlay.addEventListener('click', (event) => {
    if (event.target === elements.confirmOverlay) closeConfirm();
  });
  elements.exportButton.addEventListener('click', handleExport);
  elements.importButton.addEventListener('click', () => elements.importInput.click());
  elements.importInput.addEventListener('change', handleImport);
  elements.groupNav.addEventListener('click', handleNavClick);
  elements.snippetList.addEventListener('click', handleSnippetClick);
  elements.snippetList.addEventListener('change', handleSnippetChange);
  elements.snippetForm.addEventListener('submit', handleSnippetSubmit);
  elements.groupForm.addEventListener('submit', handleGroupSubmit);
  elements.groupList.addEventListener('click', handleGroupClick);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', handleKeydown);
  document.querySelectorAll('[data-action="close-view"]').forEach((button) => {
    button.addEventListener('click', () => openView('list'));
  });
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || (!changes[SNIPPETS_KEY] && !changes[GROUPS_KEY])) return;
    const data = await loadAndMigrate(false);
    snippets = data.snippets;
    groups = data.groups;
    ensureValidFilter();
    render();
  });
}

async function loadAndMigrate(shouldPersist = true) {
  const stored = await storageGet({ [SNIPPETS_KEY]: [], [GROUPS_KEY]: [] });
  const normalizedGroups = normalizeGroups(stored[GROUPS_KEY]);
  const validGroupIds = new Set(normalizedGroups.map((group) => group.id));
  const normalizedSnippets = normalizeSnippets(stored[SNIPPETS_KEY], validGroupIds);
  const changed = JSON.stringify(stored[GROUPS_KEY]) !== JSON.stringify(normalizedGroups)
    || JSON.stringify(stored[SNIPPETS_KEY]) !== JSON.stringify(normalizedSnippets);
  if (shouldPersist && changed) {
    await persistData(normalizedSnippets, normalizedGroups);
  }
  return { snippets: normalizedSnippets, groups: normalizedGroups };
}

function normalizeGroups(input) {
  if (!Array.isArray(input)) return [];
  const seenIds = new Set();
  const seenNames = new Set();
  const result = [];
  for (const item of input) {
    if (!item || typeof item.name !== 'string') continue;
    const name = item.name.trim().slice(0, 30);
    const key = name.toLowerCase();
    if (!name || RESERVED_GROUP_NAMES.has(key) || seenNames.has(key)) continue;
    const id = typeof item.id === 'string' && item.id.trim() && !seenIds.has(item.id)
      ? item.id
      : createId();
    seenIds.add(id);
    seenNames.add(key);
    result.push({ id, name });
  }
  return result;
}

function normalizeSnippets(input, validGroupIds) {
  if (!Array.isArray(input)) return [];
  const seenNames = new Set();
  const seenIds = new Set();
  const result = [];
  for (const item of input) {
    if (!item || typeof item.name !== 'string' || typeof item.value !== 'string') continue;
    const name = item.name.trim().slice(0, 80);
    const nameKey = name.toLowerCase();
    if (!name || !item.value.trim() || seenNames.has(nameKey)) continue;
    const id = typeof item.id === 'string' && item.id.trim() && !seenIds.has(item.id)
      ? item.id
      : createId();
    const groupId = typeof item.groupId === 'string' && validGroupIds.has(item.groupId)
      ? item.groupId
      : null;
    seenIds.add(id);
    seenNames.add(nameKey);
    result.push({
      id,
      name,
      value: item.value,
      groupId,
      favorite: item.favorite === true
    });
  }
  return result;
}

function render() {
  renderGroupNav();
  renderList();
  renderGroupOptions();
  renderGroups();
}

function renderGroupNav() {
  elements.groupNav.innerHTML = '';
  const customGroups = getVisibleCustomGroups();
  appendFilterButton('favorites', 'Favorites');
  customGroups.forEach((group) => appendFilterButton(group.id, group.name));

  const hiddenGroups = groups.filter((group) => !customGroups.some((visible) => visible.id === group.id));
  if (hiddenGroups.length) {
    const wrap = document.createElement('div');
    wrap.className = 'nav-more-wrap';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-chip';
    button.dataset.navMore = 'true';
    button.textContent = 'More';
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'menu nav-more-menu';
    menu.dataset.moreMenu = 'true';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'More groups');
    hiddenGroups.forEach((group) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.dataset.filter = group.id;
      item.textContent = group.name;
      item.setAttribute('role', 'menuitem');
      menu.appendChild(item);
    });
    wrap.append(button, menu);
    elements.groupNav.appendChild(wrap);
  }

  appendFilterButton('all', 'All');
  appendFilterButton(UNGROUPED, 'Ungrouped');
}

function getVisibleCustomGroups() {
  const selected = groups.find((group) => group.id === activeFilter);
  const visible = selected ? [selected] : [];
  for (const group of groups) {
    if (visible.length >= MAX_VISIBLE_CUSTOM_GROUPS) break;
    if (!visible.some((item) => item.id === group.id)) visible.push(group);
  }
  return visible;
}

function appendFilterButton(filter, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'group-chip';
  button.dataset.filter = filter;
  button.textContent = label;
  button.title = label;
  button.classList.toggle('is-active', activeFilter === filter);
  elements.groupNav.appendChild(button);
}

function renderList() {
  const filtered = getFilteredSnippets();
  elements.snippetList.innerHTML = '';
  elements.emptyState.hidden = filtered.length > 0;
  elements.emptyState.textContent = getEmptyMessage();

  filtered.forEach((snippet) => {
    const li = document.createElement('li');
    li.className = 'snippet-card';
    li.dataset.id = snippet.id;
    li.classList.toggle('is-menu-open', openMenuId === snippet.id);

    const body = document.createElement('button');
    body.type = 'button';
    body.className = 'snippet-body';
    body.dataset.action = 'edit';
    body.dataset.id = snippet.id;
    const title = document.createElement('strong');
    title.textContent = snippet.name;
    const preview = document.createElement('span');
    preview.textContent = summarize(snippet.value);
    const meta = document.createElement('small');
    meta.textContent = getGroupName(snippet.groupId);
    body.append(title, preview, meta);

    const actions = document.createElement('div');
    actions.className = 'snippet-actions';
    actions.append(
      createIconButton('copy', snippet, `Copy ${snippet.name}`),
      createIconButton('menu', snippet, `More actions for ${snippet.name}`)
    );

    if (openMenuId === snippet.id) {
      actions.appendChild(createSnippetMenu(snippet));
    }
    li.append(body, actions);
    elements.snippetList.appendChild(li);
  });
}

function createIconButton(action, snippet, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'card-icon';
  button.dataset.action = action;
  button.dataset.id = snippet.id;
  button.setAttribute('aria-label', label);
  button.title = label;
  if (action === 'menu') {
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', String(openMenuId === snippet.id));
  }
  button.innerHTML = action === 'copy' ? ICONS.copy : ICONS.more;
  return button;
}

function createSnippetMenu(snippet) {
  const menu = document.createElement('div');
  menu.className = 'menu snippet-menu is-open';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', `Actions for ${snippet.name}`);
  const favorite = menuButton(
    snippet.favorite ? 'Remove from Favorites' : 'Add to Favorites',
    'favorite',
    snippet.id
  );
  favorite.setAttribute('role', 'menuitem');
  const edit = menuButton('Edit', 'edit', snippet.id);
  edit.setAttribute('role', 'menuitem');
  const moveLabel = document.createElement('label');
  moveLabel.className = 'move-control';
  const moveText = document.createElement('span');
  moveText.textContent = 'Move to';
  const select = document.createElement('select');
  select.dataset.action = 'move';
  select.dataset.id = snippet.id;
  select.appendChild(new Option('Ungrouped', UNGROUPED));
  groups.forEach((group) => select.appendChild(new Option(group.name, group.id)));
  select.value = snippet.groupId || UNGROUPED;
  moveLabel.append(moveText, select);
  const remove = menuButton('Delete', 'delete', snippet.id);
  remove.classList.add('danger-item');
  remove.setAttribute('role', 'menuitem');
  menu.append(favorite, edit, moveLabel, remove);
  return menu;
}

function menuButton(label, action, id) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.action = action;
  button.dataset.id = id;
  return button;
}

function renderGroupOptions() {
  const selected = elements.groupInput.value;
  elements.groupInput.innerHTML = '';
  elements.groupInput.appendChild(new Option('Ungrouped', UNGROUPED));
  groups.forEach((group) => elements.groupInput.appendChild(new Option(group.name, group.id)));
  if ([UNGROUPED, ...groups.map((group) => group.id)].includes(selected)) {
    elements.groupInput.value = selected;
  }
}

function renderGroups() {
  elements.groupList.innerHTML = '';
  if (!groups.length) {
    const empty = document.createElement('li');
    empty.className = 'group-empty';
    empty.textContent = 'No custom groups yet.';
    elements.groupList.appendChild(empty);
    return;
  }
  groups.forEach((group) => {
    const li = document.createElement('li');
    li.dataset.id = group.id;
    if (editingGroupId === group.id) {
      li.className = 'group-edit-row';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = group.name;
      input.maxLength = 30;
      input.dataset.groupEditInput = group.id;
      input.setAttribute('aria-label', `Rename ${group.name}`);
      const actions = document.createElement('div');
      actions.append(menuButton('Cancel', 'cancel-rename', group.id), menuButton('Save', 'save-rename', group.id));
      li.append(input, actions);
      elements.groupList.appendChild(li);
      requestAnimationFrame(() => input.focus());
      return;
    }
    const info = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = group.name;
    const count = document.createElement('span');
    const total = snippets.filter((snippet) => snippet.groupId === group.id).length;
    count.textContent = `${total} ${total === 1 ? 'snippet' : 'snippets'}`;
    info.append(name, count);
    const actions = document.createElement('div');
    actions.append(menuButton('Rename', 'rename-group', group.id), menuButton('Delete', 'delete-group', group.id));
    li.append(info, actions);
    elements.groupList.appendChild(li);
  });
}

function handleNavClick(event) {
  const moreButton = event.target.closest('[data-nav-more]');
  if (moreButton) {
    const menu = elements.groupNav.querySelector('[data-more-menu]');
    const isOpen = menu?.classList.toggle('is-open') || false;
    moreButton.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      requestAnimationFrame(() => menu.querySelector('button')?.focus());
    }
    return;
  }
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  activeFilter = button.dataset.filter;
  openMenuId = null;
  renderGroupNav();
  renderList();
}

async function handleSnippetClick(event) {
  const button = event.target.closest('[data-action][data-id]');
  if (!button) return;
  const snippet = snippets.find((item) => item.id === button.dataset.id);
  if (!snippet) return;
  const action = button.dataset.action;

  if (action === 'menu') {
    menuReturnId = snippet.id;
    openMenuId = openMenuId === snippet.id ? null : snippet.id;
    renderList();
    if (openMenuId) {
      requestAnimationFrame(() => {
        positionSnippetMenu(snippet.id);
        getSnippetCard(snippet.id)?.querySelector('.snippet-menu button')?.focus();
      });
    } else {
      requestAnimationFrame(() => getSnippetCard(snippet.id)?.querySelector('[data-action="menu"]')?.focus());
      menuReturnId = null;
    }
    return;
  }
  if (action === 'edit') {
    openEditor(snippet);
    return;
  }
  if (action === 'favorite') {
    snippet.favorite = !snippet.favorite;
    await saveCurrentData();
    showToast(snippet.favorite ? 'Added to Favorites.' : 'Removed from Favorites.');
    return;
  }
  if (action === 'copy') {
    try {
      await copyToClipboard(snippet.value);
      showToast(`Copied ${snippet.name}.`);
    } catch (error) {
      console.error(error);
      showToast('Failed to copy snippet.', 'error');
    }
    return;
  }
  if (action === 'delete') {
    openMenuId = null;
    renderList();
    openConfirm({
      title: 'Delete snippet?',
      message: `"${snippet.name}" will be permanently removed.`,
      acceptLabel: 'Delete',
      returnTarget: getSnippetCard(snippet.id)?.querySelector('[data-action="menu"]'),
      onAccept: async () => {
        snippets = snippets.filter((item) => item.id !== snippet.id);
        openMenuId = null;
        await saveCurrentData();
        showToast('Snippet deleted.');
      }
    });
  }
}

async function handleSnippetChange(event) {
  const select = event.target.closest('select[data-action="move"]');
  if (!select) return;
  const snippet = snippets.find((item) => item.id === select.dataset.id);
  if (!snippet) return;
  snippet.groupId = select.value === UNGROUPED ? null : select.value;
  openMenuId = null;
  await saveCurrentData();
  showToast(`Moved to ${getGroupName(snippet.groupId)}.`);
}

function openEditor(snippet = null) {
  editingId = snippet?.id || null;
  elements.editorTitle.textContent = snippet ? 'Edit snippet' : 'Create snippet';
  elements.snippetForm.reset();
  renderGroupOptions();
  elements.nameInput.value = snippet?.name || '';
  elements.valueInput.value = snippet?.value || '';
  elements.groupInput.value = snippet?.groupId || UNGROUPED;
  elements.favoriteInput.checked = snippet?.favorite || false;
  openView('editor');
  elements.nameInput.focus();
}

async function handleSnippetSubmit(event) {
  event.preventDefault();
  const name = elements.nameInput.value.trim();
  const value = elements.valueInput.value;
  if (!name) return showToast('Name is required.', 'error');
  if (!value.trim()) return showToast('Value is required.', 'error');
  const duplicate = snippets.some((item) => item.id !== editingId && item.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return showToast('Name must be unique.', 'error');

  const snippet = editingId ? snippets.find((item) => item.id === editingId) : null;
  const next = {
    id: snippet?.id || createId(),
    name,
    value,
    groupId: elements.groupInput.value === UNGROUPED ? null : elements.groupInput.value,
    favorite: elements.favoriteInput.checked
  };
  if (snippet) {
    Object.assign(snippet, next);
  } else {
    snippets.push(next);
  }
  await saveCurrentData();
  openView('list');
  showToast(snippet ? 'Snippet updated.' : 'Snippet created.');
}

async function handleGroupSubmit(event) {
  event.preventDefault();
  const name = elements.groupNameInput.value.trim();
  const error = validateGroupName(name);
  if (error) return showToast(error, 'error');
  groups.push({ id: createId(), name });
  elements.groupForm.reset();
  await saveCurrentData();
  elements.groupNameInput.focus();
  showToast('Group created.');
}

async function handleGroupClick(event) {
  const button = event.target.closest('[data-action][data-id]');
  if (!button) return;
  const group = groups.find((item) => item.id === button.dataset.id);
  if (!group) return;
  if (button.dataset.action === 'rename-group') {
    editingGroupId = group.id;
    renderGroups();
    return;
  }
  if (button.dataset.action === 'cancel-rename') {
    editingGroupId = null;
    renderGroups();
    return;
  }
  if (button.dataset.action === 'save-rename') {
    const input = elements.groupList.querySelector(`[data-group-edit-input="${group.id}"]`);
    const name = input?.value.trim() || '';
    const error = validateGroupName(name, group.id);
    if (error) return showToast(error, 'error');
    group.name = name;
    editingGroupId = null;
    await saveCurrentData();
    showToast('Group renamed.');
    return;
  }
  if (button.dataset.action === 'delete-group') {
    const count = snippets.filter((snippet) => snippet.groupId === group.id).length;
    const message = count
      ? `"${group.name}" will be removed. Its ${count} ${count === 1 ? 'snippet' : 'snippets'} will move to Ungrouped.`
      : `"${group.name}" will be removed.`;
    openConfirm({
      title: 'Delete group?',
      message,
      acceptLabel: 'Delete group',
      onAccept: async () => {
        snippets.forEach((snippet) => {
          if (snippet.groupId === group.id) snippet.groupId = null;
        });
        groups = groups.filter((item) => item.id !== group.id);
        editingGroupId = null;
        if (activeFilter === group.id) activeFilter = UNGROUPED;
        await saveCurrentData();
        showToast('Group deleted.');
      }
    });
  }
}

function validateGroupName(name, excludeId = null) {
  if (!name) return 'Group name is required.';
  if (name.length > 30) return 'Group name must be 30 characters or fewer.';
  if (RESERVED_GROUP_NAMES.has(name.toLowerCase())) return 'This group name is reserved.';
  if (groups.some((group) => group.id !== excludeId && group.name.toLowerCase() === name.toLowerCase())) {
    return 'Group name must be unique.';
  }
  return '';
}

function openView(view) {
  activeView = view;
  elements.listView.hidden = view !== 'list';
  elements.editorView.hidden = view !== 'editor';
  elements.groupsView.hidden = view !== 'groups';
  elements.createButton.disabled = view === 'editor';
  openMenuId = null;
  if (view === 'list') {
    editingId = null;
    editingGroupId = null;
    render();
  } else if (view === 'groups') {
    renderGroups();
    elements.groupNameInput.focus();
  }
}

function getFilteredSnippets() {
  if (activeFilter === 'favorites') return snippets.filter((snippet) => snippet.favorite);
  if (activeFilter === 'all') return snippets;
  if (activeFilter === UNGROUPED) return snippets.filter((snippet) => !snippet.groupId);
  return snippets.filter((snippet) => snippet.groupId === activeFilter);
}

function getEmptyMessage() {
  if (activeFilter === 'favorites') return 'No favorites yet. Use the star to keep important snippets here.';
  if (activeFilter === 'all') return 'No snippets yet. Create your first one.';
  if (activeFilter === UNGROUPED) return 'No ungrouped snippets.';
  return 'No snippets in this group.';
}

function getGroupName(groupId) {
  return groups.find((group) => group.id === groupId)?.name || 'Ungrouped';
}

function ensureValidFilter() {
  if (['favorites', 'all', UNGROUPED].includes(activeFilter)) return;
  if (!groups.some((group) => group.id === activeFilter)) activeFilter = 'favorites';
}

async function saveCurrentData() {
  await persistData(snippets, groups);
  ensureValidFilter();
  render();
}

async function persistData(nextSnippets, nextGroups) {
  await storageSet({ [SNIPPETS_KEY]: nextSnippets, [GROUPS_KEY]: nextGroups });
}

function handleExport() {
  const payload = {
    version: DATA_VERSION,
    exportedAt: new Date().toISOString(),
    groups,
    snippets
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'quickslash-snippets.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  closeSettings();
  showToast('Export complete.');
}

async function handleImport(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const rawSnippets = Array.isArray(parsed) ? parsed : parsed?.snippets;
    if (!Array.isArray(rawSnippets)) return showToast('This file is not a valid QuickSlash export.', 'error');
    if (!confirm('Importing will replace all current snippets and groups. Continue?')) return;
    const importedGroups = normalizeGroups(Array.isArray(parsed?.groups) ? parsed.groups : []);
    const groupIds = new Set(importedGroups.map((group) => group.id));
    const importedSnippets = normalizeSnippets(rawSnippets, groupIds);
    snippets = importedSnippets;
    groups = importedGroups;
    activeFilter = 'favorites';
    await persistData(snippets, groups);
    openView('list');
    closeSettings();
    showToast('Import complete.');
  } catch (error) {
    console.error(error);
    showToast('Failed to import this file.', 'error');
  }
}

function toggleSettings() {
  settingsOpen = !settingsOpen;
  elements.settingsMenu.classList.toggle('is-open', settingsOpen);
  elements.settingsMenu.setAttribute('aria-hidden', String(!settingsOpen));
  elements.settingsButton.setAttribute('aria-expanded', String(settingsOpen));
  if (settingsOpen) {
    requestAnimationFrame(() => elements.settingsMenu.querySelector('button')?.focus());
  }
}

function closeSettings() {
  settingsOpen = false;
  elements.settingsMenu.classList.remove('is-open');
  elements.settingsMenu.setAttribute('aria-hidden', 'true');
  elements.settingsButton.setAttribute('aria-expanded', 'false');
}

function closeUsage() {
  if (!elements.usageOverlay.classList.contains('is-visible')) return;
  elements.usageOverlay.classList.remove('is-visible');
  elements.usageOverlay.setAttribute('aria-hidden', 'true');
  elements.appShell.inert = false;
  elements.appShell.removeAttribute('aria-hidden');
  const target = usageReturnTarget;
  usageReturnTarget = null;
  requestAnimationFrame(() => target?.isConnected && target.focus());
}

function openConfirm({ title, message, acceptLabel, onAccept, returnTarget = document.activeElement }) {
  focusReturnTarget = returnTarget;
  confirmAction = onAccept;
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  elements.confirmAccept.textContent = acceptLabel;
  elements.appShell.inert = true;
  elements.appShell.setAttribute('aria-hidden', 'true');
  elements.confirmOverlay.classList.add('is-visible');
  elements.confirmOverlay.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => elements.confirmCancel.focus());
}

function closeConfirm({ restoreFocus = true } = {}) {
  if (!elements.confirmOverlay.classList.contains('is-visible')) return;
  elements.confirmOverlay.classList.remove('is-visible');
  elements.confirmOverlay.setAttribute('aria-hidden', 'true');
  elements.appShell.inert = false;
  elements.appShell.removeAttribute('aria-hidden');
  confirmAction = null;
  const target = focusReturnTarget;
  focusReturnTarget = null;
  if (restoreFocus) {
    requestAnimationFrame(() => target?.isConnected && target.focus());
  }
}

async function handleConfirmAccept() {
  const action = confirmAction;
  closeConfirm({ restoreFocus: false });
  if (action) await action();
}

function positionSnippetMenu(snippetId) {
  const card = getSnippetCard(snippetId);
  const menu = card?.querySelector('.snippet-menu');
  const trigger = card?.querySelector('[data-action="menu"]');
  if (!menu || !trigger) return;
  menu.classList.remove('opens-up');
  const menuRect = menu.getBoundingClientRect();
  const triggerRect = trigger.getBoundingClientRect();
  const spaceBelow = window.innerHeight - triggerRect.bottom;
  const spaceAbove = triggerRect.top;
  if (spaceBelow < menuRect.height + 12 && spaceAbove > spaceBelow) {
    menu.classList.add('opens-up');
  }
}

function getSnippetCard(snippetId) {
  return Array.from(elements.snippetList.querySelectorAll('li[data-id]'))
    .find((item) => item.dataset.id === snippetId);
}

function handleDocumentClick(event) {
  if (settingsOpen && !elements.settingsMenu.contains(event.target) && !elements.settingsButton.contains(event.target)) {
    closeSettings();
  }
  if (!event.target.closest('.snippet-actions')) {
    if (openMenuId) {
      openMenuId = null;
      renderList();
      menuReturnId = null;
    }
  }
  if (!event.target.closest('.nav-more-wrap')) {
    elements.groupNav.querySelector('[data-more-menu]')?.classList.remove('is-open');
    elements.groupNav.querySelector('[data-nav-more]')?.setAttribute('aria-expanded', 'false');
  }
}

function handleKeydown(event) {
  const activeMenu = document.activeElement?.closest?.('.menu.is-open');
  if (activeMenu && document.activeElement.tagName !== 'SELECT' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    const items = Array.from(activeMenu.querySelectorAll('button:not([disabled])'));
    const currentIndex = items.indexOf(document.activeElement);
    if (items.length && currentIndex >= 0) {
      event.preventDefault();
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length;
      if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = items.length - 1;
      items[nextIndex].focus();
      return;
    }
  }
  if (elements.confirmOverlay.classList.contains('is-visible')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeConfirm();
    } else if (event.key === 'Tab') {
      trapFocus(event, elements.confirmOverlay);
    }
    return;
  }
  if (elements.usageOverlay.classList.contains('is-visible')) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeUsage();
    } else if (event.key === 'Tab') {
      trapFocus(event, elements.usageOverlay);
    }
    return;
  }
  if (event.key === 'Escape') {
    if (openMenuId) {
      event.preventDefault();
      const snippetId = menuReturnId || openMenuId;
      openMenuId = null;
      renderList();
      menuReturnId = null;
      requestAnimationFrame(() => getSnippetCard(snippetId)?.querySelector('[data-action="menu"]')?.focus());
      return;
    }
    if (settingsOpen) {
      event.preventDefault();
      closeSettings();
      elements.settingsButton.focus();
      return;
    }
    const moreMenu = elements.groupNav.querySelector('[data-more-menu].is-open');
    if (moreMenu) {
      event.preventDefault();
      moreMenu.classList.remove('is-open');
      const trigger = elements.groupNav.querySelector('[data-nav-more]');
      trigger?.setAttribute('aria-expanded', 'false');
      trigger?.focus();
      return;
    }
    if (activeView !== 'list') openView('list');
  }
}

function trapFocus(event, container) {
  const focusable = Array.from(container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function summarize(value) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 92 ? `${text.slice(0, 89)}...` : text;
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `qs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('Copy failed');
}

function showToast(message, variant = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${variant}`;
  toast.textContent = message;
  elements.toastRegion.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 180);
  }, 2600);
}
