# QuickSlash

A lightweight Chrome extension that saves Name/Value pairs locally and lets you drop them into any input field or contenteditable area by typing `///`.

## Features
- Snippets and custom groups stored with `chrome.storage.local` (no backend).
- Favorites, custom groups, All, and Ungrouped views in the side panel.
- Create, edit, copy, move, reorder, and delete snippets.
- Manually autofill the current page by matching saved form field names.
- Versioned JSON export with backward-compatible imports from older QuickSlash files.
- Type `///` inside an input, textarea, or editable area to open a grouped snippet picker.
- Navigate the picker with the mouse or arrow keys + Enter.

## Development
1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select this repository directory.
3. After making changes, hit **Reload** in `chrome://extensions` and refresh the target page.

All user-facing copy in the popup and picker is English-only per the requirement.
