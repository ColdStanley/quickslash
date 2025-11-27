const STORAGE_KEY = 'quickSlashSnippets';

const form = document.getElementById('snippet-form');
const nameInput = document.getElementById('nameInput');
const valueInput = document.getElementById('valueInput');
const formMessage = document.getElementById('formMessage');
const snippetList = document.getElementById('snippetList');
const emptyState = document.getElementById('emptyState');

let snippets = [];

init();

function init() {
  loadSnippets().then((items) => {
    snippets = items;
    renderList();
  });

  form.addEventListener('submit', handleSubmit);
  snippetList.addEventListener('click', handleListClick);

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
