// ==UserScript==
// @name         YouTube Quality Switcher Buttons
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Adds one-click buttons on the YouTube player to jump straight to a specific video quality, including HDR labeling (only qualities above 480p are shown).
// @author       you
// @match        https://www.youtube.com/watch*
// @icon         https://www.youtube.com/favicon.ico
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'ytqs-quality-panel';
    // Only qualities strictly higher than this (in vertical pixels) get a button.
    const MIN_HEIGHT = 480;

    // YouTube's internal quality tags, with the vertical resolution they
    // correspond to and a short display label.
    const QUALITY_INFO = {
        highres: { height: 4320, label: '8K' },
        hd2160: { height: 2160, label: '4K' },
        hd1440: { height: 1440, label: '2K' },
        hd1080: { height: 1080, label: '1080p' },
        hd720: { height: 720, label: '720p' },
        large: { height: 480, label: '480p' },
        medium: { height: 360, label: '360p' },
        small: { height: 240, label: '240p' },
        tiny: { height: 144, label: '144p' },
    };

    const style = document.createElement('style');
    style.textContent = `
        #${PANEL_ID} {
            position: absolute;
            top: 8px;
            right: 8px;
            z-index: 60;
            display: flex;
            flex-direction: column;
            gap: 4px;
            align-items: flex-end;
        }
        #${PANEL_ID} button {
            padding: 4px 10px;
            font-size: 12px;
            font-weight: 500;
            color: #fff;
            background-color: rgba(28, 28, 28, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.25);
            border-radius: 4px;
            cursor: pointer;
            opacity: 0.85;
        }
        #${PANEL_ID} button:hover {
            opacity: 1;
            background-color: rgba(50, 50, 50, 0.9);
        }
        #${PANEL_ID} button[data-active="true"] {
            background-color: #cc0000;
            border-color: #cc0000;
            opacity: 1;
        }
    `;
    document.head.appendChild(style);

    function getPlayer() {
        const player = document.getElementById('movie_player');
        return player && typeof player.getAvailableQualityLevels === 'function' ? player : null;
    }

    function setQuality(player, quality) {
        // Different YouTube player versions expose different setters; try
        // both and ignore whichever isn't supported.
        try {
            if (typeof player.setPlaybackQualityRange === 'function') {
                player.setPlaybackQualityRange(quality, quality);
            }
        } catch (e) { /* not supported on this player version */ }
        try {
            if (typeof player.setPlaybackQuality === 'function') {
                player.setPlaybackQuality(quality);
            }
        } catch (e) { /* not supported on this player version */ }
    }

    function markActive(panel, quality) {
        panel.querySelectorAll('button').forEach((btn) => {
            btn.dataset.active = String(btn.dataset.quality === quality);
        });
    }

    // getAvailableQualityData() gives {quality, qualityLabel, isPlayable} per
    // level, where qualityLabel is YouTube's own text (e.g. "2160p60 HDR") -
    // that's the only reliable signal for whether a level is HDR. Older
    // player builds only expose getAvailableQualityLevels(), which has no
    // HDR info, so fall back to that with a blank label.
    function getQualityData(player) {
        if (typeof player.getAvailableQualityData === 'function') {
            try {
                const data = player.getAvailableQualityData();
                if (Array.isArray(data) && data.length) return data;
            } catch (e) { /* fall through to the plain level list */ }
        }
        return player.getAvailableQualityLevels().map((quality) => ({ quality, qualityLabel: '' }));
    }

    function buildPanel(player, container) {
        const seen = new Set();
        const entries = getQualityData(player).filter((d) => {
            const info = QUALITY_INFO[d.quality];
            if (!info || info.height <= MIN_HEIGHT || seen.has(d.quality)) return false;
            seen.add(d.quality);
            return true;
        });

        let panel = document.getElementById(PANEL_ID);

        if (entries.length === 0) {
            if (panel) panel.remove();
            return;
        }

        if (!panel) {
            panel = document.createElement('div');
            panel.id = PANEL_ID;
            container.appendChild(panel);
        }

        const levels = entries.map((d) => d.quality);
        const existingButtons = new Map(
            Array.from(panel.querySelectorAll('button')).map((b) => [b.dataset.quality, b])
        );

        // Drop buttons for qualities that are no longer offered for this video.
        existingButtons.forEach((btn, quality) => {
            if (!levels.includes(quality)) btn.remove();
        });

        entries.forEach(({ quality, qualityLabel }) => {
            const isHdr = /hdr/i.test(qualityLabel || '');
            const label = QUALITY_INFO[quality].label + (isHdr ? ' HDR' : '');

            let btn = existingButtons.get(quality);
            if (!btn) {
                btn = document.createElement('button');
                btn.type = 'button';
                btn.dataset.quality = quality;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setQuality(player, quality);
                    markActive(panel, quality);
                });
                panel.appendChild(btn);
            }
            btn.textContent = label;
            btn.title = `Switch to ${label}`;
        });

        const current = typeof player.getPlaybackQuality === 'function' ? player.getPlaybackQuality() : null;
        markActive(panel, current);
    }

    function tryInit() {
        const player = getPlayer();
        const container = document.querySelector('.html5-video-player');
        if (!player || !container) return;
        buildPanel(player, container);
    }

    let pollTimer = null;
    function startPolling() {
        stopPolling();
        // Available quality levels can start out limited (e.g. just ['auto'])
        // before the player finishes probing the stream's renditions, and can
        // change for live streams, so keep re-checking periodically.
        pollTimer = setInterval(tryInit, 1000);
    }
    function stopPolling() {
        if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    tryInit();
    startPolling();

    // YouTube is a SPA; rebuild the panel for the newly loaded video.
    document.addEventListener('yt-navigate-finish', () => {
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        tryInit();
        startPolling();
    });
})();
