// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini) · 시작채팅/캐시 핫픽스
// @namespace    https://crack.wrtn.ai
// @version      6.12.17
// @author       me
// @description  v6.12.13 전체 기능 + 시작 상황 카드 전체 감지 + 맥락 미리보기 교체 + 채팅방별 캐시 지우기 + 모바일 이동 범위 제한
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @require      https://raw.githubusercontent.com/voisei/crack-sentence-expander/refs/heads/main/crack-sentence-expander.user.js
// @homepageURL  https://github.com/voisei/crack-sentence-expander
// @supportURL   https://github.com/voisei/crack-sentence-expander/issues
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /*
     * v6.12.17 핫픽스
     *
     * 원본 v6.12.13의 모든 기능은 @require로 그대로 실행한다.
     * 이 아래 코드는 원본 내부 함수를 건드리지 않고 다음만 보강한다.
     *
     * 1) 채팅방에 처음 들어왔을 때 시작 메시지를 즉시 캐시에 저장
     * 2) SPA 방식으로 채팅방을 이동해도 새 방의 시작 메시지를 다시 저장
     * 3) 스트리밍 중간 조각이 캐시에 쌓이지 않도록 정리
     * 4) 일반 말풍선 구조가 아닌 첫 시작 화면의 텍스트도 수집
     * 5) 입력창 위의 큰 '시작 상황/프롤로그 카드'를 한 덩어리로 수집
     * 6) 원본 맥락 미리보기 버튼을 새 수집기로 교체
     * 7) 설정의 "이 채팅방 캐시 지우기" 버튼 복구
     * 8) document.body 전체를 상시 감시하지 않고 채팅 영역만 감시
     * 9) 모바일에서 실행 버튼과 패널이 화면 밖으로 나가지 않게 제한
     */

    const K_CTX_CACHE_BASE = 'se_ctx_cache_by_room';
    const CTX_CACHE_LIMIT = 300;
    const MOBILE_EDGE_GAP = 12;

    let observer = null;
    let observedRoot = null;
    let scanTimer = null;
    let routeTimer = null;
    let uiTimer = null;
    let lastUrl = location.href;

    let positionGuardObserver = null;
    let positionGuardTimer = null;

    function getCurrentChatCacheKey() {
        const path = location.pathname || '';
        const search = location.search || '';
        const hash = location.hash || '';

        return K_CTX_CACHE_BASE + '::' + path + search + hash;
    }

    function getCtxCache() {
        const arr = GM_getValue(getCurrentChatCacheKey(), []);
        return Array.isArray(arr) ? arr : [];
    }

    function saveCtxCache(arr) {
        GM_setValue(
            getCurrentChatCacheKey(),
            Array.isArray(arr) ? arr.slice(-CTX_CACHE_LIMIT) : []
        );
    }

    function clearCtxCache() {
        GM_setValue(getCurrentChatCacheKey(), []);
    }

    function cleanContextLine(text) {
        return String(text || '')
            .replace(/\/stories\/[^\s]+\/episodes\/[^\s]+/g, ' ')
            .replace(/^\s*\[\s*턴\s*\d+\s*[|｜][^\]]*\]\s*/i, ' ')
            .replace(/^\s*\[[^\]]*\d+\s*일차[^\]]*\]\s*/i, ' ')
            .replace(/\b(?:복사|다시 생성|삭제|수정|공유)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isBadContextLine(line) {
        if (!line || line.length < 2 || line.length > 6000) return true;

        const bannedExact = new Set([
            '문장 부풀리기',
            '대사',
            '행동',
            '1인칭',
            '3인칭',
            '세줄',
            '짧게',
            '중간',
            '길게',
            '문학적으로 늘리기',
            '채팅창에 바로 넣기',
            '복사',
            '다시 뽑기',
            '설정',
            '저장',
            '닫기',
            '확인',
            '취소',
            '삭제',
            '수정',
            '뒤로',
            '추가',
            '최신순',
            '오래된순',
            '이 채팅방 캐시 지우기',
        ]);

        if (bannedExact.has(line)) return true;
        if (/^✨?\s*문장 부풀리기/.test(line)) return true;
        if (/Gemini API|API 키|사용 가능한 모델|페르소나 자동추천/.test(line)) return true;
        if (/최근 대화 맥락 참고|맥락 미리보기/.test(line)) return true;
        if (/설정 동기화|내보내기|가져오기/.test(line)) return true;
        if (/^\s*\[\s*턴\s*\d+\s*[|｜][^\]]*\]\s*$/.test(line)) return true;
        if (/^\s*\[[^\]]*\d+\s*일차[^\]]*\]\s*$/.test(line)) return true;
        if (/^[\s\W_]+$/.test(line)) return true;

        return false;
    }

    function dropStreamingPrefixes(lines) {
        const out = [];

        for (const current of lines || []) {
            while (out.length) {
                const previous = out[out.length - 1];

                if (
                    current.length > previous.length &&
                    current.startsWith(previous)
                ) {
                    out.pop();
                    continue;
                }

                break;
            }

            out.push(current);
        }

        return out;
    }

    function uniqueLines(lines) {
        const out = [];
        const seen = new Set();

        for (const raw of lines || []) {
            const line = cleanContextLine(raw);

            if (isBadContextLine(line)) continue;
            if (seen.has(line)) continue;

            seen.add(line);
            out.push(line);
        }

        return dropStreamingPrefixes(out);
    }

    function rememberLines(lines) {
        const old = getCtxCache();
        const merged = old.slice();
        const recentSeen = new Set(old.slice(-80));

        for (const line of uniqueLines(lines)) {
            const last = merged[merged.length - 1];

            if (last === line) continue;
            if (recentSeen.has(line)) continue;

            recentSeen.add(line);
            merged.push(line);
        }

        saveCtxCache(dropStreamingPrefixes(merged));
    }

    function extractFromMessageGroup(group) {
        if (!group) return [];
        if (group.closest && group.closest('#se-panel')) return [];

        const values = [];

        const markdowns = Array.from(
            group.querySelectorAll('.wrtn-markdown')
        ).filter(el => !el.querySelector('.wrtn-markdown'));

        for (const el of markdowns) {
            const text = cleanContextLine(
                el.innerText || el.textContent || ''
            );

            if (!isBadContextLine(text)) values.push(text);
        }

        const plainNodes = Array.from(group.querySelectorAll(
            '[class*="whitespace-pre-wrap"],' +
            '[class*="break-words"],' +
            '[data-testid*="user"],' +
            '[data-role="user"]'
        )).filter(el => {
            if (el.closest('.wrtn-markdown')) return false;
            if (el.querySelector('textarea, input, button, select')) return false;
            return true;
        });

        for (const el of plainNodes) {
            const text = cleanContextLine(
                el.innerText || el.textContent || ''
            );

            if (!isBadContextLine(text)) values.push(text);
        }

        return uniqueLines(values);
    }

    function collectVisibleChatLines() {
        const panel = document.getElementById('se-panel');
        const collected = [];

        const groups = Array.from(
            document.querySelectorAll('[data-message-group-id]')
        ).filter(group => !panel || !panel.contains(group));

        for (const group of groups) {
            collected.push(...extractFromMessageGroup(group));
        }

        const orphanMarkdowns = Array.from(
            document.querySelectorAll('.wrtn-markdown')
        ).filter(el => {
            if (panel && panel.contains(el)) return false;
            if (el.querySelector('.wrtn-markdown')) return false;
            if (el.closest('[data-message-group-id]')) return false;
            return true;
        });

        for (const el of orphanMarkdowns) {
            const text = cleanContextLine(
                el.innerText || el.textContent || ''
            );

            if (!isBadContextLine(text)) collected.push(text);
        }

        const fallbackNodes = Array.from(document.querySelectorAll(
            '[data-testid*="assistant"],' +
            '[data-testid*="message"],' +
            '[data-role="assistant"],' +
            '[data-role="message"]'
        )).filter(el => {
            if (panel && panel.contains(el)) return false;
            if (el.closest('[data-message-group-id]')) return false;
            if (el.closest('.wrtn-markdown')) return false;
            if (el.querySelector('textarea, input, button, select')) return false;

            const nested = el.querySelectorAll(
                '[data-testid*="assistant"],' +
                '[data-testid*="message"],' +
                '[data-role="assistant"],' +
                '[data-role="message"]'
            );

            return nested.length === 0;
        });

        for (const el of fallbackNodes) {
            const text = cleanContextLine(
                el.innerText || el.textContent || ''
            );

            if (!isBadContextLine(text)) collected.push(text);
        }

        const chatInput = findPageChatInput();
        const genericRoot =
            (chatInput && findConversationRootFromInput(chatInput)) ||
            document.querySelector('main') ||
            document.body;

        if (genericRoot) {
            const inputTop = chatInput
                ? chatInput.getBoundingClientRect().top
                : Number.POSITIVE_INFINITY;

            const genericNodes = Array.from(genericRoot.querySelectorAll(
                'p, li, blockquote, article, [role="article"],' +
                '[class*="whitespace-pre-wrap"], [class*="break-words"],' +
                '[data-testid*="content"], [data-testid*="text"]'
            )).filter(el => {
                if (!el || el === genericRoot) return false;
                if (panel && panel.contains(el)) return false;
                if (el.closest('#se-panel, nav, header, footer, aside')) return false;
                if (el.closest('button, textarea, input, select, [contenteditable="true"]')) return false;
                if (!isElementVisible(el)) return false;

                const rect = el.getBoundingClientRect();

                if (rect.top >= inputTop + 20) return false;

                const childTextBlock = Array.from(el.children || []).some(child => {
                    const childText = cleanContextLine(
                        child.innerText || child.textContent || ''
                    );
                    return childText.length >= 2;
                });

                if (childTextBlock) return false;

                return true;
            });

            for (const el of genericNodes) {
                const text = cleanContextLine(
                    el.innerText || el.textContent || ''
                );

                if (!isBadContextLine(text)) collected.push(text);
            }

            if (!uniqueLines(collected).length || uniqueLines(collected).length < 2) {
                const walker = document.createTreeWalker(
                    genericRoot,
                    NodeFilter.SHOW_TEXT,
                    {
                        acceptNode(node) {
                            const text = cleanContextLine(node.nodeValue || '');
                            const parent = node.parentElement;

                            if (!parent || isBadContextLine(text)) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            if (panel && panel.contains(parent)) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            if (parent.closest(
                                '#se-panel, nav, header, footer, aside,' +
                                'button, textarea, input, select, script, style'
                            )) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            if (!isElementVisible(parent)) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            const rect = parent.getBoundingClientRect();

                            if (rect.top >= inputTop + 20) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            if (
                                rect.width > window.innerWidth * 0.98 &&
                                rect.height > window.innerHeight * 0.8
                            ) {
                                return NodeFilter.FILTER_REJECT;
                            }

                            return NodeFilter.FILTER_ACCEPT;
                        }
                    }
                );

                let node;
                while ((node = walker.nextNode())) {
                    const text = cleanContextLine(node.nodeValue || '');
                    if (!isBadContextLine(text)) collected.push(text);
                }
            }
        }

        const scenarioCards = collectScenarioCards();

        for (const cardText of scenarioCards) {
            collected.push(cardText);
        }

        return uniqueLines(collected);
    }

    function collectScenarioCards() {
        const panel = document.getElementById('se-panel');
        const input = findPageChatInput();

        if (!input) return [];

        const root =
            findConversationRootFromInput(input) ||
            document.querySelector('main') ||
            document.body;

        if (!root) return [];

        const inputRect = input.getBoundingClientRect();
        const inputTop = inputRect.top;
        const candidates = [];

        const elements = Array.from(root.querySelectorAll(
            'article, section, [role="article"], div'
        ));

        for (const el of elements) {
            if (!el || el === root) continue;
            if (panel && panel.contains(el)) continue;

            if (el.closest(
                '#se-panel, nav, header, footer, aside, button,' +
                'textarea, input, select, script, style'
            )) {
                continue;
            }

            if (el.contains(input)) continue;
            if (!isElementVisible(el)) continue;

            const rect = el.getBoundingClientRect();

            if (rect.top >= inputTop) continue;
            if (rect.bottom > inputTop + 30) continue;
            if (rect.width < Math.min(220, window.innerWidth * 0.48)) continue;
            if (rect.height < 90) continue;

            let text = cleanContextLine(
                el.innerText || el.textContent || ''
            );

            if (text.length < 120 || text.length > 14000) continue;

            const uiNoise = [
                '앱에서 더 편하게',
                '다운로드',
                'AI 요약',
                '프로챗',
                '메시지 보내기',
                '문장 부풀리기',
                'API 비용 추정',
                '유저 페르소나',
                '기본 설정',
                '설정 동기화'
            ];

            const noiseCount = uiNoise.reduce((count, word) => {
                return count + (text.includes(word) ? 1 : 0);
            }, 0);

            if (noiseCount >= 2) continue;

            if (
                rect.width > window.innerWidth * 0.98 &&
                rect.height > window.innerHeight * 0.92
            ) {
                continue;
            }

            const childCandidates = Array.from(el.children || [])
                .filter(child => {
                    if (!isElementVisible(child)) return false;

                    const childText = cleanContextLine(
                        child.innerText || child.textContent || ''
                    );

                    return childText.length >= Math.max(100, text.length * 0.72);
                });

            if (childCandidates.length) continue;

            const distance = Math.max(0, inputTop - rect.bottom);
            const depth = getElementDepth(el);

            const score =
                Math.min(text.length, 6000) / 12
                + Math.min(rect.height, 1200) / 8
                + depth * 4
                - distance / 8
                - noiseCount * 200;

            candidates.push({
                el,
                text,
                rect,
                score
            });
        }

        candidates.sort((a, b) => b.score - a.score);

        const chosen = [];

        for (const candidate of candidates) {
            if (chosen.length >= 2) break;

            const overlaps = chosen.some(selected => {
                const a = candidate.rect;
                const b = selected.rect;

                const horizontal =
                    Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const vertical =
                    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);

                return horizontal > 0 && vertical > 0;
            });

            if (overlaps) continue;

            chosen.push(candidate);
        }

        return chosen
            .sort((a, b) => a.rect.top - b.rect.top)
            .map(item => item.text);
    }

    function getElementDepth(el) {
        let depth = 0;
        let current = el;

        while (current && current !== document.body) {
            depth += 1;
            current = current.parentElement;
        }

        return depth;
    }

    function isElementVisible(el) {
        if (!el || !el.getBoundingClientRect) return false;

        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;

        const style = getComputedStyle(el);

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function findPageChatInput() {
        const panel = document.getElementById('se-panel');

        const candidates = Array.from(document.querySelectorAll(
            'textarea, [contenteditable="true"], [contenteditable=""]'
        )).filter(el => {
            if (panel && panel.contains(el)) return false;
            return isElementVisible(el);
        });

        if (!candidates.length) return null;

        candidates.sort((a, b) => {
            return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        });

        return candidates[0];
    }

    function findConversationRootFromInput(input) {
        if (!input) return null;

        let root = input.parentElement;
        let best = root;

        for (let i = 0; root && root !== document.body && i < 10; i++) {
            const text = cleanContextLine(
                root.innerText || root.textContent || ''
            );

            if (text.length >= 20) best = root;

            const rect = root.getBoundingClientRect();

            if (
                rect.height >= window.innerHeight * 0.55 ||
                root.tagName === 'MAIN'
            ) {
                return root;
            }

            root = root.parentElement;
        }

        return best || document.querySelector('main');
    }

    function scanNow() {
        try {
            const lines = collectVisibleChatLines();
            if (lines.length) rememberLines(lines);
        } catch (error) {
            console.warn('[문장 부풀리기 핫픽스] 맥락 수집 실패:', error);
        }
    }

    function scheduleScan(delay) {
        if (scanTimer) clearTimeout(scanTimer);

        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanNow();
        }, Number.isFinite(delay) ? delay : 1200);
    }

    function findChatRoot() {
        const firstGroup = document.querySelector('[data-message-group-id]');

        if (firstGroup) {
            let root = firstGroup.parentElement;

            while (
                root &&
                root !== document.body &&
                root.querySelectorAll('[data-message-group-id]').length < 2
            ) {
                root = root.parentElement;
            }

            if (root && root !== document.body) return root;
            return firstGroup.parentElement;
        }

        const firstMarkdown = Array.from(
            document.querySelectorAll('.wrtn-markdown')
        ).find(el => !el.closest('#se-panel'));

        if (firstMarkdown) {
            let root = firstMarkdown.parentElement;

            while (
                root &&
                root !== document.body &&
                root.querySelectorAll('.wrtn-markdown').length < 2
            ) {
                root = root.parentElement;
            }

            if (root && root !== document.body) return root;
            return firstMarkdown.parentElement;
        }

        const input = findPageChatInput();
        return findConversationRootFromInput(input);
    }

    function disconnectObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }

        observedRoot = null;
    }

    function attachObserver() {
        const nextRoot = findChatRoot();

        if (!nextRoot) {
            scheduleScan(400);
            return;
        }

        if (
            observer &&
            observedRoot === nextRoot &&
            document.contains(nextRoot)
        ) {
            return;
        }

        disconnectObserver();

        observedRoot = nextRoot;
        observer = new MutationObserver(() => {
            scheduleScan(1100);
        });

        observer.observe(nextRoot, {
            childList: true,
            subtree: true,
            characterData: true
        });

        scheduleScan(80);
    }

    function checkRoute() {
        const routeChanged = location.href !== lastUrl;

        if (routeChanged) {
            lastUrl = location.href;
            disconnectObserver();

            setTimeout(attachObserver, 150);
            setTimeout(attachObserver, 600);
            setTimeout(scanNow, 1000);
            setTimeout(clampAllFloatingElements, 700);
            return;
        }

        if (!observedRoot || !document.contains(observedRoot)) {
            attachObserver();
        }

        schedulePositionClamp(0);
    }

    function setContextStatus(message, isError) {
        const status = document.getElementById('se-ctx-status');
        if (!status) return;

        status.textContent = message;
        status.classList.toggle('err', !!isError);
    }

    function installClearButton() {
        const panel = document.getElementById('se-panel');
        if (!panel) return false;

        const title = panel.querySelector('#se-title');
        if (title) {
            title.textContent = (title.textContent || '')
                .replace(/v6\.12\.(?:13|14|15|16)/g, 'v6.12.17');
        }

        let previewButton = panel.querySelector('#se-ctx-test');
        if (!previewButton) return false;

        if (!previewButton.dataset.seHotfixPreview) {
            const freshPreview = previewButton.cloneNode(true);
            freshPreview.dataset.seHotfixPreview = '1';
            previewButton.replaceWith(freshPreview);
            previewButton = freshPreview;

            previewButton.addEventListener('click', () => {
                const nInput = panel.querySelector('#se-ctx-n');
                const n = Math.max(
                    1,
                    Math.min(30, parseInt(nInput && nInput.value, 10) || 6)
                );

                GM_setValue('se_ctx_n', n);
                previewButton.disabled = true;
                setContextStatus('시작 상황 카드와 최근 채팅을 같이 읽는 중이에요…', false);

                setTimeout(() => {
                    try {
                        const visible = collectVisibleChatLines();
                        rememberLines(visible);

                        const arr = uniqueLines([
                            ...getCtxCache(),
                            ...visible,
                        ]).slice(-n);

                        if (!arr.length) {
                            setContextStatus(
                                '아직 시작 상황을 못 잡았어요 😢\n' +
                                '노란 상황 카드와 메시지 입력창이 함께 보이게 둔 뒤 다시 눌러보세요.',
                                true
                            );
                            return;
                        }

                        setContextStatus(
                            arr.length + '개 참고 예정 (요청 ' + n + '개)' +
                            ' / 화면 문맥 후보 ' + visible.length +
                            '개 / 누적 캐시 ' + getCtxCache().length + '개\n' +
                            arr.map((text, index) => {
                                const short = text.length > 150
                                    ? text.slice(0, 150) + '…'
                                    : text;

                                return (index + 1) + '. ' + short;
                            }).join('\n'),
                            false
                        );
                    } catch (error) {
                        console.warn(
                            '[문장 부풀리기 핫픽스] 미리보기 실패:',
                            error
                        );

                        setContextStatus(
                            '맥락을 읽는 중 오류가 났어요 😢 페이지를 새로고침한 뒤 다시 눌러보세요.',
                            true
                        );
                    } finally {
                        previewButton.disabled = false;
                    }
                }, 80);
            });
        }

        let button = panel.querySelector('#se-ctx-clear');
        if (button) return true;

        const buttonWrap =
            previewButton.closest('.se-ctx-btns') ||
            previewButton.parentElement;

        if (!buttonWrap) return false;

        button = document.createElement('button');
        button.id = 'se-ctx-clear';
        button.type = 'button';
        button.textContent = '🧹 이 채팅방 캐시 지우기';

        button.addEventListener('click', () => {
            clearCtxCache();

            setContextStatus(
                '현재 채팅방의 저장된 맥락 캐시를 지웠어요 🧹\n' +
                '다음 미리보기나 문장 생성 때 현재 화면의 대화부터 다시 저장돼요.',
                false
            );
        });

        buttonWrap.appendChild(button);

        if (!document.getElementById('se-context-hotfix-style')) {
            const style = document.createElement('style');
            style.id = 'se-context-hotfix-style';
            style.textContent = `
                #se-ctx-clear {
                    padding: 8px;
                    border: 1px solid #4a4f63;
                    border-radius: 9px;
                    cursor: pointer;
                    background: #23262f;
                    color: #cdd1e0;
                    font-size: 12px;
                    font-weight: 600;
                    flex: 1;
                    min-width: 0;
                }
                #se-ctx-clear:hover {
                    background: #2d3140;
                }
                @media (pointer: coarse), (max-width: 700px) {
                    #se-ctx-clear {
                        min-height: 40px;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        schedulePositionClamp(0);
        return true;
    }

    function getSafeViewport() {
        const viewport = window.visualViewport;

        return {
            left: viewport ? viewport.offsetLeft : 0,
            top: viewport ? viewport.offsetTop : 0,
            width: viewport ? viewport.width : window.innerWidth,
            height: viewport ? viewport.height : window.innerHeight
        };
    }

    function isFloatingElement(el) {
        if (!el || !document.body.contains(el)) return false;

        const style = getComputedStyle(el);

        return (
            style.position === 'fixed' ||
            style.position === 'absolute'
        );
    }

    function findSentenceExpanderFloatingElements() {
        const panel = document.getElementById('se-panel');
        const result = [];

        if (panel) result.push(panel);

        const selectors = [
            '#se-fab',
            '#se-toggle',
            '#se-launcher',
            '#se-floating-button',
            '#se-open-btn',
            '#se-main-button',
            '[id^="se-fab"]',
            '[id^="se-toggle"]',
            '[id^="se-launch"]',
            '[data-se-fab]',
            '[aria-label*="문장 부풀리기"]',
            '[title*="문장 부풀리기"]'
        ];

        for (const selector of selectors) {
            let elements = [];

            try {
                elements = Array.from(document.querySelectorAll(selector));
            } catch (_) {
                continue;
            }

            for (const el of elements) {
                if (panel && panel.contains(el)) continue;
                if (!result.includes(el)) result.push(el);
            }
        }

        const fixedCandidates = Array.from(
            document.querySelectorAll('button, [role="button"], div')
        ).filter(el => {
            if (panel && panel.contains(el)) return false;
            if (!isFloatingElement(el)) return false;

            const rect = el.getBoundingClientRect();
            if (rect.width < 32 || rect.height < 32) return false;
            if (rect.width > 130 || rect.height > 130) return false;

            const style = getComputedStyle(el);
            const zIndex = parseInt(style.zIndex, 10);

            if (Number.isFinite(zIndex) && zIndex < 100) return false;

            const text = String(
                el.getAttribute('aria-label') ||
                el.getAttribute('title') ||
                el.textContent ||
                ''
            ).trim();

            return (
                text.includes('✨') ||
                text.includes('문장') ||
                text.includes('부풀리기')
            );
        });

        for (const el of fixedCandidates) {
            if (!result.includes(el)) result.push(el);
        }

        return result;
    }

    function clampFloatingElement(el) {
        if (!el || !document.body.contains(el)) return false;

        const style = getComputedStyle(el);

        if (
            style.display === 'none' ||
            style.visibility === 'hidden'
        ) {
            return false;
        }

        const viewport = getSafeViewport();
        const rect = el.getBoundingClientRect();

        if (rect.width < 2 || rect.height < 2) return false;

        const gap = MOBILE_EDGE_GAP;
        const minLeft = viewport.left + gap;
        const minTop = viewport.top + gap;

        const maxLeft = Math.max(
            minLeft,
            viewport.left + viewport.width - rect.width - gap
        );

        const visibleHeight = el.id === 'se-panel'
            ? Math.min(rect.height, 100)
            : rect.height;

        const maxTop = Math.max(
            minTop,
            viewport.top + viewport.height - visibleHeight - gap
        );

        const safeLeft = Math.min(
            maxLeft,
            Math.max(minLeft, rect.left)
        );

        const safeTop = Math.min(
            maxTop,
            Math.max(minTop, rect.top)
        );

        const moved =
            Math.abs(safeLeft - rect.left) > 0.5 ||
            Math.abs(safeTop - rect.top) > 0.5;

        if (!moved) return false;

        el.style.setProperty('position', 'fixed', 'important');
        el.style.setProperty('left', safeLeft + 'px', 'important');
        el.style.setProperty('top', safeTop + 'px', 'important');
        el.style.setProperty('right', 'auto', 'important');
        el.style.setProperty('bottom', 'auto', 'important');
        el.style.setProperty('transform', 'none', 'important');

        return true;
    }

    function clampAllFloatingElements() {
        const elements = findSentenceExpanderFloatingElements();

        for (const el of elements) {
            clampFloatingElement(el);
        }
    }

    function schedulePositionClamp(delay) {
        if (positionGuardTimer) {
            clearTimeout(positionGuardTimer);
        }

        positionGuardTimer = setTimeout(() => {
            positionGuardTimer = null;
            clampAllFloatingElements();
        }, Number.isFinite(delay) ? delay : 30);
    }

    function installMobilePositionGuard() {
        if (!document.getElementById('se-mobile-position-guard-style')) {
            const style = document.createElement('style');
            style.id = 'se-mobile-position-guard-style';
            style.textContent = `
                @media (pointer: coarse), (max-width: 700px) {
                    #se-panel {
                        max-width: calc(100vw - 24px) !important;
                        max-height: calc(100dvh - 24px) !important;
                        overscroll-behavior: contain !important;
                    }

                    #se-panel > * {
                        max-width: 100% !important;
                    }

                    #se-fab,
                    #se-toggle,
                    #se-launcher,
                    #se-floating-button,
                    #se-open-btn,
                    #se-main-button,
                    [id^="se-fab"],
                    [id^="se-toggle"],
                    [id^="se-launch"] {
                        touch-action: none !important;
                    }
                }
            `;

            document.head.appendChild(style);
        }

        const moveEvents = [
            'pointermove',
            'touchmove',
            'mousemove'
        ];

        for (const eventName of moveEvents) {
            document.addEventListener(
                eventName,
                () => schedulePositionClamp(0),
                { capture: true, passive: true }
            );
        }

        const endEvents = [
            'pointerup',
            'pointercancel',
            'touchend',
            'touchcancel',
            'mouseup'
        ];

        for (const eventName of endEvents) {
            document.addEventListener(
                eventName,
                () => schedulePositionClamp(0),
                true
            );
        }

        window.addEventListener(
            'resize',
            () => schedulePositionClamp(20),
            { passive: true }
        );

        window.addEventListener(
            'orientationchange',
            () => {
                schedulePositionClamp(50);
                setTimeout(clampAllFloatingElements, 300);
            },
            { passive: true }
        );

        if (window.visualViewport) {
            window.visualViewport.addEventListener(
                'resize',
                () => schedulePositionClamp(20),
                { passive: true }
            );

            window.visualViewport.addEventListener(
                'scroll',
                () => schedulePositionClamp(20),
                { passive: true }
            );
        }

        if (!positionGuardObserver) {
            positionGuardObserver = new MutationObserver(mutations => {
                const shouldCheck = mutations.some(mutation => {
                    if (mutation.type === 'attributes') return true;

                    return Array.from(mutation.addedNodes || []).some(node => {
                        return (
                            node.nodeType === Node.ELEMENT_NODE &&
                            (
                                node.id === 'se-panel' ||
                                node.querySelector?.('#se-panel') ||
                                String(node.id || '').startsWith('se-')
                            )
                        );
                    });
                });

                if (shouldCheck) {
                    schedulePositionClamp(30);
                }
            });

            positionGuardObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['style', 'class']
            });
        }

        [0, 100, 300, 700, 1500, 3000].forEach(delay => {
            setTimeout(clampAllFloatingElements, delay);
        });
    }

    function start() {
        installMobilePositionGuard();

        let attempts = 0;

        uiTimer = setInterval(() => {
            attempts += 1;

            const installed = installClearButton();

            if (installed || attempts >= 40) {
                clearInterval(uiTimer);
                uiTimer = null;
            }
        }, 250);

        attachObserver();

        setTimeout(scanNow, 50);
        setTimeout(() => {
            attachObserver();
            scanNow();
            clampAllFloatingElements();
        }, 500);
        setTimeout(() => {
            attachObserver();
            scanNow();
            clampAllFloatingElements();
        }, 1300);

        routeTimer = setInterval(checkRoute, 1800);

        window.addEventListener('popstate', () => {
            setTimeout(checkRoute, 80);
        });

        window.addEventListener('hashchange', () => {
            setTimeout(checkRoute, 80);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
