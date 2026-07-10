// ==UserScript==
// @name         크랙 문장 부풀리기 · 시작화면 맥락 강제수집 핫픽스
// @namespace    https://crack.wrtn.ai
// @version      1.0.0
// @author       me
// @description  v6.12.22 풀기능판과 함께 사용. 시작 상황 카드/플레이 가이드/상태창을 맥락으로 강제 저장하고 실제 채팅방까지 이어줌.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CACHE_BASE = 'se_ctx_cache_by_room';
    const STORY_CACHE_BASE = 'se_ctx_story_bootstrap';
    const CACHE_LIMIT = 300;

    let lastUrl = location.href;
    let scanTimer = null;
    let observer = null;

    function exactCacheKey() {
        return CACHE_BASE + '::' +
            (location.pathname || '') +
            (location.search || '') +
            (location.hash || '');
    }

    function getStoryId() {
        const match = (location.pathname || '').match(/\/stories\/([^/?#]+)/i);
        return match ? match[1] : '';
    }

    function storyCacheKey() {
        const storyId = getStoryId();
        return storyId ? STORY_CACHE_BASE + '::' + storyId : '';
    }

    function clean(text) {
        return String(text || '')
            .replace(/\/stories\/[^\s]+\/episodes\/[^\s]+/g, ' ')
            .replace(/^\s*\[\s*턴\s*\d+\s*[|｜][^\]]*\]\s*/i, ' ')
            .replace(/^\s*\[[^\]]*\d+\s*일차[^\]]*\]\s*/i, ' ')
            .replace(/\b(?:복사|다시 생성|삭제|수정|공유)\b/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function bad(text) {
        if (!text || text.length < 2 || text.length > 14000) return true;

        const exact = new Set([
            '문장 부풀리기',
            '페르소나 / 자동추천',
            '문체 규칙',
            '최근 대화 맥락',
            'API / 모델 / 기본 설정',
            'API 비용 추정 / 사용내역',
            '설정 동기화',
            '저장하고 닫기',
            '맥락 참고',
            '맥락 미리보기',
            '이 채팅방 캐시 지우기',
            '열기',
            '닫기',
            '메시지 보내기'
        ]);

        if (exact.has(text)) return true;
        if (/^✨?\s*문장 부풀리기/.test(text)) return true;
        if (/API 키|Gemini|모델 드롭다운|페르소나 자동추천/.test(text)) return true;
        if (/^[\s\W_]+$/.test(text)) return true;

        return false;
    }

    function visible(el) {
        if (!el || !el.getBoundingClientRect) return false;

        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);

        return (
            rect.width > 2 &&
            rect.height > 2 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
        );
    }

    function unique(lines) {
        const out = [];
        const seen = new Set();

        for (const raw of lines || []) {
            const text = clean(raw);

            if (bad(text) || seen.has(text)) continue;

            seen.add(text);
            out.push(text);
        }

        return out;
    }

    function readCache(key) {
        if (!key) return [];

        const value = GM_getValue(key, []);
        return Array.isArray(value) ? value : [];
    }

    function writeCache(key, lines) {
        if (!key) return;

        GM_setValue(key, unique(lines).slice(-CACHE_LIMIT));
    }

    function mergeIntoCache(key, lines) {
        const old = readCache(key);
        const merged = old.slice();

        for (const text of unique(lines)) {
            if (merged.includes(text)) continue;
            merged.push(text);
        }

        writeCache(key, merged);
    }

    function getChatInput() {
        const panel = document.getElementById('se-panel');

        const inputs = Array.from(document.querySelectorAll(
            'textarea, [contenteditable="true"], [contenteditable=""]'
        )).filter(el => {
            if (panel && panel.contains(el)) return false;
            return visible(el);
        });

        inputs.sort((a, b) => {
            return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        });

        return inputs[0] || null;
    }

    function collectMarkdowns() {
        const panel = document.getElementById('se-panel');
        const output = [];

        const nodes = Array.from(document.querySelectorAll('.wrtn-markdown'))
            .filter(el => {
                if (panel && panel.contains(el)) return false;
                if (el.querySelector('.wrtn-markdown')) return false;
                return visible(el);
            })
            .sort((a, b) => {
                return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
            });

        for (const el of nodes) {
            const text = clean(el.innerText || el.textContent || '');
            if (!bad(text)) output.push(text);
        }

        return output;
    }

    function collectStoryDetailRoots() {
        const panel = document.getElementById('se-panel');
        const selectors = [
            '#story-detail-scroll',
            '[id*="story-detail"]',
            '[data-testid*="story-detail"]',
            '[class*="story-detail"]',
            '[data-testid*="prologue"]',
            '[data-testid*="scenario"]',
            '[class*="prologue"]',
            '[class*="scenario"]'
        ];

        const output = [];

        for (const selector of selectors) {
            let nodes = [];

            try {
                nodes = Array.from(document.querySelectorAll(selector));
            } catch (_) {
                continue;
            }

            for (const el of nodes) {
                if (panel && panel.contains(el)) continue;
                if (!visible(el)) continue;

                const text = clean(el.innerText || el.textContent || '');

                if (!bad(text) && text.length >= 20) {
                    output.push(text);
                }
            }
        }

        return output;
    }

    function collectLargeCards() {
        const panel = document.getElementById('se-panel');
        const input = getChatInput();
        const root = document.querySelector('main') || document.body;
        const inputTop = input
            ? input.getBoundingClientRect().top
            : window.innerHeight;

        const candidates = [];

        for (const el of root.querySelectorAll(
            'article, section, [role="article"], div'
        )) {
            if (!el || el === root) continue;
            if (panel && panel.contains(el)) continue;
            if (!visible(el)) continue;

            if (el.closest(
                '#se-panel, nav, header, footer, aside, button,' +
                'textarea, input, select, script, style'
            )) {
                continue;
            }

            const rect = el.getBoundingClientRect();

            if (rect.top >= inputTop + 30) continue;
            if (rect.width < Math.min(220, window.innerWidth * 0.45)) continue;
            if (rect.height < 70) continue;

            const text = clean(el.innerText || el.textContent || '');

            if (bad(text) || text.length < 60) continue;

            const childEquivalent = Array.from(el.children || []).some(child => {
                const childText = clean(child.innerText || child.textContent || '');
                return childText.length >= Math.max(50, text.length * 0.82);
            });

            if (childEquivalent) continue;

            const uiNoise = [
                '문장 부풀리기',
                '페르소나 / 자동추천',
                'API / 모델 / 기본 설정',
                '설정 동기화',
                '저장하고 닫기',
                '메시지 보내기'
            ].filter(word => text.includes(word)).length;

            if (uiNoise >= 2) continue;

            candidates.push({
                text,
                top: rect.top,
                score:
                    Math.min(text.length, 8000) / 10 +
                    Math.min(rect.height, 1400) / 6
            });
        }

        return candidates
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
            .sort((a, b) => a.top - b.top)
            .map(item => item.text);
    }

    function collectLeafTextBlocks() {
        const panel = document.getElementById('se-panel');
        const root = document.querySelector('main') || document.body;
        const input = getChatInput();
        const inputTop = input
            ? input.getBoundingClientRect().top
            : window.innerHeight;

        const output = [];

        const nodes = Array.from(root.querySelectorAll(
            'p, li, blockquote, h1, h2, h3, h4,' +
            '[class*="whitespace-pre-wrap"],' +
            '[class*="break-words"],' +
            '[data-testid*="content"],' +
            '[data-testid*="text"]'
        )).filter(el => {
            if (panel && panel.contains(el)) return false;
            if (!visible(el)) return false;
            if (el.closest('nav, header, footer, aside, button, textarea, input, select')) return false;

            const rect = el.getBoundingClientRect();
            if (rect.top > inputTop + 50) return false;

            const hasTextChild = Array.from(el.children || []).some(child => {
                return clean(child.innerText || child.textContent || '').length >= 2;
            });

            return !hasTextChild;
        }).sort((a, b) => {
            return a.getBoundingClientRect().top - b.getBoundingClientRect().top;
        });

        for (const el of nodes) {
            const text = clean(el.innerText || el.textContent || '');

            if (!bad(text) && text.length >= 2) {
                output.push(text);
            }
        }

        return output;
    }

    function collectStartScreenContext() {
        return unique([
            ...collectStoryDetailRoots(),
            ...collectLargeCards(),
            ...collectMarkdowns(),
            ...collectLeafTextBlocks()
        ]);
    }

    function syncStoryCacheToCurrent() {
        const storyKey = storyCacheKey();
        if (!storyKey) return;

        const storyLines = readCache(storyKey);
        if (storyLines.length) {
            mergeIntoCache(exactCacheKey(), storyLines);
        }
    }

    function scanAndSave() {
        try {
            syncStoryCacheToCurrent();

            const lines = collectStartScreenContext();

            if (!lines.length) return;

            mergeIntoCache(exactCacheKey(), lines);

            const storyKey = storyCacheKey();
            if (storyKey) {
                mergeIntoCache(storyKey, lines);
            }
        } catch (error) {
            console.warn('[시작화면 맥락 핫픽스] 수집 실패:', error);
        }
    }

    function replacePreviewButton() {
        const panel = document.getElementById('se-panel');
        if (!panel) return false;

        let button = panel.querySelector('#se-ctx-preview, #se-ctx-test');
        const status = panel.querySelector('#se-ctx-status');
        const nInput = panel.querySelector('#se-ctx-n');

        if (!button || !status) return false;
        if (button.dataset.startScreenContextFixed === '1') return true;

        const fresh = button.cloneNode(true);
        fresh.dataset.startScreenContextFixed = '1';
        button.replaceWith(fresh);
        button = fresh;

        button.addEventListener('click', () => {
            const n = Math.max(
                1,
                Math.min(30, parseInt(nInput && nInput.value, 10) || 6)
            );

            if (nInput) {
                GM_setValue('se_ctx_n', n);
            }

            button.disabled = true;
            status.classList.remove('err');
            status.textContent = '시작 상황 카드와 현재 화면을 강제로 읽는 중…';

            setTimeout(() => {
                try {
                    scanAndSave();

                    const all = unique(readCache(exactCacheKey()));
                    const arr = all.slice(-n);

                    if (!arr.length) {
                        status.classList.add('err');
                        status.textContent =
                            '아직도 읽을 본문을 못 찾았어요. 페이지를 한 번 아래로 살짝 스크롤한 뒤 다시 눌러보세요.';
                        return;
                    }

                    status.classList.remove('err');
                    status.textContent =
                        arr.length + '개 참고 예정 (요청 ' + n + '개)' +
                        ' / 현재 캐시 ' + all.length + '개\n' +
                        arr.map((text, index) => {
                            const short = text.length > 160
                                ? text.slice(0, 160) + '…'
                                : text;

                            return (index + 1) + '. ' + short;
                        }).join('\n');
                } catch (error) {
                    console.warn('[시작화면 맥락 핫픽스] 미리보기 실패:', error);
                    status.classList.add('err');
                    status.textContent = '맥락을 읽는 중 오류가 났어요.';
                } finally {
                    button.disabled = false;
                }
            }, 80);
        });

        return true;
    }

    function scheduleScan(delay) {
        if (scanTimer) clearTimeout(scanTimer);

        scanTimer = setTimeout(() => {
            scanTimer = null;
            scanAndSave();
            replacePreviewButton();
        }, Number.isFinite(delay) ? delay : 500);
    }

    function start() {
        scanAndSave();
        replacePreviewButton();

        [100, 500, 1200, 2500, 5000].forEach(delay => {
            setTimeout(() => {
                scanAndSave();
                replacePreviewButton();
            }, delay);
        });

        observer = new MutationObserver(() => {
            scheduleScan(700);
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            characterData: true
        });

        setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                scheduleScan(250);
                setTimeout(scanAndSave, 900);
            } else {
                replacePreviewButton();
            }
        }, 1200);

        window.addEventListener('popstate', () => {
            scheduleScan(200);
        });

        window.addEventListener('hashchange', () => {
            scheduleScan(200);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
