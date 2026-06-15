(() => {
  const SNIPPETS_KEY = 'quickSlashSnippets';
  const GROUPS_KEY = 'quickSlashGroups';
  const TRIGGER = '///';
  const TRIGGER_LENGTH = TRIGGER.length;

  const state = {
    snippets: [],
    groups: [],
    context: null
  };

  const panel = createPanel(handlePanelSelection);

  loadData();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[SNIPPETS_KEY] || changes[GROUPS_KEY])) {
      loadData(() => {
      if (!state.snippets.length) {
        hidePanel();
      } else if (panel.isOpen) {
          panel.render(state.snippets, state.groups);
      }
      });
    }
  });

  document.addEventListener('input', handleInput, true);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('focusin', handleFocusIn, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  window.addEventListener('resize', () => hidePanel());
  window.addEventListener('scroll', handleScroll, true);
  const mutationObserver = new MutationObserver(() => scheduleReposition());
  const observerTarget = document.body || document.documentElement;
  if (observerTarget) {
    mutationObserver.observe(observerTarget, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true
    });
  }

  function handleInput(event) {
    const target = getEditableTarget(event);
    if (!target) {
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
    const target = getEditableTarget(event);
    if (!target) {
      hidePanel();
      return;
    }

    if (panel.isOpen && state.context && target !== state.context.target) {
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
    scheduleReposition();
  }

  function loadData(callback) {
    chrome.storage.local.get({ [SNIPPETS_KEY]: [], [GROUPS_KEY]: [] }, (result) => {
      state.groups = normalizeGroups(result[GROUPS_KEY]);
      const validGroupIds = new Set(state.groups.map((group) => group.id));
      state.snippets = normalizeSnippets(result[SNIPPETS_KEY], validGroupIds);
      callback?.();
    });
  }

  function normalizeGroups(input) {
    if (!Array.isArray(input)) return [];
    return input.filter((group) => group && typeof group.id === 'string' && typeof group.name === 'string');
  }

  function normalizeSnippets(input, validGroupIds) {
    if (!Array.isArray(input)) return [];
    return input
      .filter((item) => item && typeof item.name === 'string' && typeof item.value === 'string')
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `legacy-${index}`,
        name: item.name,
        value: item.value,
        groupId: typeof item.groupId === 'string' && validGroupIds.has(item.groupId) ? item.groupId : null,
        favorite: item.favorite === true
      }));
  }

  let repositionFrame = 0;
  function scheduleReposition() {
    if (repositionFrame) return;
    repositionFrame = requestAnimationFrame(() => {
      repositionFrame = 0;
      if (!state.context || !panel.isOpen) return;
      const rect = state.context.getRect();
      if (rect) {
        panel.updatePosition(rect);
      }
    });
  }

  function createTriggerContext(target) {
    if (target instanceof HTMLTextAreaElement || isTextInput(target)) {
      return createTextContext(target);
    }

    if (target.isContentEditable || hasRoleTextbox(target)) {
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
    if (!target.isContentEditable && !hasRoleTextbox(target)) return null;
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
    panel.open(state.snippets, state.groups, rect);
    scheduleReposition();
  }

  function hidePanel() {
    state.context = null;
    panel.close();
  }

  function handlePanelSelection(snippet) {
    if (!state.context) {
      return;
    }
    if (!snippet) {
      return;
    }
    state.context.insert(snippet.value);
    hidePanel();
  }

  function isEditable(element) {
    return Boolean(element) && (
      element instanceof HTMLTextAreaElement ||
      isTextInput(element) ||
      element.isContentEditable ||
      hasRoleTextbox(element)
    );
  }

  function getEditableTarget(event) {
    if (event && typeof event.composedPath === 'function') {
      const path = event.composedPath();
      for (const node of path) {
        if (isEditable(node)) {
          return node;
        }
      }
    }
    if (event && isEditable(event.target)) {
      return event.target;
    }
    const active = getDeepActiveElement();
    if (isEditable(active)) {
      return active;
    }
    return null;
  }

  function getDeepActiveElement(root = document) {
    let active = root.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
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

  function hasRoleTextbox(element) {
    if (!(element instanceof HTMLElement)) {
      return false;
    }
    const role = element.getAttribute('role');
    if (role !== 'textbox') {
      return false;
    }
    if (element.getAttribute('aria-hidden') === 'true') {
      return false;
    }
    return !element.hasAttribute('disabled');
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
      onSelect(items[index]);
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
      open(nextItems, nextGroups, rect) {
        items = orderSnippets(nextItems, nextGroups);
        highlightIndex = 0;
        this.render(nextItems, nextGroups);
        root.hidden = false;
        this.updatePosition(rect);
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
        onSelect(items[highlightIndex]);
      },
      contains(node) {
        return root.contains(node);
      },
      updatePosition(rect) {
        if (!rect) return;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight;
        const margin = 8;
        root.style.visibility = 'hidden';
        root.hidden = false;
        const panelRect = root.getBoundingClientRect();
        const leftBase = Number.isFinite(rect.left) ? rect.left : margin + 8;
        const maxLeft = Math.max(margin, viewportWidth - panelRect.width - margin);
        const left = clamp(leftBase, margin, maxLeft);
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        let top;
        if (spaceBelow >= panelRect.height + margin || spaceBelow >= spaceAbove) {
          top = rect.bottom + margin;
          if (top + panelRect.height > viewportHeight - margin) {
            top = Math.max(margin, viewportHeight - panelRect.height - margin);
          }
        } else {
          top = Math.max(margin, rect.top - panelRect.height - margin);
        }
        root.style.left = `${left}px`;
        root.style.top = `${top}px`;
        root.style.visibility = '';
      },
      render(nextItems, nextGroups) {
        const sections = createSections(nextItems, nextGroups);
        items = sections.flatMap((section) => section.items);
        list.innerHTML = '';
        if (!items.length) {
          root.hidden = true;
          return;
        }
        highlightIndex = Math.min(highlightIndex, Math.max(items.length - 1, 0));
        let itemIndex = 0;
        for (const section of sections) {
          const heading = document.createElement('div');
          heading.className = 'qs-snippet-group';
          heading.textContent = section.label;
          list.appendChild(heading);
          for (const item of section.items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.index = String(itemIndex);
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
            itemIndex += 1;
          }
        }
        updateHighlight();
      }
    };

    function updateHighlight() {
      const buttons = list.querySelectorAll('button[data-index]');
      buttons.forEach((btn) => {
        if (Number(btn.dataset.index) === highlightIndex) {
          btn.classList.add('qs-active');
          btn.scrollIntoView({ block: 'nearest' });
        } else {
          btn.classList.remove('qs-active');
        }
      });
    }
  }

  function orderSnippets(snippets, groups) {
    return createSections(snippets, groups).flatMap((section) => section.items);
  }

  function createSections(snippets, groups) {
    const sections = [];
    const favorites = snippets.filter((snippet) => snippet.favorite);
    if (favorites.length) {
      sections.push({ label: 'Favorites', items: favorites });
    }
    const remaining = snippets.filter((snippet) => !snippet.favorite);
    for (const group of groups) {
      const groupItems = remaining.filter((snippet) => snippet.groupId === group.id);
      if (groupItems.length) {
        sections.push({ label: group.name, items: groupItems });
      }
    }
    const ungrouped = remaining.filter((snippet) => !snippet.groupId);
    if (ungrouped.length) {
      sections.push({ label: 'Ungrouped', items: ungrouped });
    }
    return sections;
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
        min-width: 260px;
        max-width: 340px;
        max-height: 280px;
        overflow-y: auto;
        background: #fcfcff;
        color: #111111;
        border-radius: 9px;
        border: 1px solid rgba(15, 23, 42, 0.08);
        box-shadow: 0 30px 60px rgba(15, 23, 42, 0.18), 0 10px 20px rgba(15, 23, 42, 0.12);
        padding: 12px;
        font-family: 'Playfair Display', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        transition: opacity 0.2s ease, transform 0.2s ease;
        will-change: transform, opacity;
        animation: qsSoftFade 0.2s ease forwards;
      }

      #qs-snippet-panel[hidden] {
        display: none !important;
      }

      .qs-snippet-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .qs-snippet-group {
        padding: 7px 8px 2px;
        color: #8a8178;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-transform: uppercase;
      }

      .qs-snippet-item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        width: 100%;
        text-align: left;
        border: none;
        border-radius: 8px;
        padding: 12px 14px;
        background: rgba(15, 23, 42, 0.02);
        color: inherit;
        cursor: pointer;
        transition: background 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease;
        font-size: 13px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
      }

      .qs-snippet-item .qs-snippet-name {
        font-weight: 600;
        margin-bottom: 4px;
        font-size: 13px;
      }

      .qs-snippet-item .qs-snippet-value {
        opacity: 0.75;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: #6b7280;
      }

      .qs-snippet-item.qs-active,
      .qs-snippet-item:hover {
        background: rgba(255, 189, 89, 0.18);
        box-shadow: 0 20px 35px rgba(255, 189, 89, 0.25);
        transform: translateY(-1px);
      }

      @keyframes qsSoftFade {
        from {
          opacity: 0;
          transform: translateY(6px) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translateY(0) scale(1);
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function handleScroll(event) {
    if (panel.contains(event.target)) {
      return;
    }
    hidePanel();
  }
})();
