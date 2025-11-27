(() => {
  const STORAGE_KEY = 'quickSlashSnippets';
  const TRIGGER = '///';
  const TRIGGER_LENGTH = TRIGGER.length;

  const state = {
    snippets: [],
    context: null
  };

  const panel = createPanel(handlePanelSelection);

  loadSnippets();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      state.snippets = changes[STORAGE_KEY].newValue || [];
      if (!state.snippets.length) {
        hidePanel();
      } else if (panel.isOpen) {
        panel.render(state.snippets);
      }
    }
  });

  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  window.addEventListener('resize', () => hidePanel());
  window.addEventListener('scroll', () => hidePanel(), true);

  function handleInput(event) {
    const target = event.target;
    if (!isEditable(target)) {
      hidePanel();
      return;
    }

    if (!state.snippets.length) {
      return;
    }

    const context = createTriggerContext(target);
    if (context) {
      showPanel(context);
    } else if (state.context && state.context.target === target) {
      hidePanel();
    }
  }

  function handleKeydown(event) {
    if (!panel.isOpen) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      panel.move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      panel.move(-1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      panel.commit();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      hidePanel();
    }
  }

  function handlePointerDown(event) {
    if (!panel.isOpen) {
      return;
    }

    if (!panel.contains(event.target)) {
      hidePanel();
    }
  }

  function handleFocusIn(event) {
    if (!isEditable(event.target)) {
      hidePanel();
      return;
    }

    if (panel.isOpen && state.context && event.target !== state.context.target) {
      hidePanel();
    }
  }

  function handleSelectionChange() {
    if (!panel.isOpen || !state.context) return;
    if (state.context.type !== 'contenteditable') return;
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount) {
      hidePanel();
      return;
    }
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !state.context.target.contains(anchorNode)) {
      hidePanel();
      return;
    }
    if (!state.context.isValid()) {
      hidePanel();
    }
  }

  function loadSnippets() {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }, (result) => {
      state.snippets = result[STORAGE_KEY] || [];
    });
  }

  function createTriggerContext(target) {
    if (target instanceof HTMLTextAreaElement || isTextInput(target)) {
      return createTextContext(target);
    }

    if (target.isContentEditable) {
      return createContentEditableContext(target);
    }

    return null;
  }

  function createTextContext(target) {
    if (target.readOnly || target.disabled) {
      return null;
    }

    const caret = target.selectionStart;
    if (caret === null || caret < TRIGGER_LENGTH) {
      return null;
    }

    if (target.value.slice(caret - TRIGGER_LENGTH, caret) !== TRIGGER) {
      return null;
    }

    const start = caret - TRIGGER_LENGTH;
    return {
      type: 'text',
      target,
      isValid() {
        return target.value.slice(start, start + TRIGGER_LENGTH) === TRIGGER;
      },
      getRect() {
        return getInputCaretRect(target, caret) || target.getBoundingClientRect();
      },
      insert(value) {
        const before = target.value.slice(0, start);
        const after = target.value.slice(start + TRIGGER_LENGTH);
        const nextValue = `${before}${value}${after}`;
        target.value = nextValue;
        const position = before.length + value.length;
        target.setSelectionRange(position, position);
        const inputEvent = new Event('input', { bubbles: true });
        target.dispatchEvent(inputEvent);
      }
    };
  }

  function createContentEditableContext(target) {
    if (!target.isContentEditable) return null;
    const selection = document.getSelection();
    if (!selection || !selection.rangeCount) {
      return null;
    }

    const originalRange = selection.getRangeAt(0).cloneRange();
    originalRange.collapse(false);
    if (!target.contains(originalRange.startContainer)) {
      return null;
    }

    if (typeof selection.modify !== 'function') {
      return null;
    }

    const tempRange = originalRange.cloneRange();
    selection.removeAllRanges();
    selection.addRange(tempRange);
    for (let i = 0; i < TRIGGER_LENGTH; i += 1) {
      selection.modify('extend', 'backward', 'character');
    }
    const triggerRange = selection.getRangeAt(0).cloneRange();
    const triggerText = triggerRange.toString();
    selection.removeAllRanges();
    selection.addRange(originalRange);

    if (triggerText !== TRIGGER) {
      return null;
    }

    return {
      type: 'contenteditable',
      target,
      range: triggerRange,
      isValid() {
        return this.range.toString() === TRIGGER;
      },
      getRect() {
        const rect = this.range.getBoundingClientRect();
        if (rect && rect.width && rect.height) {
          return rect;
        }
        return target.getBoundingClientRect();
      },
      insert(value) {
        const range = this.range.cloneRange();
        range.deleteContents();
        const textNode = document.createTextNode(value);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.collapse(true);
        const selection = document.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        const inputEvent = typeof InputEvent === 'function'
          ? new InputEvent('input', { bubbles: true, data: value })
          : new Event('input', { bubbles: true });
        target.dispatchEvent(inputEvent);
      }
    };
  }

  function showPanel(context) {
    state.context = context;
    const rect = context.getRect();
    if (!rect) {
      hidePanel();
      return;
    }
    panel.open(state.snippets, rect);
  }

  function hidePanel() {
    state.context = null;
    panel.close();
  }

  function handlePanelSelection(index) {
    if (!state.context) {
      return;
    }
    const snippet = state.snippets[index];
    if (!snippet) {
      return;
    }
    state.context.insert(snippet.value);
    hidePanel();
  }

  function isEditable(element) {
    return Boolean(element) && (element instanceof HTMLTextAreaElement || isTextInput(element) || element.isContentEditable);
  }

  function isTextInput(element) {
    if (!(element instanceof HTMLInputElement)) {
      return false;
    }
    const disallowed = new Set([
      'button', 'checkbox', 'color', 'date', 'datetime-local', 'file', 'hidden', 'image',
      'month', 'number', 'radio', 'range', 'reset', 'submit', 'time', 'week'
    ]);
    const type = (element.type || 'text').toLowerCase();
    return !element.readOnly && !element.disabled && !disallowed.has(type);
  }

  function createPanel(onSelect) {
    injectStyles();
    const root = document.createElement('div');
    root.id = 'qs-snippet-panel';
    root.hidden = true;

    const list = document.createElement('div');
    list.className = 'qs-snippet-options';
    root.appendChild(list);

    document.documentElement.appendChild(root);

    let items = [];
    let highlightIndex = 0;

    root.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });

    root.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-index]');
      if (!button) return;
      const index = Number(button.dataset.index);
      onSelect(index);
    });

    root.addEventListener('mousemove', (event) => {
      const button = event.target.closest('button[data-index]');
      if (!button) return;
      const index = Number(button.dataset.index);
      highlightIndex = index;
      updateHighlight();
    });

    return {
      get isOpen() {
        return !root.hidden;
      },
      open(nextItems, rect) {
        items = nextItems;
        highlightIndex = 0;
        this.render(items);
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const baseLeft = Number.isFinite(rect.left) ? rect.left : 16;
        const baseTop = Number.isFinite(rect.bottom) ? rect.bottom : 32;
        const left = Math.min(Math.max(8, baseLeft), viewportWidth - 280);
        const top = Math.min(baseTop + 6, viewportHeight - 10);
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.hidden = false;
      },
      close() {
        root.hidden = true;
        items = [];
      },
      move(delta) {
        if (!items.length) return;
        highlightIndex = (highlightIndex + delta + items.length) % items.length;
        updateHighlight();
      },
      commit() {
        if (!items.length) return;
        onSelect(highlightIndex);
      },
      contains(node) {
        return root.contains(node);
      },
      render(nextItems) {
        items = nextItems;
        list.innerHTML = '';
        if (!items.length) {
          root.hidden = true;
          return;
        }
        highlightIndex = Math.min(highlightIndex, Math.max(items.length - 1, 0));
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.index = String(i);
          button.className = 'qs-snippet-item';

          const name = document.createElement('span');
          name.className = 'qs-snippet-name';
          name.textContent = item.name;

          const value = document.createElement('span');
          value.className = 'qs-snippet-value';
          const preview = item.value.replace(/\s+/g, ' ').trim();
          value.textContent = preview.length > 80 ? `${preview.slice(0, 77)}...` : preview;

          button.appendChild(name);
          button.appendChild(value);
          list.appendChild(button);
        }
        updateHighlight();
      }
    };

    function updateHighlight() {
      const buttons = list.querySelectorAll('button');
      buttons.forEach((btn, index) => {
        if (index === highlightIndex) {
          btn.classList.add('qs-active');
        } else {
          btn.classList.remove('qs-active');
        }
      });
    }
  }

  function getInputCaretRect(target, position) {
    try {
      const style = window.getComputedStyle(target);
      const isTextArea = target instanceof HTMLTextAreaElement;
      const mirror = document.createElement('div');
      mirror.setAttribute('aria-hidden', 'true');
      const properties = [
        'boxSizing',
        'width',
        'height',
        'fontFamily',
        'fontSize',
        'fontWeight',
        'fontStyle',
        'letterSpacing',
        'textTransform',
        'textAlign',
        'paddingTop',
        'paddingRight',
        'paddingBottom',
        'paddingLeft',
        'borderTopWidth',
        'borderRightWidth',
        'borderBottomWidth',
        'borderLeftWidth',
        'lineHeight'
      ];
      properties.forEach((prop) => {
        mirror.style[prop] = style[prop];
      });
      mirror.style.width = `${target.clientWidth}px`;
      mirror.style.height = `${target.clientHeight}px`;
      mirror.style.position = 'absolute';
      const targetRect = target.getBoundingClientRect();
      mirror.style.left = `${targetRect.left + window.scrollX}px`;
      mirror.style.top = `${targetRect.top + window.scrollY}px`;
      mirror.style.whiteSpace = isTextArea ? 'pre-wrap' : 'pre';
      mirror.style.wordBreak = isTextArea ? 'break-word' : 'normal';
      mirror.style.visibility = 'hidden';
      mirror.style.pointerEvents = 'none';
      mirror.style.overflow = 'auto';
      mirror.style.borderStyle = 'solid';
      mirror.style.borderColor = 'transparent';
      mirror.textContent = target.value.slice(0, position);
      const marker = document.createElement('span');
      marker.textContent = '\u200b';
      mirror.appendChild(marker);
      document.body.appendChild(mirror);
      mirror.scrollTop = target.scrollTop;
      mirror.scrollLeft = target.scrollLeft;
      const rect = marker.getBoundingClientRect();
      document.body.removeChild(mirror);
      if (!rect || !Number.isFinite(rect.left)) {
        return null;
      }
      return rect;
    } catch (error) {
      console.error('QuickSlash caret measurement failed', error);
      return null;
    }
  }

  function injectStyles() {
    if (document.getElementById('qs-snippet-style')) return;
    const style = document.createElement('style');
    style.id = 'qs-snippet-style';
    style.textContent = `
      #qs-snippet-panel {
        position: fixed;
        z-index: 2147483646;
        min-width: 240px;
        max-width: 320px;
        max-height: 260px;
        overflow-y: auto;
        background: rgba(15, 23, 42, 0.97);
        color: #f8fafc;
        border-radius: 12px;
        box-shadow: 0 15px 40px rgba(15, 23, 42, 0.45);
        padding: 8px;
        font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }

      #qs-snippet-panel[hidden] {
        display: none !important;
      }

      .qs-snippet-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .qs-snippet-item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        text-align: left;
        border: none;
        border-radius: 8px;
        padding: 8px 10px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        transition: background 0.15s ease;
        font-size: 13px;
      }

      .qs-snippet-item .qs-snippet-name {
        font-weight: 600;
        margin-bottom: 2px;
      }

      .qs-snippet-item .qs-snippet-value {
        opacity: 0.8;
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .qs-snippet-item.qs-active,
      .qs-snippet-item:hover {
        background: rgba(99, 102, 241, 0.25);
      }
    `;
    document.documentElement.appendChild(style);
  }
})();
