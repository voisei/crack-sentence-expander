// ==UserScript==
// @name         크랙 문장 부풀리기 · 모바일 토글/패널 위치 핫픽스
// @namespace    https://crack.wrtn.ai
// @version      1.0.0
// @author       me
// @description  v6.12.13 원본과 함께 사용. 모바일에서 토글 버튼이 사라지거나 패널이 열리지 않는 문제를 강제로 수정.
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const EDGE = 12;
    const PANEL_ID = 'se-panel';
    const FAB_ID = 'se-fab';

    let currentFab = null;
    let panelObserver = null;
    let installTimer = null;

    function getViewport() {
        const vv = window.visualViewport;

        return {
            left: vv ? vv.offsetLeft : 0,
            top: vv ? vv.offsetTop : 0,
            width: vv ? vv.width : window.innerWidth,
            height: vv ? vv.height : window.innerHeight
        };
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function forcePanelInside(panel) {
        if (!panel) return;

        panel.style.setProperty('position', 'fixed', 'important');
        panel.style.setProperty('z-index', '2147483646', 'important');
        panel.style.setProperty('max-width', 'calc(100vw - 24px)', 'important');
        panel.style.setProperty('max-height', 'calc(100dvh - 24px)', 'important');

        const viewport = getViewport();
        const rect = panel.getBoundingClientRect();

        const width = Math.min(
            rect.width || panel.offsetWidth || 320,
            viewport.width - EDGE * 2
        );

        const height = Math.min(
            rect.height || panel.offsetHeight || 500,
            viewport.height - EDGE * 2
        );

        let left = Number.parseFloat(panel.style.left);
        let top = Number.parseFloat(panel.style.top);

        if (!Number.isFinite(left)) left = rect.left;
        if (!Number.isFinite(top)) top = rect.top;

        if (
            !Number.isFinite(left) ||
            rect.right < viewport.left ||
            rect.left > viewport.left + viewport.width
        ) {
            left = viewport.left + Math.max(EDGE, viewport.width - width - EDGE);
        }

        if (
            !Number.isFinite(top) ||
            rect.bottom < viewport.top ||
            rect.top > viewport.top + viewport.height
        ) {
            top = viewport.top + EDGE;
        }

        left = clampNumber(
            left,
            viewport.left + EDGE,
            Math.max(
                viewport.left + EDGE,
                viewport.left + viewport.width - width - EDGE
            )
        );

        top = clampNumber(
            top,
            viewport.top + EDGE,
            Math.max(
                viewport.top + EDGE,
                viewport.top + viewport.height - Math.min(height, 96) - EDGE
            )
        );

        panel.style.setProperty('left', left + 'px', 'important');
        panel.style.setProperty('top', top + 'px', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
        panel.style.setProperty('transform', 'none', 'important');
    }

    function forceFabInside(fab) {
        if (!fab) return;

        const viewport = getViewport();
        const rect = fab.getBoundingClientRect();

        const width = rect.width || fab.offsetWidth || 54;
        const height = rect.height || fab.offsetHeight || 54;

        let left = Number.parseFloat(fab.style.left);
        let top = Number.parseFloat(fab.style.top);

        if (!Number.isFinite(left)) left = rect.left;
        if (!Number.isFinite(top)) top = rect.top;

        const totallyLost =
            !Number.isFinite(left) ||
            !Number.isFinite(top) ||
            rect.right < viewport.left ||
            rect.left > viewport.left + viewport.width ||
            rect.bottom < viewport.top ||
            rect.top > viewport.top + viewport.height;

        if (totallyLost) {
            left = viewport.left + viewport.width - width - EDGE;
            top = viewport.top + viewport.height - height - 100;
        }

        left = clampNumber(
            left,
            viewport.left + EDGE,
            Math.max(
                viewport.left + EDGE,
                viewport.left + viewport.width - width - EDGE
            )
        );

        top = clampNumber(
            top,
            viewport.top + EDGE,
            Math.max(
                viewport.top + EDGE,
                viewport.top + viewport.height - height - EDGE
            )
        );

        fab.style.setProperty('display', 'flex', 'important');
        fab.style.setProperty('visibility', 'visible', 'important');
        fab.style.setProperty('opacity', '1', 'important');
        fab.style.setProperty('pointer-events', 'auto', 'important');
        fab.style.setProperty('position', 'fixed', 'important');
        fab.style.setProperty('left', left + 'px', 'important');
        fab.style.setProperty('top', top + 'px', 'important');
        fab.style.setProperty('right', 'auto', 'important');
        fab.style.setProperty('bottom', 'auto', 'important');
        fab.style.setProperty('transform', 'none', 'important');
        fab.style.setProperty('z-index', '2147483647', 'important');
        fab.style.setProperty('touch-action', 'none', 'important');
    }

    function isPanelOpen(panel) {
        if (!panel) return false;

        const style = getComputedStyle(panel);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function openPanel(panel) {
        if (!panel) return;

        panel.style.setProperty('display', 'flex', 'important');
        panel.style.setProperty('visibility', 'visible', 'important');
        panel.style.setProperty('opacity', '1', 'important');
        panel.style.setProperty('pointer-events', 'auto', 'important');

        requestAnimationFrame(() => {
            forcePanelInside(panel);
            setTimeout(() => forcePanelInside(panel), 80);
        });
    }

    function closePanel(panel) {
        if (!panel) return;

        panel.style.setProperty('display', 'none', 'important');
    }

    function togglePanel() {
        const panel = document.getElementById(PANEL_ID);

        if (!panel) return;

        if (isPanelOpen(panel)) {
            closePanel(panel);
        } else {
            openPanel(panel);
        }
    }

    function installFabReplacement() {
        const oldFab = document.getElementById(FAB_ID);
        const panel = document.getElementById(PANEL_ID);

        if (!oldFab || !panel) return false;
        if (oldFab.dataset.mobileToggleFixed === '1') {
            currentFab = oldFab;
            forceFabInside(oldFab);
            forcePanelInside(panel);
            return true;
        }

        /*
         * 원본 FAB의 pointerup 리스너가 모바일에서 탭/드래그를 잘못 판정하는 경우가 있어
         * 복제본으로 교체해 기존 이벤트를 모두 제거한 뒤 새 토글을 연결한다.
         */
        const fab = oldFab.cloneNode(true);
        fab.dataset.mobileToggleFixed = '1';
        fab.title = '문장 부풀리기 열기/닫기';
        fab.textContent = '✨';

        oldFab.replaceWith(fab);
        currentFab = fab;

        let dragging = false;
        let moved = false;
        let pointerId = null;
        let offsetX = 0;
        let offsetY = 0;
        let startX = 0;
        let startY = 0;

        fab.addEventListener('pointerdown', event => {
            dragging = true;
            moved = false;
            pointerId = event.pointerId;

            const rect = fab.getBoundingClientRect();

            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            startX = event.clientX;
            startY = event.clientY;

            try {
                fab.setPointerCapture(event.pointerId);
            } catch (_) {}

            event.preventDefault();
        }, { passive: false });

        fab.addEventListener('pointermove', event => {
            if (!dragging || event.pointerId !== pointerId) return;

            if (
                Math.abs(event.clientX - startX) +
                Math.abs(event.clientY - startY) > 10
            ) {
                moved = true;
            }

            if (!moved) return;

            const viewport = getViewport();
            const width = fab.offsetWidth || 54;
            const height = fab.offsetHeight || 54;

            const left = clampNumber(
                event.clientX - offsetX,
                viewport.left + EDGE,
                viewport.left + viewport.width - width - EDGE
            );

            const top = clampNumber(
                event.clientY - offsetY,
                viewport.top + EDGE,
                viewport.top + viewport.height - height - EDGE
            );

            fab.style.setProperty('left', left + 'px', 'important');
            fab.style.setProperty('top', top + 'px', 'important');
            fab.style.setProperty('right', 'auto', 'important');
            fab.style.setProperty('bottom', 'auto', 'important');

            event.preventDefault();
        }, { passive: false });

        function finish(event) {
            if (!dragging) return;
            if (
                event &&
                event.pointerId != null &&
                event.pointerId !== pointerId
            ) {
                return;
            }

            dragging = false;
            pointerId = null;

            forceFabInside(fab);

            if (!moved) {
                togglePanel();
            }

            moved = false;

            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
        }

        fab.addEventListener('pointerup', finish, { passive: false });
        fab.addEventListener('pointercancel', finish, { passive: false });

        forceFabInside(fab);
        forcePanelInside(panel);

        return true;
    }

    function installCloseButtonGuard() {
        const panel = document.getElementById(PANEL_ID);
        const close = document.getElementById('se-min');

        if (!panel || !close || close.dataset.mobileCloseFixed === '1') return;

        close.dataset.mobileCloseFixed = '1';

        /*
         * 원본 닫기 버튼은 그대로 두되, 닫은 뒤 FAB가 화면 안에 남도록 복구한다.
         */
        close.addEventListener('click', () => {
            setTimeout(() => {
                if (currentFab) forceFabInside(currentFab);
            }, 20);
        }, true);
    }

    function installStyles() {
        if (document.getElementById('se-mobile-toggle-hotfix-style')) return;

        const style = document.createElement('style');
        style.id = 'se-mobile-toggle-hotfix-style';
        style.textContent = `
            @media (pointer: coarse), (max-width: 700px) {
                #se-panel {
                    max-width: calc(100vw - 24px) !important;
                    max-height: calc(100dvh - 24px) !important;
                }

                #se-fab {
                    display: flex !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                    width: 54px !important;
                    height: 54px !important;
                    z-index: 2147483647 !important;
                    touch-action: none !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function repairAll() {
        installStyles();

        const installed = installFabReplacement();

        if (installed) {
            installCloseButtonGuard();

            const panel = document.getElementById(PANEL_ID);
            forcePanelInside(panel);
            forceFabInside(currentFab);
        }
    }

    function start() {
        repairAll();

        let attempts = 0;

        installTimer = setInterval(() => {
            attempts += 1;
            repairAll();

            if (
                document.getElementById(PANEL_ID) &&
                document.getElementById(FAB_ID) &&
                attempts >= 20
            ) {
                clearInterval(installTimer);
                installTimer = null;
            }

            if (attempts >= 80 && installTimer) {
                clearInterval(installTimer);
                installTimer = null;
            }
        }, 250);

        panelObserver = new MutationObserver(() => {
            repairAll();
        });

        panelObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        window.addEventListener('resize', repairAll, { passive: true });

        window.addEventListener('orientationchange', () => {
            setTimeout(repairAll, 250);
        }, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener(
                'resize',
                repairAll,
                { passive: true }
            );
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
