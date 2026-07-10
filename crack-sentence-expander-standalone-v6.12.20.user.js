// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini) · 단독 실행판
// @namespace    https://crack.wrtn.ai
// @version      6.12.20
// @author       me
// @description  Gemini 문장 부풀리기 단독 본체. 대사/행동, 길이, 시점, 복사, 채팅창 삽입, 모바일 토글 포함.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const K_KEY = 'se_standalone_api_key';
    const K_MODEL = 'se_standalone_model';
    const K_POV = 'se_standalone_pov';
    const K_LENGTH = 'se_standalone_length';
    const K_OPEN = 'se_standalone_open';
    const K_PANEL_POS = 'se_standalone_panel_pos';
    const K_FAB_POS = 'se_standalone_fab_pos';

    const PANEL_ID = 'se-standalone-panel';
    const FAB_ID = 'se-standalone-fab';
    const EDGE = 12;

    const LENGTH_GUIDES = {
        three: '대사와 서술을 합쳐 3문장 안팎으로 짧고 압축적으로.',
        short: '간결하게 핵심만 자연스럽게 살을 붙여서.',
        medium: '감각 묘사와 감정을 적당히 풀어 자연스러운 분량으로.',
        long: '풍부한 문학적 묘사와 내면 묘사를 충분히 펼쳐 길게.'
    };

    function buildPrompt(dialogue, action, pov, length) {
        const firstPerson = pov !== 'third';

        const system = [
            '너는 롤플레이 캐릭터 채팅에서 유저 캐릭터의 대사와 행동을 문학적으로 확장하는 글쓰기 보조다.',
            '직전 상대 캐릭터의 반응을 새로 창작하지 말고 오직 유저 캐릭터의 대사, 행동, 감정, 감각만 쓴다.',
            '새 사건이나 설정을 멋대로 추가하지 않는다.',
            '행동이 이미 진행 중인 표현이면 시작 전으로 되감지 말고 현재 진행 중인 순간부터 묘사한다.',
            '',
            '[시점]',
            firstPerson
                ? '- 1인칭으로 쓴다. 나/내가를 사용한다.'
                : '- 3인칭으로 쓴다. 그/그녀 또는 자연스러운 3인칭 표현을 사용한다.',
            '',
            '[형식]',
            '- 실제로 말하는 내용은 큰따옴표 "..."로 감싼다.',
            '- 행동, 감정, 감각, 서술은 *별표*로 감싼다.',
            '- 서술 묶음과 대사 묶음 사이에는 빈 줄을 넣는다.',
            '- 상대 캐릭터의 대사, 행동, 감정, 반응, 속마음은 쓰지 않는다.',
            '- 같은 표현과 행동을 반복하지 않는다.',
            '- 설명, 머리말, 코드블록 없이 완성된 본문만 출력한다.',
            '',
            '[길이]',
            LENGTH_GUIDES[length] || LENGTH_GUIDES.medium
        ].join('\n');

        const user = [
            '[대사]',
            dialogue.trim() || '(없음)',
            '',
            '[행동]',
            action.trim() || '(없음)',
            '',
            '위 규칙에 맞춰 유저 캐릭터의 본문만 출력해줘.'
        ].join('\n');

        return { system, user };
    }

    function callGemini(dialogue, action, pov, length, onDone, onError) {
        const key = String(GM_getValue(K_KEY, '') || '').trim();
        const model = String(GM_getValue(K_MODEL, 'gemini-2.5-flash') || 'gemini-2.5-flash').trim();

        if (!key) {
            onError('⚙️ 설정에서 Gemini API 키를 먼저 저장해 주세요.');
            return;
        }

        if (!dialogue.trim() && !action.trim()) {
            onError('대사나 행동 중 하나는 입력해 주세요.');
            return;
        }

        const prompt = buildPrompt(dialogue, action, pov, length);
        const url =
            'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent?key=' +
            encodeURIComponent(key);

        GM_xmlhttpRequest({
            method: 'POST',
            url,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                system_instruction: {
                    parts: [{ text: prompt.system }]
                },
                contents: [{
                    role: 'user',
                    parts: [{ text: prompt.user }]
                }],
                generationConfig: {
                    maxOutputTokens: 8192
                }
            }),
            timeout: 60000,
            onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    let message = 'API 오류 (' + response.status + ')';

                    try {
                        const parsed = JSON.parse(response.responseText);
                        if (parsed.error && parsed.error.message) {
                            message += ': ' + parsed.error.message;
                        }
                    } catch (_) {}

                    onError(message);
                    return;
                }

                try {
                    const data = JSON.parse(response.responseText);
                    const candidate = data.candidates && data.candidates[0];
                    const output = candidate &&
                        candidate.content &&
                        Array.isArray(candidate.content.parts)
                        ? candidate.content.parts.map(part => part.text || '').join('').trim()
                        : '';

                    if (!output) {
                        onError('응답이 비어 있어요. 모델이나 입력을 바꿔 다시 시도해 주세요.');
                        return;
                    }

                    onDone(output);
                } catch (error) {
                    onError('응답을 읽지 못했어요.');
                }
            },
            onerror() {
                onError('네트워크 오류가 발생했어요.');
            },
            ontimeout() {
                onError('요청 시간이 초과됐어요.');
            }
        });
    }

    function getViewport() {
        const vv = window.visualViewport;

        return {
            left: vv ? vv.offsetLeft : 0,
            top: vv ? vv.offsetTop : 0,
            width: vv ? vv.width : window.innerWidth,
            height: vv ? vv.height : window.innerHeight
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function clampElement(element, saveKey) {
        if (!element || getComputedStyle(element).display === 'none') return;

        const viewport = getViewport();
        const rect = element.getBoundingClientRect();
        const width = rect.width || element.offsetWidth;
        const height = rect.height || element.offsetHeight;

        let left = Number.parseFloat(element.style.left);
        let top = Number.parseFloat(element.style.top);

        if (!Number.isFinite(left)) left = rect.left;
        if (!Number.isFinite(top)) top = rect.top;

        if (
            rect.right < viewport.left ||
            rect.left > viewport.left + viewport.width ||
            !Number.isFinite(left)
        ) {
            left = viewport.left + viewport.width - width - EDGE;
        }

        if (
            rect.bottom < viewport.top ||
            rect.top > viewport.top + viewport.height ||
            !Number.isFinite(top)
        ) {
            top = viewport.top + EDGE;
        }

        left = clamp(
            left,
            viewport.left + EDGE,
            Math.max(viewport.left + EDGE, viewport.left + viewport.width - width - EDGE)
        );

        top = clamp(
            top,
            viewport.top + EDGE,
            Math.max(viewport.top + EDGE, viewport.top + viewport.height - Math.min(height, 80) - EDGE)
        );

        element.style.left = left + 'px';
        element.style.top = top + 'px';
        element.style.right = 'auto';
        element.style.bottom = 'auto';

        if (saveKey) {
            GM_setValue(saveKey, { left, top });
        }
    }

    function findChatInput() {
        const panel = document.getElementById(PANEL_ID);

        const candidates = Array.from(document.querySelectorAll(
            'textarea, [contenteditable="true"], [contenteditable=""]'
        )).filter(element => {
            if (panel && panel.contains(element)) return false;

            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);

            return (
                rect.width > 20 &&
                rect.height > 15 &&
                style.display !== 'none' &&
                style.visibility !== 'hidden'
            );
        });

        candidates.sort((a, b) => {
            return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        });

        return candidates[0] || null;
    }

    function setChatValue(element, text) {
        if (!element) return false;

        if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
            const prototype = element.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;

            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

            if (descriptor && descriptor.set) {
                descriptor.set.call(element, text);
            } else {
                element.value = text;
            }

            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }

        element.focus();
        element.textContent = text;

        try {
            element.dispatchEvent(new InputEvent('input', {
                bubbles: true,
                inputType: 'insertText',
                data: text
            }));
        } catch (_) {
            element.dispatchEvent(new Event('input', { bubbles: true }));
        }

        return true;
    }

    function copyText(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise((resolve, reject) => {
            const area = document.createElement('textarea');
            area.value = text;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();

            try {
                document.execCommand('copy');
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                area.remove();
            }
        });
    }

    function injectStyle() {
        if (document.getElementById('se-standalone-style')) return;

        const style = document.createElement('style');
        style.id = 'se-standalone-style';
        style.textContent = `
            #${PANEL_ID}, #${FAB_ID}, #${PANEL_ID} * {
                box-sizing: border-box;
                font-family: Pretendard, "Noto Sans KR", system-ui, sans-serif;
            }

            #${PANEL_ID} {
                position: fixed;
                z-index: 2147483646;
                width: 330px;
                max-width: calc(100vw - 24px);
                max-height: calc(100dvh - 24px);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                color: #f7f7fb;
                background: #1c1e26;
                border: 1px solid #414657;
                border-radius: 15px;
                box-shadow: 0 12px 38px rgba(0,0,0,.45);
            }

            #se-s-head {
                display: flex;
                align-items: center;
                gap: 8px;
                min-height: 46px;
                padding: 9px 11px;
                background: #292c38;
                border-bottom: 1px solid #414657;
                cursor: grab;
                touch-action: none;
                user-select: none;
            }

            #se-s-title {
                flex: 1;
                font-size: 13px;
                font-weight: 800;
            }

            #se-s-head button {
                border: 0;
                background: transparent;
                color: #fff;
                font-size: 17px;
                cursor: pointer;
            }

            #se-s-body, #se-s-settings {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding: 10px;
                overflow-y: auto;
            }

            #se-s-settings {
                display: none;
            }

            #se-s-settings.show {
                display: flex;
            }

            #se-s-body.hide {
                display: none;
            }

            #${PANEL_ID} textarea,
            #${PANEL_ID} input,
            #${PANEL_ID} select {
                width: 100%;
                border: 1px solid #414657;
                border-radius: 9px;
                padding: 9px;
                background: #12141a;
                color: #fff;
                font-size: 13px;
            }

            #${PANEL_ID} textarea {
                min-height: 58px;
                resize: vertical;
                line-height: 1.5;
            }

            .se-s-label {
                margin: 1px 2px -4px;
                color: #b5b8c7;
                font-size: 11px;
                font-weight: 750;
            }

            .se-s-tabs {
                display: flex;
                gap: 4px;
                padding: 3px;
                background: #12141a;
                border-radius: 9px;
            }

            .se-s-tabs button {
                flex: 1;
                padding: 7px 4px;
                border: 0;
                border-radius: 7px;
                background: transparent;
                color: #a8abba;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
            }

            .se-s-tabs button.active {
                background: #484e65;
                color: #fff;
            }

            #se-s-run, #se-s-insert, #se-s-save {
                width: 100%;
                min-height: 43px;
                border: 0;
                border-radius: 10px;
                font-size: 13px;
                font-weight: 850;
                cursor: pointer;
            }

            #se-s-run {
                background: linear-gradient(135deg,#6d7cff,#945cff);
                color: #fff;
            }

            #se-s-insert {
                display: none;
                background: linear-gradient(135deg,#43d49a,#32b8c6);
                color: #062a20;
            }

            #se-s-save {
                background: #6d7cff;
                color: #fff;
            }

            #se-s-output {
                display: none;
                min-height: 50px;
                max-height: 38vh;
                overflow-y: auto;
                padding: 10px;
                white-space: pre-wrap;
                word-break: break-word;
                line-height: 1.65;
                border: 1px solid #414657;
                border-radius: 9px;
                background: #12141a;
                font-size: 13px;
            }

            #se-s-output.show, #se-s-insert.show, #se-s-result-buttons.show {
                display: block;
            }

            #se-s-result-buttons {
                display: none;
            }

            #se-s-result-buttons button {
                width: 100%;
                min-height: 38px;
                border: 1px solid #414657;
                border-radius: 9px;
                background: #292c38;
                color: #fff;
                cursor: pointer;
            }

            #se-s-status {
                min-height: 18px;
                white-space: pre-wrap;
                color: #adb1c1;
                font-size: 12px;
            }

            #se-s-status.error {
                color: #ff9292;
            }

            #${FAB_ID} {
                position: fixed;
                z-index: 2147483647;
                display: flex !important;
                align-items: center;
                justify-content: center;
                width: 58px;
                height: 58px;
                border: 3px solid #fff;
                border-radius: 50%;
                background: #ff3995;
                color: #fff;
                box-shadow: 0 6px 20px rgba(0,0,0,.45);
                font-size: 23px;
                cursor: pointer;
                touch-action: none;
                user-select: none;
            }

            @media (max-width: 700px), (pointer: coarse) {
                #${PANEL_ID} {
                    width: min(330px, calc(100vw - 24px));
                    box-shadow: none;
                }

                #${FAB_ID} {
                    display: flex !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                    pointer-events: auto !important;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div id="se-s-head">
                <span id="se-s-title">✨ 문장 부풀리기 · v6.12.20</span>
                <button id="se-s-gear" type="button" title="설정">⚙️</button>
                <button id="se-s-close" type="button" title="닫기">✕</button>
            </div>

            <div id="se-s-body">
                <div class="se-s-label">💬 대사</div>
                <textarea id="se-s-dialogue" placeholder="예: 괜찮아, 내가 도와줄게"></textarea>

                <div class="se-s-label">🎬 행동</div>
                <textarea id="se-s-action" placeholder="예: 눈을 피하며 작게 웃는다"></textarea>

                <div class="se-s-tabs" id="se-s-pov">
                    <button type="button" data-value="first">1인칭</button>
                    <button type="button" data-value="third">3인칭</button>
                </div>

                <div class="se-s-tabs" id="se-s-length">
                    <button type="button" data-value="three">세줄</button>
                    <button type="button" data-value="short">짧게</button>
                    <button type="button" data-value="medium">중간</button>
                    <button type="button" data-value="long">길게</button>
                </div>

                <button id="se-s-run" type="button">✨ 문학적으로 늘리기</button>
                <div id="se-s-status"></div>
                <div id="se-s-output"></div>
                <button id="se-s-insert" type="button">💬 채팅창에 바로 넣기</button>
                <div id="se-s-result-buttons">
                    <button id="se-s-copy" type="button">📋 결과 복사</button>
                </div>
            </div>

            <div id="se-s-settings">
                <div class="se-s-label">🔑 Gemini API 키</div>
                <input id="se-s-key" type="password" placeholder="AIza...">

                <div class="se-s-label">🤖 모델 ID</div>
                <input id="se-s-model" type="text" placeholder="gemini-2.5-flash">

                <button id="se-s-save" type="button">저장</button>
                <div class="se-s-label">Google AI Studio에서 발급한 API 키를 사용합니다.</div>
            </div>
        `;

        const fab = document.createElement('button');
        fab.id = FAB_ID;
        fab.type = 'button';
        fab.textContent = '✨';
        fab.title = '문장 부풀리기 열기/닫기';

        document.body.appendChild(panel);
        document.body.appendChild(fab);

        wireUI(panel, fab);
    }

    function wireUI(panel, fab) {
        const get = selector => panel.querySelector(selector);

        const body = get('#se-s-body');
        const settings = get('#se-s-settings');
        const dialogue = get('#se-s-dialogue');
        const action = get('#se-s-action');
        const output = get('#se-s-output');
        const status = get('#se-s-status');
        const runButton = get('#se-s-run');
        const insertButton = get('#se-s-insert');
        const resultButtons = get('#se-s-result-buttons');
        const keyInput = get('#se-s-key');
        const modelInput = get('#se-s-model');

        let result = '';

        const savedPanelPos = GM_getValue(K_PANEL_POS, null);
        if (savedPanelPos && Number.isFinite(savedPanelPos.left) && Number.isFinite(savedPanelPos.top)) {
            panel.style.left = savedPanelPos.left + 'px';
            panel.style.top = savedPanelPos.top + 'px';
        } else {
            panel.style.left = '12px';
            panel.style.top = '76px';
        }

        const savedFabPos = GM_getValue(K_FAB_POS, null);
        if (savedFabPos && Number.isFinite(savedFabPos.left) && Number.isFinite(savedFabPos.top)) {
            fab.style.left = savedFabPos.left + 'px';
            fab.style.top = savedFabPos.top + 'px';
        } else {
            fab.style.right = '14px';
            fab.style.bottom = 'calc(18px + env(safe-area-inset-bottom, 0px))';
        }

        if (GM_getValue(K_OPEN, true) === false) {
            panel.style.display = 'none';
        }

        keyInput.value = GM_getValue(K_KEY, '');
        modelInput.value = GM_getValue(K_MODEL, 'gemini-2.5-flash');

        function selectTab(containerSelector, key, fallback) {
            const container = get(containerSelector);
            const current = GM_getValue(key, fallback);

            container.querySelectorAll('button').forEach(button => {
                button.classList.toggle('active', button.dataset.value === current);

                button.addEventListener('click', () => {
                    container.querySelectorAll('button').forEach(item => {
                        item.classList.remove('active');
                    });

                    button.classList.add('active');
                    GM_setValue(key, button.dataset.value);
                });
            });
        }

        selectTab('#se-s-pov', K_POV, 'first');
        selectTab('#se-s-length', K_LENGTH, 'medium');

        function setStatus(message, error = false) {
            status.textContent = message;
            status.classList.toggle('error', error);
        }

        get('#se-s-gear').addEventListener('click', () => {
            const opening = !settings.classList.contains('show');
            settings.classList.toggle('show', opening);
            body.classList.toggle('hide', opening);
            clampElement(panel);
        });

        get('#se-s-save').addEventListener('click', () => {
            GM_setValue(K_KEY, keyInput.value.trim());
            GM_setValue(K_MODEL, modelInput.value.trim() || 'gemini-2.5-flash');

            settings.classList.remove('show');
            body.classList.remove('hide');
            setStatus('설정이 저장됐어요 ✅');
        });

        get('#se-s-close').addEventListener('click', () => {
            panel.style.display = 'none';
            GM_setValue(K_OPEN, false);
        });

        function togglePanel() {
            const open = getComputedStyle(panel).display !== 'none';

            if (open) {
                panel.style.display = 'none';
                GM_setValue(K_OPEN, false);
            } else {
                panel.style.display = 'flex';
                GM_setValue(K_OPEN, true);
                requestAnimationFrame(() => clampElement(panel));
            }
        }

        function run() {
            runButton.disabled = true;
            output.classList.remove('show');
            insertButton.classList.remove('show');
            resultButtons.classList.remove('show');
            setStatus('늘리는 중… ✍️');

            callGemini(
                dialogue.value,
                action.value,
                GM_getValue(K_POV, 'first'),
                GM_getValue(K_LENGTH, 'medium'),
                text => {
                    result = text;
                    output.textContent = text;
                    output.classList.add('show');
                    insertButton.classList.add('show');
                    resultButtons.classList.add('show');
                    runButton.disabled = false;
                    setStatus('');
                    clampElement(panel);
                },
                error => {
                    runButton.disabled = false;
                    setStatus(error, true);
                }
            );
        }

        runButton.addEventListener('click', run);

        get('#se-s-copy').addEventListener('click', () => {
            if (!result) return;

            copyText(result)
                .then(() => setStatus('복사했어요 📋'))
                .catch(() => setStatus('복사에 실패했어요.', true));
        });

        insertButton.addEventListener('click', () => {
            if (!result) return;

            const input = findChatInput();

            if (!input) {
                copyText(result)
                    .then(() => setStatus('채팅창을 못 찾아 결과를 복사했어요.', true))
                    .catch(() => setStatus('채팅창을 찾지 못했어요.', true));
                return;
            }

            setChatValue(input, result);
            dialogue.value = '';
            action.value = '';
            panel.style.display = 'none';
            GM_setValue(K_OPEN, false);
        });

        [dialogue, action].forEach(area => {
            area.addEventListener('keydown', event => {
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    run();
                }
            });
        });

        function makeDraggable(element, handle, saveKey, onTap) {
            let dragging = false;
            let moved = false;
            let pointerId = null;
            let offsetX = 0;
            let offsetY = 0;
            let startX = 0;
            let startY = 0;

            handle.addEventListener('pointerdown', event => {
                if (event.target.closest('button') && element === panel) return;

                dragging = true;
                moved = false;
                pointerId = event.pointerId;

                const rect = element.getBoundingClientRect();
                offsetX = event.clientX - rect.left;
                offsetY = event.clientY - rect.top;
                startX = event.clientX;
                startY = event.clientY;

                element.style.right = 'auto';
                element.style.bottom = 'auto';

                try {
                    handle.setPointerCapture(pointerId);
                } catch (_) {}

                event.preventDefault();
            }, { passive: false });

            handle.addEventListener('pointermove', event => {
                if (!dragging || event.pointerId !== pointerId) return;

                if (
                    Math.abs(event.clientX - startX) +
                    Math.abs(event.clientY - startY) > 8
                ) {
                    moved = true;
                }

                if (!moved) return;

                const viewport = getViewport();
                const width = element.offsetWidth;
                const height = element.offsetHeight;

                const left = clamp(
                    event.clientX - offsetX,
                    viewport.left + EDGE,
                    viewport.left + viewport.width - width - EDGE
                );

                const top = clamp(
                    event.clientY - offsetY,
                    viewport.top + EDGE,
                    viewport.top + viewport.height - Math.min(height, 80) - EDGE
                );

                element.style.left = left + 'px';
                element.style.top = top + 'px';

                event.preventDefault();
            }, { passive: false });

            function finish(event) {
                if (!dragging) return;
                if (event && event.pointerId !== pointerId) return;

                dragging = false;
                pointerId = null;

                clampElement(element, saveKey);

                if (!moved && typeof onTap === 'function') {
                    onTap();
                }

                moved = false;

                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            }

            handle.addEventListener('pointerup', finish, { passive: false });
            handle.addEventListener('pointercancel', finish, { passive: false });
        }

        makeDraggable(panel, get('#se-s-head'), K_PANEL_POS);
        makeDraggable(fab, fab, K_FAB_POS, togglePanel);

        const repair = () => {
            clampElement(fab);
            if (getComputedStyle(panel).display !== 'none') {
                clampElement(panel);
            }
        };

        window.addEventListener('resize', repair, { passive: true });
        window.addEventListener('orientationchange', () => {
            setTimeout(repair, 250);
        }, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', repair, { passive: true });
        }

        [0, 100, 400, 1000, 2500].forEach(delay => {
            setTimeout(repair, delay);
        });
    }

    function init() {
        if (document.getElementById(PANEL_ID)) return;

        injectStyle();
        buildUI();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
