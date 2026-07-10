// ==UserScript==
// @name         크랙 문장 부풀리기 · 강제 실행 버튼
// @namespace    https://crack.wrtn.ai
// @version      1.1.0
// @author       me
// @description  원본 토글이 안 보일 때 화면 상단에 강제 실행 버튼을 생성하고 문장 부풀리기 패널을 연다.
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const BUTTON_ID = 'se-emergency-launcher';
    const PANEL_ID = 'se-panel';

    function addStyle() {
        if (document.getElementById('se-emergency-launcher-style')) return;

        const style = document.createElement('style');
        style.id = 'se-emergency-launcher-style';
        style.textContent = `
            #${BUTTON_ID} {
                position: fixed !important;
                top: calc(10px + env(safe-area-inset-top, 0px)) !important;
                left: 50% !important;
                right: auto !important;
                bottom: auto !important;
                transform: translateX(-50%) !important;
                z-index: 2147483647 !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                width: auto !important;
                min-width: 150px !important;
                height: 48px !important;
                padding: 0 18px !important;
                border: 3px solid #ffffff !important;
                border-radius: 999px !important;
                background: #ff2f92 !important;
                color: #ffffff !important;
                box-shadow: 0 6px 22px rgba(0,0,0,.5) !important;
                font: 800 15px/1 system-ui, sans-serif !important;
                letter-spacing: -0.2px !important;
                cursor: pointer !important;
                touch-action: manipulation !important;
                -webkit-tap-highlight-color: transparent !important;
            }

            #${BUTTON_ID}:active {
                transform: translateX(-50%) scale(.96) !important;
            }

            #${PANEL_ID}.se-emergency-open {
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
                position: fixed !important;
                left: 12px !important;
                top: calc(70px + env(safe-area-inset-top, 0px)) !important;
                right: auto !important;
                bottom: auto !important;
                transform: none !important;
                z-index: 2147483646 !important;
                max-width: calc(100vw - 24px) !important;
                max-height: calc(100dvh - 90px) !important;
            }
        `;

        (document.head || document.documentElement).appendChild(style);
    }

    function getOrCreateButton() {
        let button = document.getElementById(BUTTON_ID);
        if (button) return button;

        button = document.createElement('button');
        button.id = BUTTON_ID;
        button.type = 'button';
        button.textContent = '✨ 문장 부풀리기 열기';

        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();

            const panel = document.getElementById(PANEL_ID);

            if (!panel) {
                button.textContent = '⚠️ 원본 스크립트 없음';
                button.style.setProperty('background', '#d32f2f', 'important');

                setTimeout(() => {
                    button.textContent = '✨ 문장 부풀리기 열기';
                    button.style.setProperty('background', '#ff2f92', 'important');
                }, 1800);

                return;
            }

            const open = panel.classList.toggle('se-emergency-open');

            if (open) {
                panel.style.setProperty('display', 'flex', 'important');
                panel.style.setProperty('visibility', 'visible', 'important');
                panel.style.setProperty('opacity', '1', 'important');
                panel.style.setProperty('pointer-events', 'auto', 'important');
                button.textContent = '✕ 문장 부풀리기 닫기';
            } else {
                panel.classList.remove('se-emergency-open');
                panel.style.setProperty('display', 'none', 'important');
                button.textContent = '✨ 문장 부풀리기 열기';
            }
        }, true);

        (document.body || document.documentElement).appendChild(button);
        return button;
    }

    function repair() {
        addStyle();
        getOrCreateButton();
    }

    function start() {
        repair();

        const observer = new MutationObserver(repair);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        setInterval(repair, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        repair();
    } else {
        start();
    }
})();
