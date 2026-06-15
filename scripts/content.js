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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'QUICKSLASH_AUTOFILL_FRAME') {
      return false;
    }
    sendResponse(autofillFrame(message.snippets));
    return false;
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
      .filter((item) => item && typeof item.name === 'string')
      .map((item, index) => ({
        id: typeof item.id === 'string' ? item.id : `legacy-${index}`,
        name: item.name,
        value: typeof item.value === 'string' ? item.value : '',
        groupId: typeof item.groupId === 'string' && validGroupIds.has(item.groupId) ? item.groupId : null,
        favorite: item.favorite === true,
        favoriteOrder: Number.isFinite(item.favoriteOrder) ? item.favoriteOrder : index,
        matchNames: Array.isArray(item.matchNames) ? item.matchNames : [],
        pdfData: typeof item.pdfData === 'string' ? item.pdfData : null,
        pdfName: typeof item.pdfName === 'string' ? item.pdfName : null
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

  function autofillFrame(rawSnippets) {
    const matchMap = createMatchMap(rawSnippets);
    const fields = collectAutofillFields();
    const result = {
      ok: true,
      scanned: fields.length,
      matched: 0,
      filled: 0,
      skippedNonEmpty: 0
    };

    for (const field of fields) {
      const snippet = findSnippetForField(field, matchMap, rawSnippets);
      if (!snippet) continue;
      result.matched += 1;
      if (!isEmptyField(field)) {
        result.skippedNonEmpty += 1;
        continue;
      }
      const isFileField = field instanceof HTMLInputElement && field.type === 'file';
      const isNativeSelectField = field instanceof HTMLSelectElement;
      const isSelectLikeField = isSelectLikeAutofillField(field);
      if (isFileField) {
        if (snippet.pdfData) {
          if (setFileFieldValue(field, snippet.pdfData, snippet.pdfName || 'document.pdf')) {
            result.filled += 1;
          }
        }
      } else if (isNativeSelectField) {
        if (setSelectFieldValue(field, snippet.value)) {
          result.filled += 1;
        }
      } else if (isSelectLikeField) {
        if (setFieldValue(field, snippet.value)) {
          result.filled += 1;
        }
      } else {
        const fillValue = snippet.value || snippet.pdfName || '';
        if (setFieldValue(field, fillValue)) {
          result.filled += 1;
        }
      }
    }
    return result;
  }

  function createMatchMap(rawSnippets) {
    const map = new Map();
    if (!Array.isArray(rawSnippets)) return map;
    for (const snippet of rawSnippets) {
      if (!snippet || typeof snippet.value !== 'string' || !Array.isArray(snippet.matchNames)) continue;
      for (const matchName of snippet.matchNames) {
        const normalized = normalizeFieldName(matchName);
        if (normalized && !map.has(normalized)) {
          map.set(normalized, snippet);
        }
      }
    }
    return map;
  }

  function collectAutofillFields() {
    const selector = [
      'input',
      'input[type="file"]',
      'textarea',
      'select',
      '[role="combobox"]',
      '[role="listbox"]',
      '[aria-haspopup="listbox"]',
      '[aria-autocomplete="list"]',
      '[aria-autocomplete="both"]',
      '[contenteditable="true"]',
      '[role="textbox"]'
    ].join(',');
    return Array.from(document.querySelectorAll(selector)).filter(isAutofillTarget);
  }

  function isAutofillTarget(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLSelectElement) {
      return !element.disabled && isVisibleElement(element);
    }
    if (isSelectLikeAutofillField(element) && !isVisibleElement(element)) {
      return false;
    }
    if (isSelectLikeAutofillField(element) && !(element instanceof HTMLInputElement)) {
      return !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true';
    }
    const isFileInput = element instanceof HTMLInputElement && element.type === 'file';
    if (!isFileInput && !isVisibleElement(element)) return false;
    if (element instanceof HTMLInputElement) {
      if (element.disabled || (!isFileInput && element.readOnly)) return false;
      const type = (element.type || 'text').toLowerCase();
      const blocked = new Set([
        'button', 'checkbox', 'color', 'hidden', 'image', 'password',
        'radio', 'range', 'reset', 'submit'
      ]);
      return !blocked.has(type);
    }
    if (element instanceof HTMLTextAreaElement) {
      return !element.disabled && !element.readOnly;
    }
    if (element.getAttribute('aria-hidden') === 'true') return false;
    if (element.getAttribute('contenteditable') === 'false') return false;
    return element.isContentEditable || hasRoleTextbox(element);
  }

  function isVisibleElement(element) {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return element.getClientRects().length > 0;
  }

  function isSelectLikeAutofillField(element) {
    if (!(element instanceof HTMLElement)) return false;
    if (element instanceof HTMLSelectElement) return true;

    const role = (element.getAttribute('role') || '').toLowerCase();
    const ariaAutocomplete = (element.getAttribute('aria-autocomplete') || '').toLowerCase();
    const ariaHasPopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
    const hasPopup = ariaHasPopup === 'listbox' || ariaHasPopup === 'true';
    const hasListAutocomplete = ariaAutocomplete === 'list' || ariaAutocomplete === 'both';

    if (role === 'combobox' || role === 'listbox') return true;
    if (element instanceof HTMLInputElement && element.hasAttribute('list')) return true;
    if (ariaHasPopup === 'listbox') return true;
    if (hasListAutocomplete && (hasPopup || hasSelectLikeContainer(element))) return true;
    if (hasPopup && hasSelectLikeContainer(element)) return true;

    return false;
  }

  function hasSelectLikeContainer(element) {
    return Boolean(element.closest([
      '[role="combobox"]',
      '[role="listbox"]',
      '[aria-haspopup="listbox"]',
      '[data-select]',
      '[data-testid*="select" i]',
      '.select',
      '.select__container',
      '.select-shell',
      '.react-select',
      '.react-select__control'
    ].join(',')));
  }

  function findSnippetForField(field, matchMap, allSnippets) {
    const isFileField = field instanceof HTMLInputElement && field.type === 'file';
    const isSelectLikeField = isSelectLikeAutofillField(field);
    const candidates = getFieldNameCandidates(field);

    // 1. 尝试用 candidates 在 matchMap 做 O(1) 的精准匹配
    for (const candidate of candidates) {
      const normalized = normalizeFieldName(candidate);
      if (normalized && matchMap.has(normalized)) {
        return matchMap.get(normalized);
      }
    }

    // 2. 针对上传框（input[type="file"]）加入普适性多词元交集匹配，攻克斜杠、连字符、下划线及标点阻抗
    if (isFileField) {
      const fileSnippets = state.snippets.filter((snippet) => snippet.pdfData);

      for (const snippet of fileSnippets) {
        if (!Array.isArray(snippet.matchNames)) continue;

        const snippetTerms = snippet.matchNames.flatMap((term) =>
          normalizeFieldName(term).split(/[\s/,\-_]/).filter(Boolean)
        );

        if (!snippetTerms.length) continue;

        for (const candidate of candidates) {
          const normCandidate = normalizeFieldName(candidate);
          if (!normCandidate) continue;

          const pageTerms = normCandidate.split(/[\s/,\-_]/).filter(Boolean);

          const hasOverlap = pageTerms.some((pTerm) => snippetTerms.includes(pTerm));

          if (hasOverlap) {
            return snippet;
          }
        }
      }
    }

    // 3. Native selects and ARIA comboboxes are bounded fuzzy: phrase containment
    // or all meaningful match-name tokens must be present in the page field label.
    if (isSelectLikeField) {
      const selectSnippets = (Array.isArray(allSnippets) ? allSnippets : [])
        .filter((snippet) => typeof snippet.value === 'string' && snippet.value.trim());

      for (const snippet of selectSnippets) {
        if (!Array.isArray(snippet.matchNames)) continue;

        for (const candidate of candidates) {
          if (snippet.matchNames.some((matchName) => isBoundedFuzzyMatch(matchName, candidate))) {
            return snippet;
          }
        }
      }
    }

    return null;
  }

  function getFieldNameCandidates(field) {
    const candidates = [];
    addCandidate(candidates, getAssociatedLabelText(field));
    addCandidate(candidates, field.getAttribute('aria-label'));
    addCandidate(candidates, getAriaLabelledByText(field));
    addCandidate(candidates, field.getAttribute('placeholder'));
    addCandidate(candidates, field.getAttribute('name'));
    addCandidate(candidates, field.id);
    addCandidate(candidates, field.getAttribute('autocomplete'));
    addCandidate(candidates, field.getAttribute('title'));
    [
      'label', 'name', 'testid', 'testId', 'field', 'fieldName', 'qa', 'cy', 'test'
    ].forEach((key) => addCandidate(candidates, field.dataset?.[key]));
    getNearbyLabelText(field).forEach((text) => addCandidate(candidates, text));
    return candidates;
  }

  function addCandidate(candidates, value) {
    const normalized = normalizeFieldName(value);
    if (normalized && !candidates.some((item) => normalizeFieldName(item) === normalized)) {
      candidates.push(value);
    }
  }

  function getAssociatedLabelText(field) {
    if (field.id) {
      const label = document.querySelector(`label[for="${cssEscape(field.id)}"]`);
      if (label) return label.innerText || label.textContent;
    }
    const wrappingLabel = field.closest('label');
    if (wrappingLabel) return getTextWithoutFieldValue(wrappingLabel, field);
    return '';
  }

  function getAriaLabelledByText(field) {
    const ids = (field.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    return ids.map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
  }

  function getNearbyLabelText(field) {
    const results = [];
    const container = field.closest('.form-group, .field, .form-row, .input-wrapper, .form-field, .control, .fieldWrapper, [data-field], [data-testid], li, p, div');
    if (container) {
      Array.from(container.querySelectorAll('label, legend, [aria-label], .label, .field-label, .form-label, .control-label, span, p'))
        .slice(0, 8)
        .forEach((node) => {
          if (node === field || node.contains(field)) return;
          const text = node.getAttribute?.('aria-label') || node.innerText || node.textContent;
          if (text && text.trim().length <= 120) results.push(text);
        });
    }
    let previous = field.previousElementSibling;
    let guard = 0;
    while (previous && guard < 3) {
      const text = previous.innerText || previous.textContent;
      if (text && text.trim().length <= 120) results.push(text);
      previous = previous.previousElementSibling;
      guard += 1;
    }
    return results;
  }

  function getTextWithoutFieldValue(container, field) {
    const clone = container.cloneNode(true);
    const fieldName = field.getAttribute('name');
    const fieldId = field.id;
    Array.from(clone.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"]')).forEach((node) => {
      if ((fieldName && node.getAttribute('name') === fieldName) || (fieldId && node.id === fieldId)) {
        node.remove();
      }
    });
    return clone.innerText || clone.textContent || '';
  }

  function isEmptyField(field) {
    if (field instanceof HTMLSelectElement) {
      return !field.value || field.selectedIndex < 0;
    }
    if (field instanceof HTMLInputElement && field.type === 'file') {
      return !field.files || field.files.length === 0;
    }
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      return !field.value.trim();
    }
    return !field.textContent.trim();
  }

  function setSelectFieldValue(field, value) {
    try {
      const options = Array.from(field.options);
      if (!options.length) return false;

      const normalizedValue = normalizeFieldName(value);

      // 按优先级依次检测：value 精准 → text 精准 → 受控包含/全词命中
      let bestIndex = -1;
      let bestScore = 0;

      for (let i = 0; i < options.length; i += 1) {
        const opt = options[i];
        if (opt.disabled) continue;

        const optValue = normalizeFieldName(opt.value);
        const optText = normalizeFieldName(opt.textContent);

        // 等级 1: value 精准命中（满分）
        if (optValue && optValue === normalizedValue) {
          bestIndex = i;
          bestScore = 100;
          break;
        }

        // 等级 2: text 精准命中
        if (optText && optText === normalizedValue) {
          if (bestScore < 90) { bestIndex = i; bestScore = 90; }
          continue;
        }

        // 等级 3: 双向包含（一方完整包含另一方）
        if (isBoundedContainsMatch(normalizedValue, optValue)) {
          if (bestScore < 70) { bestIndex = i; bestScore = 70; }
          continue;
        }
        if (isBoundedContainsMatch(normalizedValue, optText)) {
          if (bestScore < 65) { bestIndex = i; bestScore = 65; }
          continue;
        }

        // 等级 4: 全部有效词命中，避免单个常见词导致误选
        if (isTokenSubsetMatch(normalizedValue, `${optValue} ${optText}`) && bestScore < 40) {
          bestIndex = i;
          bestScore = 40;
        }
      }

      if (bestIndex < 0) return false;

      field.selectedIndex = bestIndex;

      // 发送全套组合事件确保 React/Vue 框架感知
      const eventOptions = { bubbles: true, cancelable: true };
      field.dispatchEvent(new Event('input', eventOptions));
      field.dispatchEvent(new Event('change', eventOptions));

      return true;
    } catch (error) {
      console.warn('QuickSlash select autofill failed:', error);
      return false;
    }
  }

  function setFileFieldValue(field, pdfData, pdfName) {
    try {
      // 1. 从 base64 DataURL 中提取纯数据和 mime 类型
      const parts = pdfData.split(';base64,');
      if (parts.length !== 2) return false;
      const contentType = parts[0].split(':')[1] || 'application/pdf';
      const raw = window.atob(parts[1]);

      // 2. 将 base64 解码的 raw 字符串转换为 Uint8Array
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; i += 1) {
        uInt8Array[i] = raw.charCodeAt(i);
      }

      // 3. 构建 Blob 和标准的 File 对象
      const blob = new Blob([uInt8Array], { type: contentType });
      const file = new File([blob], pdfName, { type: contentType });

      // 4. 将文件装入数据模拟传送箱 DataTransfer
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // 5. 突破 React/HTML 原生 Setter 劫持：首先尝试用 prototype 的设值方法进行设值
      field.focus();
      try {
        const prototype = HTMLInputElement.prototype;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, 'files');
        if (descriptor?.set) {
          descriptor.set.call(field, dataTransfer.files);
        } else {
          field.files = dataTransfer.files;
        }
      } catch (err) {
        // 后退机制：如果在严格的 setter 防御机制下报错，采用 Object.defineProperty 强绑定重写
        Object.defineProperty(field, 'files', {
          value: dataTransfer.files,
          writable: true,
          configurable: true
        });
      }

      // 6. 指控并派发高密度的“爆裂事件组合拳”：逐层上浮并冒泡触发事件，打破 Greenhouse/React 自定义上传的事件沉寂
      const eventOptions = { bubbles: true, cancelable: true, composed: true };
      const eventTypes = ['focus', 'input', 'change'];

      eventTypes.forEach((type) => {
        const ev = new Event(type, eventOptions);
        field.dispatchEvent(ev);
      });

      // 额外对输入框的直系父容器（向上追溯五层）派发 change 事件，防止页面代理捕获失效
      let parent = field.parentElement;
      let limit = 0;
      while (parent && limit < 5) {
        eventTypes.forEach((type) => {
          parent.dispatchEvent(new Event(type, eventOptions));
        });
        parent = parent.parentElement;
        limit += 1;
      }

      return true;
    } catch (error) {
      console.warn('QuickSlash PDF file attachment autofill failed:', error);
      return false;
    }
  }

  function setFieldValue(field, value) {
    try {
      field.focus();
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        setNativeValue(field, value);
        const position = value.length;
        if (typeof field.setSelectionRange === 'function') {
          field.setSelectionRange(position, position);
        }
      } else {
        field.textContent = value;
        placeCaretAtEnd(field);
      }
      dispatchFieldEvents(field, value);
      return true;
    } catch (error) {
      console.warn('QuickSlash autofill field failed:', error);
      return false;
    }
  }

  function setNativeValue(field, value) {
    const prototype = field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(field, value);
    } else {
      field.value = value;
    }
  }

  function dispatchFieldEvents(field, value) {
    const inputEvent = typeof InputEvent === 'function'
      ? new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' })
      : new Event('input', { bubbles: true });
    field.dispatchEvent(inputEvent);
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function placeCaretAtEnd(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    const selection = document.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  function normalizeFieldName(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[:：*]+$/g, '')
      .trim()
      .toLowerCase();
  }

  function normalizeLooseText(value) {
    return normalizeFieldName(value)
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getMeaningfulTokens(value) {
    const stopWords = new Set([
      'a', 'an', 'the', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'from',
      'is', 'are', 'am', 'be', 'been', 'being', 'do', 'does', 'did',
      'what', 'which', 'who', 'whose', 'when', 'where', 'why', 'how',
      'please', 'select', 'choose'
    ]);
    return normalizeLooseText(value)
      .split(' ')
      .filter((token) => token && !stopWords.has(token));
  }

  function isBoundedFuzzyMatch(matchName, candidate) {
    return isBoundedContainsMatch(matchName, candidate) || isTokenSubsetMatch(matchName, candidate);
  }

  function isBoundedContainsMatch(source, target) {
    const sourceText = normalizeLooseText(source);
    const targetText = normalizeLooseText(target);
    if (!sourceText || !targetText) return false;

    const shorter = sourceText.length <= targetText.length ? sourceText : targetText;
    const longer = sourceText.length <= targetText.length ? targetText : sourceText;
    if (shorter.length < 4) return false;

    return new RegExp(`(^|\\s)${escapeRegExp(shorter)}(\\s|$)`).test(longer);
  }

  function isTokenSubsetMatch(source, target) {
    const sourceTokens = getMeaningfulTokens(source);
    if (!sourceTokens.length) return false;
    if (sourceTokens.length === 1 && sourceTokens[0].length < 4) return false;

    const targetTokens = new Set(getMeaningfulTokens(target));
    if (!targetTokens.size) return false;

    return sourceTokens.every((token) => targetTokens.has(token));
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
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
    const favorites = snippets
      .filter((snippet) => snippet.favorite)
      .sort((a, b) => a.favoriteOrder - b.favoriteOrder);
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
        box-sizing: border-box;
        width: min(340px, calc(100vw - 16px));
        min-width: min(260px, calc(100vw - 16px));
        max-height: 280px;
        overflow-x: hidden;
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
        width: 100%;
        min-width: 0;
      }

      .qs-snippet-group {
        max-width: 100%;
        overflow: hidden;
        padding: 7px 8px 2px;
        color: #8a8178;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.1em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .qs-snippet-item {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        max-width: 100%;
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
        display: -webkit-box;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        overflow: hidden;
        font-weight: 600;
        margin-bottom: 4px;
        font-size: 13px;
        line-height: 1.35;
        overflow-wrap: anywhere;
        word-break: break-word;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }

      .qs-snippet-item .qs-snippet-value {
        display: block;
        width: 100%;
        min-width: 0;
        max-width: 100%;
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
