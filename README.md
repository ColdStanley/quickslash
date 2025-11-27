# QuickSlash

A lightweight Chrome extension that saves Name/Value pairs locally and lets you drop them into any input field or contenteditable area by typing `///`.

## Features
- Unlimited Name/Value pairs stored with `chrome.storage.local` (no backend).
- Duplicate names are blocked to keep triggers predictable.
- Popup UI to add or remove snippets.
- Type `///` inside an input, textarea, or editable area to open the snippet picker right next to the current field.
- Navigate the picker with the mouse or arrow keys + Enter.

## Development
1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
2. Select `browser-extensions/quickslash` as the extension directory.
3. After making changes, hit **Reload** in `chrome://extensions` and refresh the target page.

All user-facing copy in the popup and picker is English-only per the requirement.
