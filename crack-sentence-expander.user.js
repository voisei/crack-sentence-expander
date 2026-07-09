// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini) · 시작채팅/캐시 핫픽스
// @namespace    https://crack.wrtn.ai
// @version      6.12.15
// @author       me
// @description  v6.12.13 전체 기능 + 특수 시작채팅 감지 + 맥락 미리보기 교체 + 채팅방별 캐시 지우기
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
     * v6.12.15 핫픽스
     *
     * 원본 v6.12.13의 모든 기능은 @require로 그대로 실행한다.
     * 이 아래 코드는 원본 내부 함수를 건드리지 않고 다음만 보강한다.
     *
     * 1) 채팅방에 처음 들어왔을 때 시작 메시지를 즉시 캐시에 저장
     * 2) SPA 방식으로 채팅방을 이동해도 새 방의 시작 메시지를 다시 저장
     * 3) 스트리밍 중간 조각이 캐시에 쌓이지 않도록 정리
     * 4) 일반 말풍선 구조가 아닌 첫 시작 화면의 텍스트도 수집
     * 5) 원본 맥락 미리보기 버튼을 새 수집기로 교체
     * 6) 설정의 "이 채팅방 캐시 지우기" 버튼 복구
     * 7) document.body 전체를 상시 감시하지 않고 채팅 영역만 감시
     */

    const K_CTX_CACHE_BASE = 'se_ctx_cache_by_room';
    const CTX_CACHE_LIMIT = 300;

    let observer = null;
    let observedRoot = null;
    let scanTimer = null;
    let routeTimer = null;
    let uiTimer = null;
    let lastUrl = location.href;

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

        /*
         * 메시지 그룹을 먼저 읽는다.
         * 시작 메시지가 일반 wrtn-markdown과 다른 구조여도 여기서 잡힌다.
         */
        const groups = Array.from(
            document.querySelectorAll('[data-message-group-id]')
        ).filter(group => !panel || !panel.contains(group));

        for (const group of groups) {
            collected.push(...extractFromMessageGroup(group));
        }

        /*
         * 그룹 밖에 독립적으로 렌더링된 시작 메시지/프롤로그도 읽는다.
         */
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

        /*
         * 사이트 구조가 바뀐 경우를 위한 마지막 비상 수집.
         */
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

        /*
         * 첫 시작 화면은 message-group / wrtn-markdown이 아닌
         * 일반 React div와 p 태그로 표시되는 경우가 있다.
         * 채팅 입력창 주변의 실제 보이는 '잎 텍스트 블록'도 후보로 읽는다.
         */
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

                // 입력창 아래쪽이나 화면 밖의 UI는 제외
                if (rect.top >= inputTop + 20) return false;

                // 큰 부모 래퍼 대신 실제 본문에 가까운 안쪽 블록만 사용
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

            /*
             * p/li 같은 태그도 없는 완전한 div 기반 시작문구를 위한 최종 수집.
             * 텍스트 노드의 부모가 작은 보이는 블록일 때만 가져온다.
             */
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

                            // 페이지 전체를 감싼 거대한 부모 텍스트는 제외
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

        return uniqueLines(collected);
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

            // 화면의 대화 본문과 입력창을 함께 감싼 정도에서 멈춘다.
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

        // 첫 시작 화면처럼 전용 메시지 선택자가 없을 때는 입력창의 대화 컨테이너 감시
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
            /*
             * 스트리밍 글자 하나마다 저장하지 않고
             * 변화가 잠잠해졌을 때 한 번만 저장한다.
             */
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
            return;
        }

        if (!observedRoot || !document.contains(observedRoot)) {
            attachObserver();
        }
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
                .replace(/v6\.12\.(?:13|14)/g, 'v6.12.15');
        }

        let previewButton = panel.querySelector('#se-ctx-test');
        if (!previewButton) return false;

        /*
         * 원본 버튼에 달린 기존 클릭 리스너를 제거하기 위해 복제 교체한다.
         * 이제 미리보기는 이 핫픽스의 특수 시작화면 감지기를 직접 사용한다.
         */
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
                setContextStatus('첫 시작채팅까지 다시 찾는 중이에요…', false);

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
                                '아직 대화를 못 잡았어요 😢\n' +
                                '현재 화면에서 시작문구가 보이게 둔 뒤 한 번 더 눌러보세요.',
                                true
                            );
                            return;
                        }

                        setContextStatus(
                            arr.length + '개 참고 예정 (요청 ' + n + '개)' +
                            ' / 현재 화면 후보 ' + visible.length +
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

        /*
         * 원본 CSS에 버튼 스타일이 빠진 버전에서도
         * 다른 설정 버튼과 같은 모양으로 보이게 한다.
         */
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

        return true;
    }

    function start() {
        /*
         * @require 원본 UI가 생성된 직후 버튼을 붙인다.
         * 사이트 렌더링이 늦어도 일정 시간 동안만 확인한다.
         */
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

        /*
         * 첫 채팅은 이미 렌더링돼 있을 수 있으므로
         * 즉시/조금 뒤/렌더링 완료 뒤 세 차례 읽는다.
         */
        setTimeout(scanNow, 50);
        setTimeout(() => {
            attachObserver();
            scanNow();
        }, 500);
        setTimeout(() => {
            attachObserver();
            scanNow();
        }, 1300);

        /*
         * SPA 주소 이동과 채팅 루트 교체만 가볍게 확인한다.
         * 실제 메시지 수집은 MutationObserver의 디바운스 방식이다.
         */
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
