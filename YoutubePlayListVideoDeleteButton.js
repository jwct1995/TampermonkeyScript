// ==UserScript==
// @name         YouTube Playlist Quick Delete Button
// @namespace    http://tampermonkey.net/
// @version      2.0
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

    function findRemoveMenuItem() {
        const items = document.querySelectorAll(
            'ytd-menu-popup-renderer ytd-menu-service-item-renderer, ' +
            'tp-yt-paper-listbox ytd-menu-service-item-renderer'
        );
        for (const item of items) {
            const text = (item.textContent || '').trim().toLowerCase();
            if (REMOVE_TEXT_MATCHERS.some((m) => text.includes(m.toLowerCase()))) {
                return item;
            }
        }
        return null;
    }

    function closeAnyOpenMenu() {
        // Escape reliably closes YouTube's iron-dropdown popups; body.click()
        // is kept as a fallback for the rare cases Escape doesn't register.
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true,
        }));
        document.body.click();
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

            menuButton.click();

            const removeItem = await waitForRemoveMenuItem(2000);
            if (removeItem) {
                removeItem.click();
                // Row removes itself from the DOM once YouTube processes the action.
            } else {
                console.warn('[YT Quick Delete] Could not find "Remove from..." menu item.');
                closeAnyOpenMenu();
                if (document.body.contains(btn)) {
                    btn.disabled = false;
                    btn.textContent = originalLabel;
                }
            }
        } finally {
            isBusy = false;
        }
    }

    // Waits for the "Remove from..." item to appear via MutationObserver
    // (reacting to the popup actually rendering) instead of blind polling.
    function waitForRemoveMenuItem(timeoutMs) {
        return new Promise((resolve) => {
            const existing = findRemoveMenuItem();
            if (existing) {
                resolve(existing);
                return;
            }

            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                observer.disconnect();
                clearTimeout(timer);
                resolve(result);
            };

            const observer = new MutationObserver(() => {
                const item = findRemoveMenuItem();
                if (item) finish(item);
            });
            observer.observe(document.body, { childList: true, subtree: true });

            const timer = setTimeout(() => finish(null), timeoutMs);
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
        }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // YouTube is a SPA; re-scan on soft navigation between pages.
    document.addEventListener('yt-navigate-finish', () => scanForRows());
})();
