// ==UserScript==
// @name         YouTube Playlist Quick Delete Button
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  Adds a one-click "Delete" button to each playlist video row so you don't have to open the "..." menu to remove it.
// @author       you
// @match        https://www.youtube.com/playlist*
// @match        https://www.youtube.com/watch*
// @icon         https://www.youtube.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const BTN_CLASS = 'ytplqd-delete-btn';
    // Rows that can appear a video: the full playlist page, and the queue
    // panel on the right side of a watch page.
    const ROW_SELECTOR = 'ytd-playlist-video-renderer, ytd-playlist-panel-video-renderer';
    // Text used to find the right item inside the "..." popup menu.
    // YouTube's UI is in the viewer's language, so add more phrases here
    // if your account isn't in English.
    const REMOVE_TEXT_MATCHERS = [
        'remove from',
        '從播放清單中移除',
        '从播放列表中移除',
        'playlist から削除',
        'entfernen',
        'quitar de',
        'supprimer de',
    ];

    const style = document.createElement('style');
    style.textContent = `
        .${BTN_CLASS} {
            flex-shrink: 0;
            margin-left: 8px;
            padding: 4px 10px;
            font-size: 12px;
            font-weight: 500;
            line-height: 1.6;
            color: #fff;
            background-color: #cc0000;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            opacity: 0.85;
            z-index: 10;
            position: relative;
        }
        .${BTN_CLASS}:hover {
            opacity: 1;
        }
        .${BTN_CLASS}[disabled] {
            opacity: 0.4;
            cursor: default;
        }
    `;
    document.head.appendChild(style);

    function findMenuButton(row) {
        return (
            row.querySelector('ytd-menu-renderer yt-icon-button#button button') ||
            row.querySelector('ytd-menu-renderer button#button') ||
            row.querySelector('#menu button')
        );
    }

    // YouTube reuses a single shared popup instance across all rows, so a
    // hidden/closed leftover item from a previous open can still be sitting
    // in the DOM (and matching by text) when the next popup opens. Filter to
    // only items that are actually rendered/visible right now.
    function isVisible(el) {
        return !!el && el.getClientRects().length > 0;
    }

    function findRemoveMenuItem() {
        const items = document.querySelectorAll(
            'ytd-menu-popup-renderer ytd-menu-service-item-renderer, ' +
            'tp-yt-paper-listbox ytd-menu-service-item-renderer'
        );
        for (const item of items) {
            if (!isVisible(item)) continue;
            const text = (item.textContent || '').trim().toLowerCase();
            if (REMOVE_TEXT_MATCHERS.some((m) => text.includes(m.toLowerCase()))) {
                return item;
            }
        }
        return null;
    }

    function findOpenDropdowns() {
        return Array.from(document.querySelectorAll('tp-yt-iron-dropdown')).filter(isVisible);
    }

    // Trying to open the real "..." popup and then close it fast enough is a
    // losing timing race against YouTube's own open/close animations. Instead,
    // keep the popup visually hidden (via CSS, not display:none, so layout/
    // positioning still work) for the whole automated interaction, so the
    // user never sees it appear at all. hidePopupUi(false) restores it.
    let hideStyleEl = null;
    function hidePopupUi(hidden) {
        if (hidden) {
            if (hideStyleEl) return;
            hideStyleEl = document.createElement('style');
            hideStyleEl.textContent = `
                tp-yt-iron-dropdown, ytd-popup-container {
                    visibility: hidden !important;
                }
            `;
            document.head.appendChild(hideStyleEl);
        } else if (hideStyleEl) {
            hideStyleEl.remove();
            hideStyleEl = null;
        }
    }

    // Best-effort: reset the shared popup's internal open/close state so the
    // next open behaves normally. Not relied on for visual correctness since
    // the popup stays hidden via CSS the whole time anyway.
    function closeAnyOpenMenu() {
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
        }));
        document.body.click();
        findOpenDropdowns().forEach((d) => {
            if (typeof d.close === 'function') d.close();
        });
    }

    // YouTube reuses a single shared popup/dropdown instance for every row's
    // "..." menu. If two deletions were allowed to run at once, the second
    // row's menuButton.click() could repopulate that shared popup while the
    // first deletion is still waiting for it, causing the wrong item (or
    // nothing) to be clicked. This lock forces deletions to run one at a time.
    let isBusy = false;

    async function deleteVideo(row, btn) {
        if (isBusy) return;
        isBusy = true;

        const originalLabel = btn.textContent;
        try {
            if (!document.body.contains(row)) return;

            const menuButton = findMenuButton(row);
            if (!menuButton) {
                console.warn('[YT Quick Delete] Could not find "..." menu button for row', row);
                return;
            }

            btn.disabled = true;
            btn.textContent = '...';

            hidePopupUi(true);
            try {
                menuButton.click();

                const removeItem = await waitForRemoveMenuItem(2000);
                if (removeItem) {
                    removeItem.click();
                    // Row removes itself from the DOM once YouTube processes
                    // the action.
                } else {
                    console.warn('[YT Quick Delete] Could not find "Remove from..." menu item.');
                    if (document.body.contains(btn)) {
                        btn.disabled = false;
                        btn.textContent = originalLabel;
                    }
                }
                closeAnyOpenMenu();
            } finally {
                hidePopupUi(false);
            }
        } finally {
            isBusy = false;
        }
    }

    // Poll every animation frame instead of using a childList-only
    // MutationObserver: YouTube's reused singleton popup sometimes
    // repopulates by mutating existing nodes' text/attributes rather than
    // adding new ones, which a childList observer never sees, causing
    // intermittent timeouts. Polling re-checks regardless of what changed.
    function waitForRemoveMenuItem(timeoutMs) {
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const item = findRemoveMenuItem();
                if (item) {
                    resolve(item);
                    return;
                }
                if (Date.now() - start >= timeoutMs) {
                    resolve(null);
                    return;
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    function addButtonToRow(row) {
        if (row.querySelector(`.${BTN_CLASS}`)) return; // already added

        const menuRenderer = row.querySelector('ytd-menu-renderer');
        if (!menuRenderer || !menuRenderer.parentElement) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        btn.textContent = 'Delete';
        btn.title = 'Remove this video from the playlist';

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteVideo(row, btn);
        });

        menuRenderer.parentElement.insertBefore(btn, menuRenderer.nextSibling);
    }

    function scanForRows(root = document) {
        root.querySelectorAll(ROW_SELECTOR).forEach(addButtonToRow);
    }

    // Initial scan + observe for rows added by scrolling / SPA navigation.
    scanForRows();

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof HTMLElement)) continue;
                if (node.matches && node.matches(ROW_SELECTOR)) {
                    addButtonToRow(node);
                } else {
                    scanForRows(node);
                }
            }

            // A row's internals can be re-rendered by YouTube (e.g. other rows
            // rebind when a sibling is removed from the list) without the row
            // element itself being re-added, which silently wipes our injected
            // button. Re-check the mutated node's own row for a missing button.
            const target = mutation.target;
            const ownRow = target instanceof HTMLElement ? target.closest(ROW_SELECTOR) : null;
            if (ownRow) addButtonToRow(ownRow);
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // YouTube is a SPA; re-scan on soft navigation between pages.
    document.addEventListener('yt-navigate-finish', () => scanForRows());
})();
