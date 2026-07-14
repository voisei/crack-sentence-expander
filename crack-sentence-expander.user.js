// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini) · 풀기능 모바일 수정판
// @namespace    https://crack.wrtn.ai
// @version      6.12.36
// @author       me
// @description  크랙의 최신순 DOM을 역순으로 읽어 실제 직전 채팅을 정확히 잡고, 추천 페르소나와 모바일 키보드 위치를 정리한 단일 실행판.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @homepageURL  https://github.com/voisei/crack-sentence-expander
// @supportURL   https://github.com/voisei/crack-sentence-expander/issues
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /* =========================
     * 저장 키
     * ========================= */
    const K_APIKEY = 'se_gemini_key';
    const K_MODEL = 'se_gemini_model';
    const K_MODELLIST = 'se_model_list';

    const K_PERSONAS = 'se_personas';
    const K_PERSONA_HINT = 'se_persona_hint';
    const K_STYLES = 'se_styles';

    const K_NAME = 'se_name';
    const K_POV = 'se_pov';
    const K_LENGTH = 'se_length';

    const K_POS = 'se_panel_pos';
    const K_FABPOS = 'se_fab_pos2';
    const K_OPEN = 'se_panel_open';

    const K_CTX_ON = 'se_ctx_on';
    const K_CTX_N = 'se_ctx_n';
    const K_CTX_CACHE_BASE = 'se_ctx_cache_by_room_v6';
    const K_STORY_BOOTSTRAP_BASE = 'se_ctx_story_bootstrap_v4';

    const K_COST_ON = 'se_cost_on';
    const K_COST_USDKRW = 'se_cost_usdkrw';
    const K_COST_TOTAL_USD = 'se_cost_total_usd';
    const K_COST_TOTAL_IN = 'se_cost_total_input_tokens';
    const K_COST_TOTAL_OUT = 'se_cost_total_output_tokens';
    const K_COST_REQ_COUNT = 'se_cost_request_count';
    const K_COST_LOG = 'se_cost_log';

    const PANEL_ID = 'se-panel';
    const FAB_ID = 'se-fab';
    const EDGE = 12;
    const PERSONA_SLOTS = 3;
    const STYLE_SLOTS = 3;
    const CTX_CACHE_LIMIT = 300;

    const DEFAULT_MODELS = [
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' }
    ];

    const LENGTHS = {
        three: {
            label: '세줄',
            guide: '대사와 서술을 합쳐 3문장 안팎으로 짧고 압축적으로.'
        },
        short: {
            label: '짧게',
            guide: '간결하게 핵심만 자연스럽게 살을 붙여서.'
        },
        medium: {
            label: '중간',
            guide: '감각 묘사와 감정을 적당히 풀어 자연스러운 분량으로.'
        },
        long: {
            label: '길게',
            guide: '풍부한 문학적 묘사와 내면 묘사를 충분히 펼쳐 길게.'
        }
    };

    let contextObserver = null;
    let contextScanTimer = null;
    let routeTimer = null;
    let lastUrl = location.href;

    /* =========================
     * 공통 유틸
     * ========================= */
    function isVisible(el) {
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

    let stableViewportHeight = window.visualViewport
        ? window.visualViewport.height
        : window.innerHeight;

    function isTypingElement(element) {
        if (!element) return false;

        const tag = String(element.tagName || '').toLowerCase();

        return (
            tag === 'textarea' ||
            tag === 'input' ||
            element.isContentEditable
        );
    }

    function isSoftKeyboardOpen() {
        const vv = window.visualViewport;
        if (!vv) return false;

        const focused = isTypingElement(document.activeElement);
        const heightLoss = stableViewportHeight - vv.height;

        /* 키보드가 닫힌 상태에서만 기준 높이를 갱신한다. */
        if (!focused && vv.height > stableViewportHeight - 40) {
            stableViewportHeight = Math.max(stableViewportHeight, vv.height);
        }

        return focused && heightLoss > 120;
    }

    function getViewport() {
        const vv = window.visualViewport;

        /*
         * position: fixed의 left/top은 레이아웃 뷰포트의 0,0을 기준으로 한다.
         * 모바일 키보드가 열릴 때 변하는 visualViewport.offsetTop/offsetLeft를
         * 다시 더하면 브라우저의 화면 이동값과 중복되어 패널이 아래로 밀릴 수 있다.
         */
        return {
            left: 0,
            top: 0,
            width: vv ? vv.width : window.innerWidth,
            height: vv ? vv.height : window.innerHeight
        };
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }

        return new Promise((resolve, reject) => {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();

            try {
                document.execCommand('copy');
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                ta.remove();
            }
        });
    }

    function b64encUtf8(value) {
        return btoa(unescape(encodeURIComponent(value)));
    }

    function b64decUtf8(value) {
        return decodeURIComponent(escape(atob(value)));
    }

    /* =========================
     * 페르소나 / 문체 슬롯
     * ========================= */
    function normalizeSlots(raw, count, prefix) {
        const result = [];

        for (let i = 0; i < count; i++) {
            const item = Array.isArray(raw) ? raw[i] : null;

            result.push({
                on: !!(item && item.on),
                name: item && item.name ? String(item.name) : prefix + ' ' + (i + 1),
                text: item && item.text ? String(item.text) : ''
            });
        }

        return result;
    }

    function getPersonaSlots() {
        return normalizeSlots(
            GM_getValue(K_PERSONAS, []),
            PERSONA_SLOTS,
            '페르소나'
        );
    }

    function getStyleSlots() {
        return normalizeSlots(
            GM_getValue(K_STYLES, []),
            STYLE_SLOTS,
            '문체'
        );
    }

    function getActivePersona() {
        return getPersonaSlots()
            .filter(item => item.on && item.text.trim())
            .map(item => {
                const name = item.name.trim();
                return (name ? '【' + name + '】\n' : '') + item.text.trim();
            })
            .join('\n\n');
    }

    function getActiveStyle() {
        return getStyleSlots()
            .filter(item => item.on && item.text.trim())
            .map(item => {
                const name = item.name.trim();
                return (name ? '【' + name + '】\n' : '') + item.text.trim();
            })
            .join('\n\n');
    }

    /* =========================
     * 맥락 수집 / 캐시
     * ========================= */
    function getCurrentChatCacheKey() {
        return K_CTX_CACHE_BASE + '::' +
            (location.pathname || '') +
            (location.search || '') +
            (location.hash || '');
    }

    function getCtxCache() {
        const value = GM_getValue(getCurrentChatCacheKey(), []);
        if (!Array.isArray(value)) return [];

        return value.filter(item => {
            return item && typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.text === 'string';
        });
    }

    function saveCtxCache(records) {
        const value = Array.isArray(records)
            ? records.slice(-CTX_CACHE_LIMIT)
            : [];
        GM_setValue(getCurrentChatCacheKey(), value);
    }

    function clearCtxCache() {
        saveCtxCache([]);
    }

    function cleanContextLine(text) {
        const uiOnly = new Set([
            '복사', '다시 생성', '삭제', '수정', '공유',
            '좋아요', '싫어요', '더보기'
        ]);

        return String(text || '')
            .replace(/\/stories\/[^\s]+\/episodes\/[^\s]+/g, ' ')
            .replace(/^\s*\[\s*턴\s*\d+\s*[|｜][^\]]*\]\s*/gim, '')
            .replace(/^\s*\[[^\]]*\d+\s*일차[^\]]*\]\s*/gim, '')
            .replace(/\r/g, '')
            .split('\n')
            .map(line => line.replace(/[\t ]+/g, ' ').trim())
            .filter(line => line && !uiOnly.has(line))
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function isBadContextLine(line) {
        if (!line || line.length < 2 || line.length > 12000) return true;

        const exact = new Set([
            '문장 부풀리기', '대사', '행동', '1인칭', '3인칭',
            '세줄', '짧게', '중간', '길게', '문학적으로 늘리기',
            '채팅창에 바로 넣기', '복사', '다시 뽑기', '설정',
            '저장', '닫기', '확인', '취소', '삭제', '수정', '뒤로',
            '추가', '최신순', '오래된순', '이 채팅방 캐시 지우기'
        ]);

        if (exact.has(line)) return true;
        if (/^✨?\s*문장 부풀리기/.test(line)) return true;
        if (/Gemini API|API 키|사용 가능한 모델|페르소나 자동추천/.test(line)) return true;
        if (/최근 대화 맥락 참고|맥락 미리보기/.test(line)) return true;
        if (/설정 동기화|내보내기|가져오기/.test(line)) return true;
        if (/^[\s\W_]+$/.test(line)) return true;
        return false;
    }

    function hashContextId(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function normalizeContextRecord(record) {
        if (!record || typeof record !== 'object') return null;
        const text = cleanContextLine(record.text);
        if (isBadContextLine(text)) return null;

        return {
            id: String(record.id || ('fallback-' + hashContextId(text))),
            role: record.role === 'user' || record.role === 'assistant'
                ? record.role
                : 'unknown',
            text,
            nearInput: !!record.nearInput,
            domIndex: Number.isFinite(record.domIndex) ? record.domIndex : -1,
            top: Number.isFinite(record.top) ? record.top : 0,
            bottom: Number.isFinite(record.bottom) ? record.bottom : 0,
            distanceToInput: Number.isFinite(record.distanceToInput)
                ? record.distanceToInput
                : Number.POSITIVE_INFINITY
        };
    }

    function rememberCtxLines(records) {
        const fresh = (Array.isArray(records) ? records : [])
            .map(normalizeContextRecord)
            .filter(Boolean);
        if (!fresh.length) return;

        let cache = getCtxCache().map(normalizeContextRecord).filter(Boolean);
        if (!cache.length) {
            saveCtxCache(fresh);
            return;
        }

        const byId = new Map(cache.map((item, index) => [item.id, index]));

        /* 이미 본 메시지는 텍스트/역할만 갱신하고 위치는 절대 바꾸지 않는다.
         * 23버전은 재스캔된 과거 메시지를 캐시 맨 뒤로 옮겨 과거를 최신으로
         * 착각하게 만들었다. */
        for (const item of fresh) {
            if (byId.has(item.id)) {
                const index = byId.get(item.id);
                cache[index] = { ...cache[index], ...item };
            }
        }

        const freshIds = fresh.map(item => item.id);
        const cacheIds = new Set(cache.map(item => item.id));

        for (let i = 0; i < fresh.length; i++) {
            const item = fresh[i];
            if (cacheIds.has(item.id)) continue;

            let inserted = false;

            /* 화면상 바로 앞 메시지를 기준으로 정확한 위치에 삽입 */
            for (let p = i - 1; p >= 0; p--) {
                const prevId = freshIds[p];
                const prevIndex = cache.findIndex(entry => entry.id === prevId);
                if (prevIndex >= 0) {
                    cache.splice(prevIndex + 1, 0, item);
                    inserted = true;
                    break;
                }
            }

            /* 앞 기준이 없으면 화면상 바로 뒤 메시지 앞에 삽입 */
            if (!inserted) {
                for (let n = i + 1; n < fresh.length; n++) {
                    const nextId = freshIds[n];
                    const nextIndex = cache.findIndex(entry => entry.id === nextId);
                    if (nextIndex >= 0) {
                        cache.splice(nextIndex, 0, item);
                        inserted = true;
                        break;
                    }
                }
            }

            /* 겹치는 메시지가 전혀 없는 별도 화면 조각은 입력창 근처일 때만
             * 최신으로 추가한다. 과거로 스크롤했을 때 낡은 턴이 뒤에 붙는 것을 방지. */
            if (!inserted && item.nearInput) {
                cache.push(item);
                inserted = true;
            }

            if (inserted) cacheIds.add(item.id);
        }

        saveCtxCache(cache);
    }

    function collectScenarioCards() {
        const panel = document.getElementById(PANEL_ID);
        const input = findChatInput();

        if (!input) return [];

        const root = document.querySelector('main') || document.body;
        const inputTop = input.getBoundingClientRect().top;
        const candidates = [];

        for (const el of root.querySelectorAll('article, section, [role="article"], div')) {
            if (!el || el === root) continue;
            if (panel && panel.contains(el)) continue;
            if (el.contains(input)) continue;
            if (el.closest('nav, header, footer, aside, button, textarea, input, select, script, style')) continue;
            if (!isVisible(el)) continue;

            const rect = el.getBoundingClientRect();

            if (rect.top >= inputTop || rect.bottom > inputTop + 30) continue;
            if (rect.width < Math.min(220, window.innerWidth * 0.48)) continue;
            if (rect.height < 90) continue;

            const text = cleanContextLine(el.innerText || el.textContent || '');

            if (text.length < 120 || text.length > 14000) continue;

            const noisy = [
                '앱에서 더 편하게',
                '다운로드',
                'AI 요약',
                '프로챗',
                '문장 부풀리기',
                'API 비용 추정',
                '기본 설정'
            ].filter(word => text.includes(word)).length;

            if (noisy >= 2) continue;

            const innerEquivalent = Array.from(el.children || []).some(child => {
                const childText = cleanContextLine(
                    child.innerText || child.textContent || ''
                );

                return childText.length >= Math.max(100, text.length * 0.72);
            });

            if (innerEquivalent) continue;

            candidates.push({
                text,
                top: rect.top,
                score:
                    Math.min(text.length, 6000) / 10 +
                    Math.min(rect.height, 1200) / 8 -
                    Math.max(0, inputTop - rect.bottom) / 8
            });
        }

        return candidates
            .sort((a, b) => b.score - a.score)
            .slice(0, 2)
            .sort((a, b) => a.top - b.top)
            .map(item => item.text);
    }

    function getMessageSignature(group, contentEl) {
        const parts = [];
        let node = contentEl || group;

        for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
            if (node === document.body) break;

            [
                'data-role', 'data-author', 'data-message-role',
                'data-testid', 'aria-label', 'data-side'
            ].forEach(name => {
                const value = node.getAttribute && node.getAttribute(name);
                if (value) parts.push(name + '=' + value);
            });

            if (node.id) parts.push('id=' + node.id);
            if (typeof node.className === 'string') parts.push('class=' + node.className);
            if (node === group) break;
        }

        return parts.join(' ').toLowerCase();
    }

    function detectMessageRole(group, contentEl) {
        const signature = getMessageSignature(group, contentEl);

        if (
            /(?:data-role|data-author|data-message-role)=(?:user|human|me)\b/.test(signature) ||
            /(?:data-testid|aria-label)=[^ ]*(?:user|human|mine)[^ ]*/.test(signature) ||
            /(?:user-message|message-user|chat-user|human-message|from-user|is-user)/.test(signature) ||
            /(?:사용자|내 메시지|나의 메시지)/.test(signature)
        ) return 'user';

        if (
            /(?:data-role|data-author|data-message-role)=(?:assistant|ai|bot|character|agent)\b/.test(signature) ||
            /(?:data-testid|aria-label)=[^ ]*(?:assistant|character|bot|agent)[^ ]*/.test(signature) ||
            /(?:assistant-message|message-assistant|ai-message|bot-message|character-message|from-assistant)/.test(signature) ||
            /(?:캐릭터 메시지|AI 메시지|어시스턴트)/.test(signature)
        ) return 'assistant';

        const target = contentEl || group;
        const rect = target && target.getBoundingClientRect
            ? target.getBoundingClientRect()
            : null;
        const style = target ? getComputedStyle(target) : null;

        if (style) {
            if (style.alignSelf === 'flex-end' || style.marginLeft === 'auto') return 'user';
            if (style.alignSelf === 'flex-start' || style.marginRight === 'auto') return 'assistant';
        }

        if (rect && rect.width > 0) {
            const viewport = getViewport();
            const center = rect.left + rect.width / 2;
            const viewportCenter = viewport.left + viewport.width / 2;
            if (center > viewportCenter + viewport.width * 0.10 && rect.width < viewport.width * 0.82) {
                return 'user';
            }
        }

        /* wrtn-markdown은 유저/캐릭터 양쪽에 쓰일 수 있으므로 역할 근거로 삼지 않는다. */
        return 'unknown';
    }

    function getBestMessageNode(group) {
        const selectors = [
            '[data-role="user"]', '[data-role="assistant"]',
            '[data-message-role]', '[data-author]',
            '[data-testid*="user"]', '[data-testid*="assistant"]',
            '[data-testid*="message"]', '.wrtn-markdown',
            '[class*="whitespace-pre-wrap"]', '[class*="break-words"]'
        ].join(',');

        const candidates = Array.from(group.querySelectorAll(selectors))
            .filter(el => {
                if (el.closest('#' + PANEL_ID)) return false;
                if (el.querySelector('textarea, input, select, button')) return false;
                const text = cleanContextLine(el.innerText || el.textContent || '');
                return text.length >= 1 && text.length <= 12000;
            });

        if (!candidates.length) return group;

        const scored = candidates.map(el => {
            const text = cleanContextLine(el.innerText || el.textContent || '');
            let score = Math.min(text.length, 5000);
            if (el.hasAttribute('data-role')) score += 12000;
            if (el.hasAttribute('data-message-role')) score += 12000;
            if (el.hasAttribute('data-author')) score += 12000;
            if ((el.getAttribute('data-testid') || '').toLowerCase().includes('message')) score += 7000;
            if (el.classList.contains('wrtn-markdown')) score += 4000;

            const equivalentChild = Array.from(el.children || []).some(child => {
                const childText = cleanContextLine(child.innerText || child.textContent || '');
                return childText && childText.length >= text.length * 0.88;
            });
            if (equivalentChild) score -= 8000;
            return { el, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0].el;
    }

    function formatContextMessage(role, text) {
        const label = role === 'user'
            ? '유저'
            : role === 'assistant'
                ? '상대 캐릭터'
                : '역할 미확인';
        return '[' + label + ']\n' + text;
    }

    function collectVisibleChatLines() {
        const panel = document.getElementById(PANEL_ID);
        const input = findChatInput();
        const inputTop = input ? input.getBoundingClientRect().top : window.innerHeight;
        const entries = [];

        const groups = Array.from(document.querySelectorAll('[data-message-group-id]'))
            .filter(group => !panel || !panel.contains(group));

        groups.forEach((group, index) => {
            const contentEl = getBestMessageNode(group);
            const text = cleanContextLine(contentEl.innerText || contentEl.textContent || '');
            if (isBadContextLine(text)) return;

            const rect = group.getBoundingClientRect();
            const rawId = group.getAttribute('data-message-group-id') || '';
            entries.push({
                id: rawId || ('group-' + hashContextId(text + '|' + index)),
                text,
                role: detectMessageRole(group, contentEl),
                top: Number.isFinite(rect.top) ? rect.top : index,
                bottom: Number.isFinite(rect.bottom) ? rect.bottom : index,
                distanceToInput: Number.isFinite(rect.bottom)
                    ? Math.abs(inputTop - rect.bottom)
                    : Number.POSITIVE_INFINITY,
                domIndex: index,
                nearInput: rect.bottom <= inputTop + 100 && rect.bottom >= inputTop - 2200
            });
        });

        if (!entries.length) {
            Array.from(document.querySelectorAll('.wrtn-markdown'))
                .filter(el => !el.closest('#' + PANEL_ID))
                .forEach((el, index) => {
                    const text = cleanContextLine(el.innerText || el.textContent || '');
                    if (isBadContextLine(text)) return;
                    const rect = el.getBoundingClientRect();
                    entries.push({
                        id: 'markdown-' + hashContextId(text),
                        text,
                        role: detectMessageRole(el.parentElement || el, el),
                        top: Number.isFinite(rect.top) ? rect.top : index,
                        bottom: Number.isFinite(rect.bottom) ? rect.bottom : index,
                        distanceToInput: Number.isFinite(rect.bottom)
                            ? Math.abs(inputTop - rect.bottom)
                            : Number.POSITIVE_INFINITY,
                        domIndex: index,
                        nearInput: rect.bottom <= inputTop + 100 && rect.bottom >= inputTop - 2200
                    });
                });
        }

        /* 크랙 채팅 DOM은 최신 메시지가 먼저 오는 역시간순으로 배치된다.
         * 따라서 DOM 인덱스를 역순으로 뒤집어 [과거 → 최신] 순서로 통일한다.
         * rect.top은 모바일 스크롤/키보드에서 흔들리므로 순서 판정에 쓰지 않는다. */
        entries.sort((a, b) => {
            if (a.domIndex !== b.domIndex) return b.domIndex - a.domIndex;
            return b.top - a.top;
        });

        /* 역할 표지가 하나도 없으면 채팅 입력창 직전의 마지막 출력은 상대
         * 캐릭터라고 보고 아래에서부터 유저/캐릭터를 교대로 복원한다. */
        const hasKnownRole = entries.some(item => item.role !== 'unknown');
        if (!hasKnownRole && entries.length) {
            let role = 'assistant';
            for (let i = entries.length - 1; i >= 0; i--) {
                entries[i].role = role;
                role = role === 'assistant' ? 'user' : 'assistant';
            }
        } else {
            for (let i = entries.length - 1; i >= 0; i--) {
                if (entries[i].role !== 'unknown') continue;
                const next = i + 1 < entries.length ? entries[i + 1].role : 'unknown';
                if (next === 'assistant') entries[i].role = 'user';
                else if (next === 'user') entries[i].role = 'assistant';
            }
            for (let i = 0; i < entries.length; i++) {
                if (entries[i].role !== 'unknown') continue;
                const prev = i > 0 ? entries[i - 1].role : 'unknown';
                if (prev === 'assistant') entries[i].role = 'user';
                else if (prev === 'user') entries[i].role = 'assistant';
            }
        }

        return entries.map(normalizeContextRecord).filter(Boolean);
    }

    function getStoryId() {
        const match = (location.pathname || '').match(/\/stories\/([^/?#]+)/i);
        return match ? match[1] : '';
    }

    function getStoryBootstrapKey() {
        const storyId = getStoryId();
        return storyId ? K_STORY_BOOTSTRAP_BASE + '::' + storyId : '';
    }

    function getStoryBootstrap() {
        const key = getStoryBootstrapKey();
        if (!key) return [];
        const value = GM_getValue(key, []);
        if (!Array.isArray(value)) return [];

        return value
            .map(item => cleanContextLine(
                item && typeof item === 'object' ? item.text : item
            ))
            .filter(text => text && !isBadContextLine(text));
    }

    function saveStoryBootstrap(lines) {
        const key = getStoryBootstrapKey();
        if (!key) return;

        const old = getStoryBootstrap();
        const merged = [];

        for (const raw of [...old, ...(Array.isArray(lines) ? lines : [])]) {
            const text = cleanContextLine(raw);
            if (!text || isBadContextLine(text)) continue;

            /* 부모 카드와 자식 카드가 둘 다 잡히면 더 구체적인 짧은 카드만 남긴다. */
            const same = merged.findIndex(item => item === text);
            if (same >= 0) continue;

            const containedByNew = merged.findIndex(item =>
                text.length >= item.length * 1.15 && text.includes(item)
            );
            if (containedByNew >= 0) continue;

            for (let i = merged.length - 1; i >= 0; i--) {
                if (
                    merged[i].length >= text.length * 1.15 &&
                    merged[i].includes(text)
                ) {
                    merged.splice(i, 1);
                }
            }

            merged.push(text);
        }

        GM_setValue(key, merged.slice(-12));
    }

    function collectStoryBootstrap() {
        const panel = document.getElementById(PANEL_ID);
        const root = document.querySelector('main') || document.body;
        const found = [];

        const selectors = [
            '#story-detail-scroll',
            '[id*="story-detail"]',
            '[data-testid*="story-detail"]',
            '[class*="story-detail"]',
            '[data-testid*="prologue"]',
            '[data-testid*="scenario"]',
            '[class*="prologue"]',
            '[class*="scenario"]',
            '[data-testid*="play-guide"]',
            '[class*="play-guide"]',
            '[data-testid*="status"]',
            '[class*="status-window"]'
        ];

        for (const selector of selectors) {
            let nodes = [];
            try {
                nodes = Array.from(document.querySelectorAll(selector));
            } catch (_) {
                continue;
            }

            for (const el of nodes) {
                if (panel && panel.contains(el)) continue;
                if (el.closest('[data-message-group-id]')) continue;
                if (!isVisible(el)) continue;

                const text = cleanContextLine(el.innerText || el.textContent || '');
                if (text.length >= 20 && text.length <= 14000 && !isBadContextLine(text)) {
                    found.push(text);
                }
            }
        }

        /* 전용 선택자가 없는 시작 카드용 보조 수집. 실제 채팅 그룹은 제외한다. */
        const candidates = [];
        for (const el of root.querySelectorAll('article, section, [role="article"], div')) {
            if (!el || el === root) continue;
            if (panel && panel.contains(el)) continue;
            if (el.closest('[data-message-group-id]')) continue;
            if (el.querySelector('[data-message-group-id]')) continue;
            if (el.closest('nav, header, footer, aside, button, textarea, input, select, script, style')) continue;
            if (!isVisible(el)) continue;

            const rect = el.getBoundingClientRect();
            if (rect.width < Math.min(220, window.innerWidth * 0.45)) continue;
            if (rect.height < 70) continue;

            const text = cleanContextLine(el.innerText || el.textContent || '');
            if (text.length < 60 || text.length > 14000 || isBadContextLine(text)) continue;

            const noisy = [
                '문장 부풀리기', 'API 비용 추정', '설정 동기화',
                '저장하고 닫기', '채팅창에 바로 넣기'
            ].filter(word => text.includes(word)).length;
            if (noisy >= 2) continue;

            const childEquivalent = Array.from(el.children || []).some(child => {
                const childText = cleanContextLine(child.innerText || child.textContent || '');
                return childText.length >= Math.max(50, text.length * 0.82);
            });
            if (childEquivalent) continue;

            candidates.push({
                text,
                top: rect.top,
                score: Math.min(text.length, 8000) / 10 + Math.min(rect.height, 1400) / 6
            });
        }

        candidates
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .sort((a, b) => a.top - b.top)
            .forEach(item => found.push(item.text));

        saveStoryBootstrap(found);
        return getStoryBootstrap();
    }

    function getUnifiedContext(maxN) {
        const n = clamp(parseInt(maxN, 10) || 6, 1, 30);

        /* 미리보기와 실제 생성이 반드시 이 함수 하나만 사용한다. */
        collectStoryBootstrap();

        const visibleRecords = collectVisibleChatLines();
        rememberCtxLines(visibleRecords);

        const cache = getCtxCache();
        let records = cache.length ? cache : visibleRecords;

        /* 현재 DOM에 잡힌 마지막 메시지가 캐시 끝과 다르면 현재 화면 순서를 우선한다.
         * 생성 직전 새 응답이 MutationObserver 캐시에 아직 반영되지 않은 짧은 순간에도
         * 2~3턴 전 캐시를 쓰지 않도록 한다. */
        if (visibleRecords.length) {
            const latestVisible = visibleRecords[visibleRecords.length - 1];
            const latestCached = records.length ? records[records.length - 1] : null;

            if (!latestCached || latestCached.id !== latestVisible.id) {
                const visibleIds = new Set(visibleRecords.map(item => item.id));
                records = [
                    ...records.filter(item => !visibleIds.has(item.id)),
                    ...visibleRecords
                ];
            }
        }

        const recent = records
            .slice(-n)
            .map(item => formatContextMessage(item.role, item.text));

        const story = getStoryBootstrap()
            .slice(-2)
            .map(text => '[시작 상황/플레이 가이드]\n' + text);

        return [...story, ...recent];
    }

    function collectChatContext(maxN) {
        return getUnifiedContext(maxN);
    }

    /* 실제 생성에 사용할 직전 장면은 캐시 역할 판별에 맡기지 않고
     * 현재 화면의 마지막 메시지에서 직접 고정한다. 사용자가 부풀리기 버튼을
     * 누르는 시점에는 마지막 채팅 메시지가 상대 캐릭터 출력이라는 전제다. */
    function collectLatestSceneSnapshot() {
        const visible = collectVisibleChatLines();

        if (visible.length) {
            /* 역할 판별을 절대 사용하지 않는다.
             * 크랙이 최신 캐릭터 메시지를 user/unknown으로 잘못 표시하는 경우가 있어
             * assistant만 역검색하면 2~3턴 전 메시지까지 건너뛰는 문제가 생긴다.
             * 최신순 DOM을 역순 정렬한 뒤 마지막 메시지를 직전 장면으로 사용한다. */
            const picked = visible[visible.length - 1];
            const nearby = visible
                .slice(Math.max(0, visible.length - 3))
                .map(item => formatContextMessage(item.role, item.text))
                .join('\n\n');

            return {
                text: picked.text || '',
                nearby,
                source: '현재 채팅 DOM의 실제 마지막 메시지',
                role: picked.role || 'unknown',
                id: picked.id || ''
            };
        }

        const cache = getCtxCache();
        if (cache.length) {
            /* 캐시에서도 역할이 아니라 저장 순서의 마지막 항목을 사용한다. */
            const picked = cache[cache.length - 1];
            const nearby = cache
                .slice(Math.max(0, cache.length - 3))
                .map(item => formatContextMessage(item.role, item.text))
                .join('\n\n');

            return {
                text: picked.text || '',
                nearby,
                source: '현재 채팅방 캐시의 실제 마지막 메시지',
                role: picked.role || 'unknown',
                id: picked.id || ''
            };
        }

        const story = getStoryBootstrap();
        if (story.length) {
            return {
                text: story[story.length - 1],
                nearby: '[시작 상황/플레이 가이드]\n' + story[story.length - 1],
                source: '첫 시작 장면',
                role: 'assistant',
                id: ''
            };
        }

        return { text: '', nearby: '', source: '판별 실패', role: 'unknown', id: '' };
    }

    function extractSceneKeywords(text) {
        const stop = new Set([
            '그렇지', '여보', '알겠습니다', '말씀', '하시죠', '하겠습니다',
            '하십시오', '합니다', '있습니다', '없습니다', '그러면', '그리고',
            '하지만', '당신', '제가', '나는', '내가', '우리', '저희',
            '정말', '바로', '당장', '이제', '오늘도', '그냥', '조금',
            '완벽한', '완벽하게', '확실하게', '사항', '임무', '조건',
            '그가', '그녀가', '그는', '그녀는', '하며', '했다', '하였다'
        ]);

        const tokens = String(text || '')
            .replace(/```상태창[\s\S]*?```/g, ' ')
            .replace(/[^0-9A-Za-z가-힣 ]+/g, ' ')
            .split(/\s+/)
            .map(token => token.trim())
            .filter(token => token.length >= 2 && !stop.has(token));

        const out = [];
        for (const token of tokens) {
            const stem = token
                .replace(/(으십시오|십시오|해주세요|해라|하라|한다|합니다|하세요|하자|하죠|겠습니까|습니까|입니다|이라고|라고|부터|까지|으로|에서|에게|한테|에는|은|는|이|가|을|를|도|만)$/g, '')
                .trim();
            const value = stem.length >= 2 ? stem : token;
            if (!out.includes(value)) out.push(value);
        }

        return out.slice(0, 12);
    }

    function isContextGroundedOutput(output, sceneFocus) {
        const normalized = String(output || '').replace(/\s+/g, ' ');
        const generic = /(?:말씀하신 사항|어떤 임무든|맡겨만 주시면|완벽하게 완수|확실하게 완수|악으로|깡으로|최선을 다하|문제없이 해내|명령대로 하)/;

        /* 자동 재교정은 마지막 문장을 못 따라갔다는 이유로 발동하지 않는다.
         * 어느 장면에도 붙일 수 있는 범용 복종문만 나온 경우에 한해,
         * 직전 장면 전체에서 뽑은 단서가 하나라도 반영됐는지 확인한다. */
        if (!generic.test(normalized)) return true;

        const keywords = Array.isArray(sceneFocus && sceneFocus.keywords)
            ? sceneFocus.keywords
            : [];
        if (!keywords.length) return false;

        return keywords.some(word => normalized.includes(word));
    }


    /* =========================
     * 지문 이탤릭 형식 보정
     * ========================= */
    function isDialogueParagraph(text) {
        const value = String(text || '').trim();
        if (!value) return false;

        /* 대사는 반드시 따옴표로 출력하도록 프롬프트에서 요구한다.
         * 혹시 앞에 화자명이나 대시가 붙어도 대사로 인식한다. */
        return (
            /^(?:[-–—]\s*)?["“‘「『]/.test(value) ||
            /^(?:[^\n:：]{1,24}\s*[:：]\s*)["“‘「『]/.test(value)
        );
    }

    function stripOuterAsterisks(text) {
        let value = String(text || '').trim();

        /* **굵게**, ***혼합*** 등 잘못 붙은 외곽 별표도 제거한 뒤
         * 지문에는 정확히 한 쌍만 다시 붙인다. */
        value = value
            .replace(/^\*{1,3}\s*/, '')
            .replace(/\s*\*{1,3}$/, '')
            .trim();

        return value;
    }

    function normalizeRoleplayItalics(text) {
        const source = String(text || '')
            .replace(/^```(?:markdown|md|txt)?\s*/i, '')
            .replace(/\s*```$/, '')
            .replace(/\r/g, '')
            .trim();

        if (!source) return '';

        const paragraphs = source
            .split(/\n\s*\n+/)
            .map(item => item.trim())
            .filter(Boolean);

        const normalized = [];

        for (const paragraph of paragraphs) {
            /* 한 문단 안에 대사와 지문이 줄바꿈으로 섞여 나온 경우도
             * 줄 단위로 분리해 각각 정확한 형식으로 맞춘다. */
            const lines = paragraph
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean);

            for (const line of lines) {
                if (isDialogueParagraph(line)) {
                    /* 대사는 이탤릭 밖에 둔다. */
                    normalized.push(stripOuterAsterisks(line));
                    continue;
                }

                const narration = stripOuterAsterisks(line);
                if (!narration) continue;

                normalized.push('*' + narration + '*');
            }
        }

        return normalized.join('\n\n');
    }

    function findChatRoot() {
        const firstGroup = document.querySelector('[data-message-group-id]');

        if (firstGroup) {
            let root = firstGroup.parentElement;

            for (let i = 0; root && root !== document.body && i < 8; i++) {
                if (root.querySelectorAll('[data-message-group-id]').length >= 2) {
                    return root;
                }

                root = root.parentElement;
            }

            return firstGroup.parentElement;
        }

        const markdown = Array.from(
            document.querySelectorAll('.wrtn-markdown')
        ).find(el => !el.closest('#' + PANEL_ID));

        if (markdown) return markdown.parentElement;

        return document.querySelector('main');
    }

    function attachContextObserver() {
        if (contextObserver) {
            contextObserver.disconnect();
            contextObserver = null;
        }

        const root = findChatRoot();
        if (!root) return;

        contextObserver = new MutationObserver(() => {
            if (contextScanTimer) clearTimeout(contextScanTimer);

            contextScanTimer = setTimeout(() => {
                rememberCtxLines(collectVisibleChatLines());
                collectStoryBootstrap();
            }, 1000);
        });

        contextObserver.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
        });

        rememberCtxLines(collectVisibleChatLines());
        collectStoryBootstrap();
    }

    /* =========================
     * 프롬프트
     * ========================= */
    function extractSceneFocus(text) {
        const cleaned = String(text || '')
            .replace(/\[\/\/\]:\s*#\s*\([^\n]*\)/g, ' ')
            .replace(/```상태창[\s\S]*?```/g, ' ')
            .replace(/```[\s\S]*?```/g, ' ')
            .trim();

        if (!cleaned) {
            return {
                recentDialogue: [],
                tail: '',
                keywords: []
            };
        }

        const quotes = [];
        const quotePattern = /"([^"\n]{1,2000})"/g;
        let match;

        while ((match = quotePattern.exec(cleaned))) {
            quotes.push(match[1].trim());
        }

        const tail = cleaned.slice(-3000).trim();

        return {
            recentDialogue: quotes.slice(-4),
            tail,
            keywords: extractSceneKeywords(tail)
        };
    }

    function buildPrompt(dialogue, action, context, latestSnapshot) {
        const pov = GM_getValue(K_POV, 'first');
        const name = String(GM_getValue(K_NAME, '') || '').trim();
        const length = GM_getValue(K_LENGTH, 'medium');
        const persona = getActivePersona();
        const style = getActiveStyle();

        const lines = [
            '너는 롤플레이 캐릭터 채팅에서 유저 캐릭터의 이번 대사와 행동을 문학적으로 확장하는 글쓰기 보조다.',
            '직전 상대 캐릭터 출력에 이어지는 유저 캐릭터의 현재 반응을 작성한다.',
            '이미 진행 중인 행동을 시작 전으로 되감지 않는다.',
            '상대 캐릭터의 다음 대사, 행동, 속마음, 감정, 반응을 새로 쓰지 않는다.',
            '새 사건과 설정을 입력 범위 밖으로 크게 만들지 않는다.'
        ];

        if (persona) {
            lines.push('');
            lines.push('[유저 캐릭터 페르소나]');
            lines.push(persona);
            lines.push('- 기본 성격과 말투에 활용하되 최근 맥락과 충돌하면 최근 맥락을 우선한다.');
            lines.push('- 평소 옷차림이나 상태를 현재 사실처럼 억지로 되살리지 않는다.');
        }

        if (style) {
            lines.push('');
            lines.push('[문체 규칙]');
            lines.push(style);
            lines.push('- 위 문체 규칙을 적극 반영한다.');
        }

        let latestAssistant = String(
            latestSnapshot && latestSnapshot.text || ''
        ).trim();
        let latestSceneSource = latestAssistant
            ? String(latestSnapshot && latestSnapshot.source || '현재 화면의 실제 마지막 메시지')
            : '';
        let priorContext = Array.isArray(context) ? context.slice() : [];

        /* 실제 화면의 마지막 메시지를 최우선으로 사용한다. 동일 내용은 이전 기록에서
         * 제거해 프롬프트가 같은 턴을 중복 강조하지 않게 한다. */
        if (latestAssistant) {
            for (let i = priorContext.length - 1; i >= 0; i--) {
                const plain = priorContext[i]
                    .replace(/^\[(?:유저|상대 캐릭터|역할 미확인|시작 상황\/플레이 가이드)\]\s*/, '')
                    .trim();
                if (plain === latestAssistant) {
                    priorContext.splice(i, 1);
                    break;
                }
            }
        }

        /* 화면 마지막 메시지를 못 찾은 경우에만 역할 라벨 기반 캐시를 사용한다. */
        if (!latestAssistant) {
            for (let i = priorContext.length - 1; i >= 0; i--) {
                if (/^\[상대 캐릭터\]/.test(priorContext[i])) {
                    latestAssistant = priorContext[i]
                        .replace(/^\[상대 캐릭터\]\s*/, '')
                        .trim();
                    latestSceneSource = '직전 상대 캐릭터 출력';
                    priorContext.splice(i, 1);
                    break;
                }
            }
        }

        /* 첫 턴에는 채팅 메시지 그룹이 없고 시작 카드만 존재할 수 있다.
         * 이때 시작 상황 카드를 직전 장면으로 직접 승격한다. */
        if (!latestAssistant) {
            for (let i = priorContext.length - 1; i >= 0; i--) {
                if (/^\[시작 상황\/플레이 가이드\]/.test(priorContext[i])) {
                    latestAssistant = priorContext[i]
                        .replace(/^\[시작 상황\/플레이 가이드\]\s*/, '')
                        .trim();
                    latestSceneSource = '첫 시작 장면';
                    priorContext.splice(i, 1);
                    break;
                }
            }
        }

        const sceneFocus = extractSceneFocus(latestAssistant);

        if (priorContext.length) {
            lines.push('');
            lines.push('[이전 대화 기록: 위가 과거, 아래가 최신]');
            priorContext.forEach(item => lines.push('· ' + item));
        }

        if ((context && context.length) || latestAssistant) {
            lines.push('');
            lines.push('[문맥 판정 규칙]');
            lines.push('- 먼저 현재 장면에서 장소, 함께 있는 인물, 제삼자의 질문이나 의심, 서로의 자세, 신체 접촉, 거리, 시선, 감정과 위기를 내부적으로 판정한다.');
            lines.push('- 상대 캐릭터가 방금 시작한 연기, 거짓말, 위장, 협조 요청, 질문 또는 행동 신호가 있다면 유저 반응은 그 의도를 즉시 이어받아야 한다.');
            lines.push('- 직전 출력 전체의 흐름을 읽고, 지금 유저가 가장 자연스럽게 반응해야 할 지점을 스스로 고른다.');
            lines.push('- 마지막 문장은 여러 단서 중 하나일 뿐이다. 마지막 문장만 기계적으로 받아치거나 그 표현을 반복하지 않는다.');
            lines.push('- 마지막 발화가 단순한 마무리, 확인, 호칭, 전환 문구라면 그 앞의 사건·감정·행동 변화에 반응해도 된다.');
            lines.push('- 질문·명령·제안이 있더라도 장면 전체의 감정선과 관계 변화까지 함께 고려하며, 반드시 첫 문장에서 직접 답할 필요는 없다.');
            lines.push('- 다만 "알겠습니다", "완수하겠습니다", "맡겨만 주십시오"처럼 어느 장면에도 붙일 수 있는 일반론만으로 끝내지 않는다.');
            lines.push('- 직전 장면의 장소, 행동, 감정, 관계, 문제 중 자연스러운 단서를 반영하되 특정 단어를 억지로 복창하지 않는다.');
            lines.push('- 현재 장면의 공동 목표와 당장 해결해야 할 위기를 페르소나와 평소 말투보다 우선한다.');
            lines.push('- 페르소나는 상황에 맞는 반응을 선택한 뒤 그 반응의 말투와 표현 방식에만 적용한다.');
            lines.push('- 첫 턴에는 [시작 상황/플레이 가이드] 안의 마지막 장면을 현재 시점으로 사용한다. 일반 턴에는 직전 상대 캐릭터 출력을 현재 시점으로 사용한다.');
            lines.push('- 입력된 대사나 행동이 현재 장면의 목적과 충돌하면, 입력의 핵심 정서나 의도만 살리고 장면에 맞게 자연스럽게 수정한다.');
            lines.push('- 입력 문장을 그대로 반복하거나 단순히 수식어만 붙이지 말고, 직전 장면에 직접 반응하도록 재구성한다.');
            lines.push('- 과거 상태와 현재 장면이 충돌하면 현재 장면의 상태가 사실이다.');
            lines.push('- [유저]와 [상대 캐릭터]의 역할을 절대 뒤바꾸지 않는다.');
            lines.push('- 상대 캐릭터의 다음 행동이나 반응을 대신 진행하지 않는다.');
            lines.push('- 완성문에는 직전 상대 캐릭터 메시지의 구체적인 상황·행동·감정·질문 중 최소 하나가 자연스럽게 드러나야 한다. 어느 장면에도 붙일 수 있는 일반적인 답변만 쓰지 않는다.');
            lines.push('- 맥락을 요약하거나 그대로 재진술하지 않는다.');
        }

        lines.push('');
        lines.push('[시점]');

        if (pov === 'third') {
            lines.push('- 3인칭 시점으로 쓴다.');
            lines.push(
                name
                    ? '- 유저 캐릭터를 "' + name + '" 또는 자연스러운 3인칭 표현으로 지칭한다.'
                    : '- 유저 캐릭터를 그/그녀 등 자연스러운 3인칭 표현으로 지칭한다.'
            );
            lines.push('- 나/내가로 쓰지 않는다.');
        } else {
            lines.push('- 1인칭 시점으로 쓰며 나/내가를 사용한다.');
        }

        lines.push('');
        lines.push('[대사와 행동 처리]');
        lines.push('- 대사 입력은 완성본이 아니라 상황에 맞게 고쳐 쓸 수 있는 초안으로 취급한다. 핵심 의도는 살리되 직전 장면과 충돌하는 표현은 자연스럽게 바꾼다.');
        lines.push('- 행동 입력도 초안으로 취급하며, 직전 장면의 자세·접촉·거리와 모순되지 않게 이어 쓴다.');
        lines.push('- 모든 행동·표정·감각·내면·상황 서술은 문단 전체의 맨 앞과 맨 뒤에 별표를 정확히 하나씩 붙여 반드시 *지문* 형식으로 출력한다.');
        lines.push('- 대사는 반드시 큰따옴표로 감싸고 별표 밖에 둔다. 예: "괜찮아."');
        lines.push('- 지문 예시: *나는 잠시 시선을 피한 채 손끝을 말아 쥐었다.*');
        lines.push('- **굵게**, ***굵은 이탤릭***, 밑줄 이탤릭은 쓰지 않는다. 지문에는 오직 단일 별표 한 쌍만 사용한다.');
        lines.push('- 한 문단 안에 대사와 지문을 섞지 않는다. 대사 문단과 지문 문단을 서로 다른 줄에 쓰고 사이에 빈 줄을 넣는다.');
        lines.push('- 진행형/상태형 행동은 이미 진행 중인 현재 순간부터 이어 쓴다.');
        lines.push('- 같은 표현, 같은 감정, 같은 행동을 반복하지 않는다.');
        lines.push('- 설명, 머리말, 코드블록 없이 완성된 본문만 출력한다.');
        lines.push('- 길이: ' + (LENGTHS[length] || LENGTHS.medium).guide);

        const user = [
            '[현재 장면의 기준 — ' + (latestSceneSource || '판별 실패') + ']',
            latestAssistant || '(현재 장면을 찾지 못함)',
            '',
            '[직전 장면 바로 앞뒤 맥락]',
            String(latestSnapshot && latestSnapshot.nearby || '').trim() || '(없음)',
            '',
            '[직전 장면의 최근 대화]',
            sceneFocus.recentDialogue.length
                ? sceneFocus.recentDialogue.map(item => '· ' + item).join('\n')
                : '(직접 발화 없음)',
            '',
            '[직전 장면의 최근 흐름]',
            sceneFocus.tail || latestAssistant || '(없음)',
            '',
            '[장면 전체 참고 단서 — 복창 의무 없음]',
            sceneFocus.keywords.join(', ') || '(없음)',
            '',
            '[이번 유저 대사]',
            dialogue.trim() || '(없음)',
            '',
            '[이번 유저 행동]',
            action.trim() || '(없음)',
            '',
            '직전 장면 전체의 흐름을 먼저 이해하고, 가장 자연스러운 반응 지점을 골라 현재 장면과 페르소나에 맞게 확장해. 마지막 문장만 기계적으로 받아치거나 특정 단어를 억지로 반복하지 마. 입력 초안이 장면과 충돌하면 핵심 의도만 살려 자연스럽게 고쳐 써.'
        ].join('\n');

        return {
            system: lines.join('\n'),
            user
        };
    }

    function collectStoryDetail() {
        const texts = [];
        const seen = new Set();

        const roots = Array.from(document.querySelectorAll(
            '#story-detail-scroll .wrtn-markdown,' +
            '#story-detail-scroll,' +
            '[data-testid*="story-detail"],' +
            '[class*="story-detail"]'
        )).filter(isVisible);

        for (const el of roots) {
            let text = cleanContextLine(el.innerText || el.textContent || '');

            if (!text || text.length < 10 || seen.has(text)) continue;
            if (text.length > 12000) text = text.slice(0, 12000) + '…';

            seen.add(text);
            texts.push(text);
        }

        return texts.join('\n\n---\n\n');
    }

    function buildPersonaPrompt(keywords, storyDetail, recentContext) {
        const system = [
            '너는 롤플레이 캐릭터 채팅용 유저 캐릭터 페르소나를 만드는 설정 보조다.',
            '제작자 설정, 상세 설명, 프롤로그와 최근 상황을 읽고 세계관에 자연스럽게 맞는 유저 캐릭터를 만든다.',
            '상대 캐릭터나 NPC의 설정과 반응을 대신 확정하지 않는다.',
            '한국어로 작성한다.',
            '',
            '[출력 형식]',
            '# 캐릭터 이름 또는 한 줄 제목',
            '## 기본 정보',
            '## 성격',
            '## 말투',
            '## 배경',
            '## 관계 · 목표',
            '## 주의',
            '- 각 항목은 문장 또는 - 불릿으로 작성한다.',
            '- 코드블록, 표, 머리말, 설명은 쓰지 않는다.',
            '- 현재 장면에서 바뀔 수 있는 옷차림·청결·자세·소지품은 고정 사실로 과도하게 단정하지 않는다.'
        ].join('\n');

        const user = [
            '[사용자 키워드]',
            keywords.trim() || '(없음)',
            '',
            '[제작자 설정 / 상세 설명]',
            storyDetail.trim() || '(읽은 설정 없음)',
            '',
            '[최근 채팅 맥락]',
            recentContext.length
                ? recentContext.map(item => '· ' + item).join('\n')
                : '(없음)',
            '',
            '위 자료를 바탕으로 페르소나 칸에 바로 넣을 완성형 페르소나만 출력해줘.'
        ].join('\n');

        return { system, user };
    }

    /* =========================
     * Gemini / 모델
     * ========================= */
    function fetchModels(onDone, onError) {
        const apiKey = String(GM_getValue(K_APIKEY, '') || '').trim();

        if (!apiKey) {
            onError('API 키를 먼저 저장해 주세요.');
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url:
                'https://generativelanguage.googleapis.com/v1beta/models' +
                '?pageSize=200&key=' +
                encodeURIComponent(apiKey),
            timeout: 30000,
            onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    onError('모델 목록 조회 실패 (' + response.status + ')');
                    return;
                }

                try {
                    const data = JSON.parse(response.responseText);
                    const models = (data.models || [])
                        .filter(model => {
                            return (model.supportedGenerationMethods || [])
                                .includes('generateContent');
                        })
                        .filter(model => /gemini/i.test(model.name || ''))
                        .map(model => ({
                            id: String(model.name || '').replace(/^models\//, ''),
                            label:
                                model.displayName ||
                                String(model.name || '').replace(/^models\//, '')
                        }));

                    if (!models.length) {
                        onError('사용 가능한 Gemini 모델을 찾지 못했어요.');
                        return;
                    }

                    onDone(models);
                } catch (error) {
                    onError('모델 목록 응답을 읽지 못했어요.');
                }
            },
            onerror() {
                onError('네트워크 오류예요.');
            },
            ontimeout() {
                onError('모델 목록 요청 시간이 초과됐어요.');
            }
        });
    }

    function requestGemini(system, user, label, onDone, onError) {
        const apiKey = String(GM_getValue(K_APIKEY, '') || '').trim();
        const model = String(
            GM_getValue(K_MODEL, DEFAULT_MODELS[0].id) ||
            DEFAULT_MODELS[0].id
        ).trim();

        if (!apiKey) {
            onError('API 키가 없어요. ⚙️ 설정에서 먼저 저장해 주세요.');
            return;
        }

        const endpoint =
            'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(model) +
            ':generateContent?key=' +
            encodeURIComponent(apiKey);

        GM_xmlhttpRequest({
            method: 'POST',
            url: endpoint,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify({
                system_instruction: {
                    parts: [{ text: system }]
                },
                contents: [{
                    role: 'user',
                    parts: [{ text: user }]
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
                        ? candidate.content.parts
                            .map(part => part.text || '')
                            .join('')
                            .trim()
                        : '';

                    if (!output) {
                        const reason =
                            (candidate && candidate.finishReason) ||
                            (data.promptFeedback && data.promptFeedback.blockReason) ||
                            '알 수 없음';

                        onError('응답이 비어 있어요 (사유: ' + reason + ').');
                        return;
                    }

                    const cost = recordCostUsage(
                        model,
                        data.usageMetadata,
                        label
                    );

                    onDone(output, cost);
                } catch (error) {
                    onError('API 응답을 읽지 못했어요.');
                }
            },
            onerror() {
                onError('네트워크 오류예요.');
            },
            ontimeout() {
                onError('요청 시간이 초과됐어요.');
            }
        });
    }

    /* =========================
     * 비용 추정
     * ========================= */
    function getModelCostRates(modelId, inputTokens) {
        const id = String(modelId || '').toLowerCase();
        const over200k = Number(inputTokens || 0) > 200000;

        if (id.includes('gemini-2.5-pro')) {
            return {
                input: over200k ? 2.50 : 1.25,
                output: over200k ? 15.00 : 10.00,
                label: over200k ? 'Gemini 2.5 Pro >200K' : 'Gemini 2.5 Pro'
            };
        }

        if (id.includes('gemini-2.5-flash-lite')) {
            return {
                input: 0.10,
                output: 0.40,
                label: 'Gemini 2.5 Flash-Lite'
            };
        }

        if (id.includes('gemini-2.5-flash')) {
            return {
                input: 0.30,
                output: 2.50,
                label: 'Gemini 2.5 Flash'
            };
        }

        return {
            input: 1.50,
            output: 9.00,
            label: (modelId || '알 수 없는 모델') + ' · 임시 추정'
        };
    }

    function getUsageTokens(usage) {
        const data = usage || {};

        const input =
            Number(data.promptTokenCount || 0) +
            Number(data.cachedContentTokenCount || 0);

        const output =
            Number(data.candidatesTokenCount || 0) +
            Number(data.thoughtsTokenCount || 0);

        return {
            input,
            output,
            total: Number(data.totalTokenCount || input + output)
        };
    }

    function formatMoney(value) {
        const number = Number(value || 0);

        if (number < 1) return number.toFixed(2);
        if (number < 1000) return number.toFixed(1);

        return Math.round(number).toLocaleString('ko-KR');
    }

    function getCostLog() {
        const value = GM_getValue(K_COST_LOG, []);
        return Array.isArray(value) ? value : [];
    }

    function recordCostUsage(modelId, usage, label) {
        const tokens = getUsageTokens(usage);

        if (!tokens.input && !tokens.output) return null;

        const rates = getModelCostRates(modelId, tokens.input);
        const usd =
            (
                tokens.input * rates.input +
                tokens.output * rates.output
            ) / 1000000;

        const usdkrw = Math.max(
            1,
            parseFloat(GM_getValue(K_COST_USDKRW, 1400)) || 1400
        );

        const krw = usd * usdkrw;
        const totalUsd =
            (parseFloat(GM_getValue(K_COST_TOTAL_USD, 0)) || 0) + usd;

        const totalIn =
            (parseInt(GM_getValue(K_COST_TOTAL_IN, 0), 10) || 0) +
            tokens.input;

        const totalOut =
            (parseInt(GM_getValue(K_COST_TOTAL_OUT, 0), 10) || 0) +
            tokens.output;

        const totalReq =
            (parseInt(GM_getValue(K_COST_REQ_COUNT, 0), 10) || 0) + 1;

        GM_setValue(K_COST_TOTAL_USD, totalUsd);
        GM_setValue(K_COST_TOTAL_IN, totalIn);
        GM_setValue(K_COST_TOTAL_OUT, totalOut);
        GM_setValue(K_COST_REQ_COUNT, totalReq);

        const entry = {
            at: new Date().toLocaleString('ko-KR'),
            label: label || '요청',
            model: modelId,
            modelLabel: rates.label,
            input: tokens.input,
            output: tokens.output,
            usd,
            krw
        };

        const log = getCostLog();
        log.unshift(entry);
        GM_setValue(K_COST_LOG, log.slice(0, 50));

        return {
            ...entry,
            totalUsd,
            totalKrw: totalUsd * usdkrw,
            totalIn,
            totalOut,
            totalReq,
            message:
                '💸 이번 약 ₩' +
                formatMoney(krw) +
                ' / 누적 약 ₩' +
                formatMoney(totalUsd * usdkrw)
        };
    }

    function getCostTopText(lastInfo) {
        if (!GM_getValue(K_COST_ON, true)) {
            return '표시 꺼짐 · 비용 기록은 계속 누적돼요.';
        }

        const usdkrw = Math.max(
            1,
            parseFloat(GM_getValue(K_COST_USDKRW, 1400)) || 1400
        );

        const totalUsd =
            parseFloat(GM_getValue(K_COST_TOTAL_USD, 0)) || 0;

        const totalIn =
            parseInt(GM_getValue(K_COST_TOTAL_IN, 0), 10) || 0;

        const totalOut =
            parseInt(GM_getValue(K_COST_TOTAL_OUT, 0), 10) || 0;

        const totalReq =
            parseInt(GM_getValue(K_COST_REQ_COUNT, 0), 10) || 0;

        const last = lastInfo || getCostLog()[0];

        const lines = [
            '누적 약 ₩' +
                formatMoney(totalUsd * usdkrw) +
                ' · 요청 ' +
                totalReq +
                '회',
            '입력 ' +
                totalIn.toLocaleString('ko-KR') +
                'tok · 출력 ' +
                totalOut.toLocaleString('ko-KR') +
                'tok'
        ];

        if (last) {
            lines.push(
                '최근: ' +
                last.label +
                ' · 약 ₩' +
                formatMoney(last.krw)
            );
        }

        return lines.join('\n');
    }

    function getCostSummaryText() {
        const lines = [getCostTopText()];

        const log = getCostLog().slice(0, 15);

        if (log.length) {
            lines.push('');
            lines.push('최근 사용내역');

            log.forEach((item, index) => {
                lines.push(
                    (index + 1) +
                    '. ' +
                    item.at +
                    ' · ' +
                    item.label +
                    ' · ' +
                    item.modelLabel +
                    ' · 약 ₩' +
                    formatMoney(item.krw)
                );
            });
        } else {
            lines.push('');
            lines.push('아직 기록된 요청이 없어요.');
        }

        lines.push('');
        lines.push(
            '※ Standard 단가 기반의 대략값이며 무료 티어, 캐시, 세금, 실제 환율은 다를 수 있어요.'
        );

        return lines.join('\n');
    }

    function resetCostStats() {
        GM_setValue(K_COST_TOTAL_USD, 0);
        GM_setValue(K_COST_TOTAL_IN, 0);
        GM_setValue(K_COST_TOTAL_OUT, 0);
        GM_setValue(K_COST_REQ_COUNT, 0);
        GM_setValue(K_COST_LOG, []);
    }

    /* =========================
     * 채팅 입력
     * ========================= */
    function findChatInput() {
        const panel = document.getElementById(PANEL_ID);

        const candidates = Array.from(document.querySelectorAll(
            'textarea, [contenteditable="true"], [contenteditable=""]'
        )).filter(el => {
            if (panel && panel.contains(el)) return false;
            return isVisible(el);
        });

        candidates.sort((a, b) => {
            return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
        });

        return candidates[0] || null;
    }

    function insertIntoChat(text) {
        const el = findChatInput();

        if (!el) return false;

        if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
            const prototype =
                el.tagName === 'TEXTAREA'
                    ? window.HTMLTextAreaElement.prototype
                    : window.HTMLInputElement.prototype;

            const descriptor =
                Object.getOwnPropertyDescriptor(prototype, 'value');

            if (descriptor && descriptor.set) {
                descriptor.set.call(el, text);
            } else {
                el.value = text;
            }

            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
            el.focus();
            el.textContent = text;

            try {
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: text
                }));
            } catch (_) {
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        try {
            el.blur();
        } catch (_) {}

        return true;
    }

    /* =========================
     * UI 스타일
     * ========================= */
    const CSS = `
        #${PANEL_ID}, #${FAB_ID}, #${PANEL_ID} * {
            box-sizing: border-box;
            font-family: Pretendard, "Noto Sans KR", system-ui, sans-serif;
        }

        #${PANEL_ID} {
            position: fixed;
            z-index: 2147483646;
            width: 326px;
            max-width: calc(100vw - 24px);
            max-height: calc(100dvh - 24px);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            color: #eceef6;
            background: #1d1f27;
            border: 1px solid #363b4d;
            border-radius: 15px;
            box-shadow: 0 12px 40px rgba(0,0,0,.45);
            font-size: 13px;
        }

        #se-head {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 45px;
            padding: 9px 11px;
            cursor: grab;
            touch-action: none;
            user-select: none;
            background: linear-gradient(135deg,#2a2d3a,#23262f);
            border-bottom: 1px solid #363b4d;
        }

        #se-title {
            flex: 1;
            font-size: 12px;
            font-weight: 850;
        }

        #se-head button {
            border: 0;
            padding: 3px 5px;
            background: transparent;
            color: #fff;
            font-size: 16px;
            cursor: pointer;
        }

        #se-body,
        #se-settings {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-height: 0;
            padding: 10px;
            overflow-y: auto;
            -webkit-overflow-scrolling: touch;
        }

        #se-settings {
            display: none;
        }

        #se-settings.show {
            display: flex;
        }

        #se-body.hide {
            display: none;
        }

        .se-label {
            margin: 0 2px -4px;
            color: #a9aec1;
            font-size: 11px;
            font-weight: 750;
        }

        #${PANEL_ID} textarea,
        #${PANEL_ID} input,
        #${PANEL_ID} select {
            width: 100%;
            min-width: 0;
            border: 1px solid #363b4d;
            border-radius: 9px;
            padding: 8px;
            background: #14161c;
            color: #eceef6;
            font-size: 12px;
        }

        #${PANEL_ID} textarea {
            min-height: 50px;
            resize: vertical;
            line-height: 1.5;
        }

        #se-dialogue {
            border-left: 3px solid #5fd0c3 !important;
        }

        #se-action {
            border-left: 3px solid #c8a6ff !important;
        }

        .se-tabs {
            display: flex;
            gap: 4px;
            padding: 3px;
            border-radius: 9px;
            background: #14161c;
        }

        .se-tabs button {
            flex: 1;
            border: 0;
            border-radius: 7px;
            padding: 7px 2px;
            background: transparent;
            color: #9da2b6;
            font-size: 11px;
            font-weight: 750;
            cursor: pointer;
        }

        .se-tabs button.active {
            background: #41475c;
            color: #fff;
        }

        #se-go,
        #se-insert,
        #se-save {
            width: 100%;
            min-height: 42px;
            border: 0;
            border-radius: 10px;
            font-size: 13px;
            font-weight: 850;
            cursor: pointer;
        }

        #se-go {
            color: #fff;
            background: linear-gradient(135deg,#6c7bff,#8a5cff);
        }

        #se-insert {
            display: none;
            color: #07241c;
            background: linear-gradient(135deg,#3ecf8e,#2fb3c0);
        }

        #se-save {
            color: #fff;
            background: #6c7bff;
        }

        #se-go:disabled,
        #se-persona-suggest:disabled,
        #se-fetch:disabled {
            opacity: .6;
            cursor: default;
        }

        #se-status,
        #se-fetch-status,
        #se-persona-status,
        #se-ctx-status,
        #se-sync-status {
            min-height: 15px;
            color: #9da2b6;
            white-space: pre-wrap;
            font-size: 11px;
            line-height: 1.45;
        }

        .err {
            color: #ff9292 !important;
        }

        #se-output {
            display: none;
            min-height: 44px;
            max-height: 38vh;
            overflow-y: auto;
            padding: 10px;
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.65;
            border: 1px solid #363b4d;
            border-radius: 9px;
            background: #14161c;
        }

        #se-output.show,
        #se-insert.show,
        #se-result-buttons.show {
            display: block;
        }

        #se-result-buttons {
            display: none;
        }

        .se-btn-row {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .se-btn-row button,
        .se-secondary {
            flex: 1;
            min-height: 38px;
            border: 1px solid #464c61;
            border-radius: 9px;
            padding: 7px;
            background: #252833;
            color: #e6e8f0;
            font-size: 11px;
            font-weight: 750;
            cursor: pointer;
        }

        #se-cost-top {
            padding: 8px;
            white-space: pre-wrap;
            border: 1px solid rgba(244,114,182,.35);
            border-radius: 11px;
            background: rgba(244,114,182,.08);
            color: #f5f7ff;
            font-size: 10.5px;
            line-height: 1.45;
        }

        #se-persona-featured {
            display: flex;
            flex-direction: column;
            gap: 7px;
            padding: 9px;
            border: 1px solid rgba(138,92,255,.55);
            border-radius: 12px;
            background: rgba(108,123,255,.08);
        }

        #se-persona-featured-title {
            color: #fff;
            font-size: 13px;
            font-weight: 850;
        }

        #se-persona-result {
            border: 1px solid rgba(148,163,184,.22);
            border-radius: 10px;
            background: rgba(0,0,0,.10);
            overflow: hidden;
        }

        #se-persona-result > summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            list-style: none;
            padding: 8px 9px;
            cursor: pointer;
            color: #f4f5fa;
            font-size: 11px;
            font-weight: 800;
        }

        #se-persona-result > summary::-webkit-details-marker {
            display: none;
        }

        #se-persona-result > summary::after {
            content: "보기";
            color: #aeb3c5;
            font-size: 10px;
        }

        #se-persona-result[open] > summary::after {
            content: "접기";
        }

        #se-persona-result-body {
            padding: 0 7px 7px;
        }

        #se-persona-text-0 {
            min-height: 120px !important;
            height: 150px !important;
            max-height: 180px !important;
            overflow-y: auto !important;
            resize: vertical;
            line-height: 1.55;
        }

        #se-persona-hint {
            min-height: 64px !important;
        }

        #se-persona-suggest {
            flex: none;
            width: 100%;
            min-height: 42px;
            border-color: rgba(138,92,255,.75);
            background: linear-gradient(135deg,#6c7bff,#8a5cff);
            color: #fff;
            font-size: 12px;
        }

        details.se-section {
            border: 1px solid rgba(148,163,184,.22);
            border-radius: 11px;
            background: rgba(255,255,255,.025);
            overflow: hidden;
        }

        details.se-section > summary {
            display: flex;
            align-items: center;
            justify-content: space-between;
            list-style: none;
            padding: 9px;
            cursor: pointer;
            color: #f4f5fa;
            font-size: 12px;
            font-weight: 800;
        }

        details.se-section > summary::-webkit-details-marker {
            display: none;
        }

        details.se-section > summary::after {
            content: "열기";
            padding: 2px 7px;
            border: 1px solid #454b60;
            border-radius: 999px;
            color: #aeb3c5;
            font-size: 10px;
        }

        details.se-section[open] > summary::after {
            content: "닫기";
        }

        .se-section-body {
            display: flex;
            flex-direction: column;
            gap: 7px;
            padding: 8px;
            border-top: 1px solid rgba(148,163,184,.17);
        }

        .se-slot {
            display: flex;
            flex-direction: column;
            gap: 5px;
            padding: 7px;
            border: 1px solid #363b4d;
            border-radius: 9px;
            background: #181a21;
        }

        .se-slot-head,
        .se-inline {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
        }

        #${PANEL_ID} input[type="checkbox"] {
            width: 18px;
            height: 18px;
            flex: 0 0 auto;
            padding: 0;
            accent-color: #6c7bff;
        }

        .se-slot-name {
            flex: 1 1 130px;
        }

        .se-inline-number {
            width: 72px !important;
            flex: 0 0 auto;
            text-align: center;
        }

        #se-cost-detail {
            max-height: 150px;
            overflow-y: auto;
            white-space: pre-wrap;
            color: #aeb3c5;
            font-size: 10.5px;
            line-height: 1.45;
        }

        #se-sync-box {
            min-height: 70px !important;
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
            background: #ff3a98;
            color: #fff;
            box-shadow: 0 6px 20px rgba(0,0,0,.45);
            font-size: 23px;
            cursor: pointer;
            touch-action: none;
            user-select: none;
        }

        @media (pointer: coarse), (max-width: 700px) {
            #${PANEL_ID} {
                width: min(326px, calc(100vw - 24px));
                max-height: calc(100dvh - 24px);
                border-radius: 10px;
                box-shadow: none;
            }

            #${FAB_ID} {
                display: flex !important;
                visibility: visible !important;
                opacity: 1 !important;
                pointer-events: auto !important;
            }

            #se-body,
            #se-settings {
                padding: 8px;
                gap: 6px;
            }

            #${PANEL_ID} textarea {
                min-height: 44px;
                max-height: 105px;
            }

            #se-persona-text-0 {
                min-height: 110px !important;
                height: 140px !important;
                max-height: 165px !important;
                overflow-y: auto !important;
            }

            #se-settings {
                overscroll-behavior: contain;
                touch-action: pan-y;
                padding-bottom: 18px;
            }
        }
    `;

    function injectStyle() {
        if (document.getElementById('se-full-style')) return;

        const style = document.createElement('style');
        style.id = 'se-full-style';
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    /* =========================
     * UI 생성
     * ========================= */
    function slotHTML(type, count, label) {
        let html = '';

        for (let i = 0; i < count; i++) {
            html += `
                <div class="se-slot">
                    <div class="se-slot-head">
                        <input type="checkbox" id="se-${type}-on-${i}">
                        <input
                            class="se-slot-name"
                            id="se-${type}-name-${i}"
                            type="text"
                            placeholder="${label} ${i + 1} 이름"
                        >
                    </div>
                    <textarea
                        id="se-${type}-text-${i}"
                        placeholder="${label} 내용을 입력하세요"
                    ></textarea>
                </div>
            `;
        }

        return html;
    }

    function slotHTMLRange(type, start, end, label) {
        let html = '';

        for (let i = start; i < end; i++) {
            html += `
                <div class="se-slot">
                    <div class="se-slot-head">
                        <input type="checkbox" id="se-${type}-on-${i}">
                        <input
                            class="se-slot-name"
                            id="se-${type}-name-${i}"
                            type="text"
                            placeholder="${label} ${i + 1} 이름"
                        >
                    </div>
                    <textarea
                        id="se-${type}-text-${i}"
                        placeholder="${label} 내용을 입력하세요"
                    ></textarea>
                </div>
            `;
        }

        return html;
    }

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.innerHTML = `
            <div id="se-head">
                <span id="se-title">✨ 문장 부풀리기 · v6.12.35</span>
                <button id="se-gear" type="button" title="설정">⚙️</button>
                <button id="se-close" type="button" title="닫기">✕</button>
            </div>

            <div id="se-body">
                <div id="se-cost-top">아직 계산된 사용량이 없어요.</div>

                <div class="se-label">💬 대사</div>
                <textarea id="se-dialogue" placeholder="예: 괜찮아, 내가 도와줄게"></textarea>

                <div class="se-label">🎬 행동</div>
                <textarea id="se-action" placeholder="예: 시선을 피하며 작게 웃는다"></textarea>

                <div class="se-tabs" id="se-pov">
                    <button type="button" data-value="first">1인칭</button>
                    <button type="button" data-value="third">3인칭</button>
                </div>

                <div class="se-tabs" id="se-length">
                    <button type="button" data-value="three">세줄</button>
                    <button type="button" data-value="short">짧게</button>
                    <button type="button" data-value="medium">중간</button>
                    <button type="button" data-value="long">길게</button>
                </div>

                <button id="se-go" type="button">✨ 문학적으로 늘리기</button>
                <div id="se-status"></div>
                <div id="se-output"></div>
                <button id="se-insert" type="button">💬 채팅창에 바로 넣기</button>

                <div class="se-btn-row" id="se-result-buttons">
                    <button id="se-copy" type="button">📋 복사</button>
                    <button id="se-retry" type="button">🔄 다시 뽑기</button>
                </div>
            </div>

            <div id="se-settings">
                <div id="se-persona-featured">
                    <div id="se-persona-featured-title">🎭 추천 페르소나 · 맨 위 고정</div>

                    <textarea
                        id="se-persona-hint"
                        placeholder="추천 키워드 예: 여자 검사, 무뚝뚝, 책임감 강함"
                    ></textarea>

                    <button
                        id="se-persona-suggest"
                        class="se-secondary"
                        type="button"
                    >✨ 현재 설정으로 페르소나 추천</button>

                    <div id="se-persona-status"></div>

                    <details id="se-persona-result">
                        <summary>추천 결과 / 직접 편집</summary>
                        <div id="se-persona-result-body">
                            <div class="se-slot">
                                <div class="se-slot-head">
                                    <input type="checkbox" id="se-persona-on-0">
                                    <input
                                        class="se-slot-name"
                                        id="se-persona-name-0"
                                        type="text"
                                        placeholder="추천 페르소나 이름"
                                    >
                                </div>
                                <textarea
                                    id="se-persona-text-0"
                                    placeholder="추천 결과가 여기에 표시돼요. 내부에서 스크롤하거나 직접 수정할 수 있습니다."
                                ></textarea>
                            </div>
                        </div>
                    </details>
                </div>

                <details class="se-section" open>
                    <summary>💬 최근 대화 맥락 · 항상 참고</summary>
                    <div class="se-section-body">
                        <div class="se-inline">
                            <input id="se-ctx-on" type="checkbox" checked disabled>
                            <span>직전 상대 채팅 + 최근</span>
                            <input
                                id="se-ctx-n"
                                class="se-inline-number"
                                type="number"
                                min="1"
                                max="30"
                                value="6"
                            >
                            <span>개</span>
                        </div>

                        <div class="se-label">직전 상대 캐릭터 채팅은 항상 읽고, 위 숫자만큼 이전 대화도 함께 참고해요.</div>

                        <div class="se-btn-row">
                            <button id="se-ctx-preview" type="button">🔍 실제로 읽힌 맥락 보기</button>
                            <button id="se-ctx-clear" type="button">🧹 이 채팅방 캐시 지우기</button>
                        </div>

                        <div id="se-ctx-status"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>🎭 추가 페르소나 2·3번</summary>
                    <div class="se-section-body">
                        ${slotHTMLRange('persona', 1, PERSONA_SLOTS, '페르소나')}
                    </div>
                </details>

                <details class="se-section">
                    <summary>✍️ 문체 규칙</summary>
                    <div class="se-section-body">
                        ${slotHTML('style', STYLE_SLOTS, '문체')}
                    </div>
                </details>

                <details class="se-section">
                    <summary>🤖 API / 모델 / 기본 설정</summary>
                    <div class="se-section-body">
                        <div class="se-label">캐릭터 이름 (3인칭용)</div>
                        <input id="se-name" type="text" placeholder="예: 서지훈">

                        <div class="se-label">Gemini API 키</div>
                        <input id="se-key" type="password" placeholder="AIza...">

                        <div class="se-label">모델 드롭다운</div>
                        <select id="se-model"></select>

                        <button id="se-fetch" class="se-secondary" type="button">
                            🔄 사용 가능한 모델 불러오기
                        </button>

                        <div id="se-fetch-status"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>💸 API 비용 추정 / 사용내역</summary>
                    <div class="se-section-body">
                        <div class="se-inline">
                            <input id="se-cost-on" type="checkbox">
                            <span>상단 표시 · 환율</span>
                            <input
                                id="se-cost-rate"
                                class="se-inline-number"
                                type="number"
                                min="1"
                                value="1400"
                            >
                            <span>원/USD</span>
                        </div>

                        <button id="se-cost-reset" class="se-secondary" type="button">
                            🧹 비용 누적 초기화
                        </button>

                        <div id="se-cost-detail"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>🔄 설정 동기화</summary>
                    <div class="se-section-body">
                        <textarea
                            id="se-sync-box"
                            placeholder="내보내기 코드를 복사하거나 다른 기기의 코드를 붙여넣으세요."
                        ></textarea>

                        <div class="se-btn-row">
                            <button id="se-export" type="button">📤 내보내기</button>
                            <button id="se-import" type="button">📥 가져오기</button>
                        </div>

                        <div id="se-sync-status"></div>
                    </div>
                </details>

                <button id="se-save" type="button">저장하고 닫기</button>
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

    /* =========================
     * 위치 / 드래그
     * ========================= */
    function clampElementToViewport(element, saveKey, isPanel) {
        if (!element || getComputedStyle(element).display === 'none') return;

        const viewport = getViewport();
        const rect = element.getBoundingClientRect();
        const width = rect.width || element.offsetWidth || (isPanel ? 326 : 58);
        const height = rect.height || element.offsetHeight || (isPanel ? 500 : 58);

        let left = parseFloat(element.style.left);
        let top = parseFloat(element.style.top);

        if (!Number.isFinite(left)) left = rect.left;
        if (!Number.isFinite(top)) top = rect.top;

        const lost =
            rect.right < viewport.left ||
            rect.left > viewport.left + viewport.width ||
            rect.bottom < viewport.top ||
            rect.top > viewport.top + viewport.height;

        if (lost || !Number.isFinite(left) || !Number.isFinite(top)) {
            left = isPanel
                ? viewport.left + EDGE
                : viewport.left + viewport.width - width - EDGE;

            top = isPanel
                ? viewport.top + EDGE
                : viewport.top + viewport.height - height - 100;
        }

        left = clamp(
            left,
            viewport.left + EDGE,
            Math.max(
                viewport.left + EDGE,
                viewport.left + viewport.width - width - EDGE
            )
        );

        top = clamp(
            top,
            viewport.top + EDGE,
            Math.max(
                viewport.top + EDGE,
                viewport.top + viewport.height -
                    Math.min(height, isPanel ? 90 : height) -
                    EDGE
            )
        );

        element.style.setProperty('position', 'fixed', 'important');
        element.style.setProperty('left', left + 'px', 'important');
        element.style.setProperty('top', top + 'px', 'important');
        element.style.setProperty('right', 'auto', 'important');
        element.style.setProperty('bottom', 'auto', 'important');
        element.style.setProperty('transform', 'none', 'important');

        if (saveKey) {
            GM_setValue(saveKey, { left, top });
        }
    }

    function makeDraggable(element, handle, saveKey, isPanel, onTap) {
        let dragging = false;
        let moved = false;
        let pointerId = null;
        let offsetX = 0;
        let offsetY = 0;
        let startX = 0;
        let startY = 0;

        handle.addEventListener('pointerdown', event => {
            if (isPanel && event.target.closest('button')) return;

            dragging = true;
            moved = false;
            pointerId = event.pointerId;

            const rect = element.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            startX = event.clientX;
            startY = event.clientY;

            try {
                handle.setPointerCapture(pointerId);
            } catch (_) {}

            event.preventDefault();
        }, { passive: false });

        handle.addEventListener('pointermove', event => {
            if (!dragging || event.pointerId !== pointerId) return;

            if (
                Math.abs(event.clientX - startX) +
                Math.abs(event.clientY - startY) > 9
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
                viewport.top + viewport.height -
                    Math.min(height, isPanel ? 90 : height) -
                    EDGE
            );

            element.style.left = left + 'px';
            element.style.top = top + 'px';
            element.style.right = 'auto';
            element.style.bottom = 'auto';

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

            clampElementToViewport(element, saveKey, isPanel);

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

    /* =========================
     * UI 연결
     * ========================= */
    function wireUI(panel, fab) {
        const $ = selector => panel.querySelector(selector);

        const body = $('#se-body');
        const settings = $('#se-settings');
        const dialogue = $('#se-dialogue');
        const action = $('#se-action');
        const output = $('#se-output');
        const insertButton = $('#se-insert');
        const resultButtons = $('#se-result-buttons');
        const status = $('#se-status');
        const goButton = $('#se-go');

        const keyInput = $('#se-key');
        const modelSelect = $('#se-model');
        const nameInput = $('#se-name');

        const personaHint = $('#se-persona-hint');
        const personaStatus = $('#se-persona-status');

        const ctxOn = $('#se-ctx-on');
        const ctxN = $('#se-ctx-n');
        const ctxStatus = $('#se-ctx-status');

        const costTop = $('#se-cost-top');
        const costOn = $('#se-cost-on');
        const costRate = $('#se-cost-rate');
        const costDetail = $('#se-cost-detail');

        const syncBox = $('#se-sync-box');
        const syncStatus = $('#se-sync-status');

        let lastResult = '';
        let statusTimer = null;

        function flash(message, error) {
            status.textContent = message || '';
            status.classList.toggle('err', !!error);

            if (statusTimer) clearTimeout(statusTimer);

            if (message && !error) {
                statusTimer = setTimeout(() => {
                    status.textContent = '';
                }, 3000);
            }
        }

        function setInfo(element, message, error) {
            element.textContent = message || '';
            element.classList.toggle('err', !!error);
        }

        function refreshCost(lastInfo) {
            costTop.textContent = getCostTopText(lastInfo);
            costDetail.textContent = getCostSummaryText();
        }

        function loadSlots(type, values, count) {
            for (let i = 0; i < count; i++) {
                const item = values[i];

                $('#se-' + type + '-on-' + i).checked = !!item.on;
                $('#se-' + type + '-name-' + i).value = item.name || '';
                $('#se-' + type + '-text-' + i).value = item.text || '';
            }
        }

        function collectSlots(type, count, prefix) {
            const result = [];

            for (let i = 0; i < count; i++) {
                result.push({
                    on: $('#se-' + type + '-on-' + i).checked,
                    name:
                        $('#se-' + type + '-name-' + i).value.trim() ||
                        prefix + ' ' + (i + 1),
                    text: $('#se-' + type + '-text-' + i).value
                });
            }

            return result;
        }

        function saveSlots() {
            GM_setValue(
                K_PERSONAS,
                collectSlots('persona', PERSONA_SLOTS, '페르소나')
            );

            GM_setValue(
                K_STYLES,
                collectSlots('style', STYLE_SLOTS, '문체')
            );
        }

        function populateModels(models, selected) {
            modelSelect.innerHTML = '';

            models.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.label;
                modelSelect.appendChild(option);
            });

            const wanted =
                selected ||
                GM_getValue(K_MODEL, models[0] && models[0].id);

            if (wanted && models.some(model => model.id === wanted)) {
                modelSelect.value = wanted;
            } else if (models[0]) {
                modelSelect.value = models[0].id;
            }
        }

        function setTab(containerSelector, storageKey, fallback) {
            const container = $(containerSelector);
            const current = GM_getValue(storageKey, fallback);

            container.querySelectorAll('button').forEach(button => {
                button.classList.toggle(
                    'active',
                    button.dataset.value === current
                );

                button.addEventListener('click', () => {
                    container.querySelectorAll('button').forEach(item => {
                        item.classList.remove('active');
                    });

                    button.classList.add('active');
                    GM_setValue(storageKey, button.dataset.value);
                });
            });
        }

        /* 초기 값 */
        keyInput.value = GM_getValue(K_APIKEY, '');
        nameInput.value = GM_getValue(K_NAME, '');
        personaHint.value = GM_getValue(K_PERSONA_HINT, '');

        ctxOn.checked = true;
        ctxOn.disabled = true;
        GM_setValue(K_CTX_ON, true);
        ctxN.value = GM_getValue(K_CTX_N, 6);

        costOn.checked = GM_getValue(K_COST_ON, true);
        costRate.value = GM_getValue(K_COST_USDKRW, 1400);

        loadSlots('persona', getPersonaSlots(), PERSONA_SLOTS);
        loadSlots('style', getStyleSlots(), STYLE_SLOTS);

        const storedModels = GM_getValue(K_MODELLIST, DEFAULT_MODELS);
        populateModels(
            Array.isArray(storedModels) && storedModels.length
                ? storedModels
                : DEFAULT_MODELS
        );

        setTab('#se-pov', K_POV, 'first');
        setTab('#se-length', K_LENGTH, 'medium');
        refreshCost();

        /* 위치 복구 */
        const panelPos = GM_getValue(K_POS, null);

        if (
            panelPos &&
            Number.isFinite(panelPos.left) &&
            Number.isFinite(panelPos.top)
        ) {
            panel.style.left = panelPos.left + 'px';
            panel.style.top = panelPos.top + 'px';
        } else {
            panel.style.left = '12px';
            panel.style.top = '70px';
        }

        const fabPos = GM_getValue(K_FABPOS, null);

        if (
            fabPos &&
            Number.isFinite(fabPos.left) &&
            Number.isFinite(fabPos.top)
        ) {
            fab.style.left = fabPos.left + 'px';
            fab.style.top = fabPos.top + 'px';
        } else {
            const viewport = getViewport();
            fab.style.left =
                Math.max(EDGE, viewport.width - 58 - EDGE) + 'px';
            fab.style.top =
                Math.max(EDGE, viewport.height - 58 - 100) + 'px';
        }

        if (GM_getValue(K_OPEN, true) === false) {
            panel.style.display = 'none';
        }

        function togglePanel() {
            const open = getComputedStyle(panel).display !== 'none';

            if (open) {
                panel.style.display = 'none';
                GM_setValue(K_OPEN, false);
            } else {
                panel.style.display = 'flex';
                GM_setValue(K_OPEN, true);

                requestAnimationFrame(() => {
                    if (!isSoftKeyboardOpen()) {
                        clampElementToViewport(panel, K_POS, true);
                    }
                });
            }
        }

        /* 헤더 버튼 */
        $('#se-close').addEventListener('click', () => {
            panel.style.display = 'none';
            GM_setValue(K_OPEN, false);
        });

        $('#se-gear').addEventListener('click', () => {
            const opening = !settings.classList.contains('show');

            settings.classList.toggle('show', opening);
            body.classList.toggle('hide', opening);

            if (opening) {
                settings.scrollTop = 0;
                const resultDetails = $('#se-persona-result');
                const personaResult = $('#se-persona-text-0');

                /* 결과가 있어도 설정 전체를 가리지 않도록 기본은 접힌 상태로 연다. */
                if (resultDetails && personaResult && personaResult.value.trim()) {
                    resultDetails.open = false;
                }
            }

            requestAnimationFrame(() => {
                if (!isSoftKeyboardOpen()) {
                    clampElementToViewport(panel, null, true);
                }
            });
        });

        /* 저장 */
        $('#se-save').addEventListener('click', () => {
            GM_setValue(K_APIKEY, keyInput.value.trim());
            GM_setValue(K_NAME, nameInput.value.trim());
            GM_setValue(K_PERSONA_HINT, personaHint.value.trim());
            GM_setValue(K_CTX_ON, true);
            GM_setValue(
                K_CTX_N,
                clamp(parseInt(ctxN.value, 10) || 6, 1, 30)
            );
            GM_setValue(K_COST_ON, costOn.checked);
            GM_setValue(
                K_COST_USDKRW,
                Math.max(1, parseFloat(costRate.value) || 1400)
            );

            if (modelSelect.value) {
                GM_setValue(K_MODEL, modelSelect.value);
            }

            saveSlots();
            refreshCost();

            settings.classList.remove('show');
            body.classList.remove('hide');
            flash('저장됐어요 ✅');
        });

        /* 모델 불러오기 */
        $('#se-fetch').addEventListener('click', () => {
            const button = $('#se-fetch');
            const fetchStatus = $('#se-fetch-status');

            GM_setValue(K_APIKEY, keyInput.value.trim());

            button.disabled = true;
            setInfo(fetchStatus, '불러오는 중…', false);

            fetchModels(
                models => {
                    GM_setValue(K_MODELLIST, models);
                    populateModels(models, modelSelect.value);
                    button.disabled = false;
                    setInfo(
                        fetchStatus,
                        models.length + '개 모델을 불러왔어요 ✅',
                        false
                    );
                },
                error => {
                    button.disabled = false;
                    setInfo(fetchStatus, error, true);
                }
            );
        });

        modelSelect.addEventListener('change', () => {
            GM_setValue(K_MODEL, modelSelect.value);
        });

        /* 페르소나 자동추천 */
        $('#se-persona-suggest').addEventListener('click', () => {
            const button = $('#se-persona-suggest');
            const keywords = personaHint.value.trim();

            GM_setValue(K_APIKEY, keyInput.value.trim());
            GM_setValue(K_MODEL, modelSelect.value);
            GM_setValue(K_PERSONA_HINT, keywords);

            const storyDetail = collectStoryDetail();
            const context = collectChatContext(
                clamp(parseInt(ctxN.value, 10) || 10, 6, 20)
            );

            if (!keywords && !storyDetail && !context.length) {
                setInfo(
                    personaStatus,
                    '키워드나 읽을 설정/최근 맥락이 없어요.',
                    true
                );
                return;
            }

            const prompt = buildPersonaPrompt(
                keywords,
                storyDetail,
                context
            );

            button.disabled = true;
            setInfo(
                personaStatus,
                '설정과 최근 맥락을 읽고 페르소나 추천 중…',
                false
            );

            requestGemini(
                prompt.system,
                prompt.user,
                '페르소나 추천',
                (text, costInfo) => {
                    const slots = collectSlots(
                        'persona',
                        PERSONA_SLOTS,
                        '페르소나'
                    );

                    /* 추천 결과는 항상 맨 위 1번 칸에 넣는다.
                     * 기존에는 켜져 있는 2·3번 칸에 들어가 결과가 아래로 숨어버릴 수 있었다. */
                    const index = 0;
                    const resultTextarea = $('#se-persona-text-0');

                    $('#se-persona-on-0').checked = true;
                    resultTextarea.value = text;

                    /* 결과는 접이식 영역 안에서 제한된 높이로 보여 하단 설정을 가리지 않는다. */
                    const resultDetails = $('#se-persona-result');
                    if (resultDetails) resultDetails.open = true;
                    resultTextarea.style.height = '';

                    const nameInput = $('#se-persona-name-' + index);
                    if (
                        !nameInput.value.trim() ||
                        /^페르소나\s*\d+$/.test(nameInput.value.trim())
                    ) {
                        nameInput.value = '자동추천 페르소나';
                    }

                    saveSlots();
                    refreshCost(costInfo);

                    button.disabled = false;
                    setInfo(
                        personaStatus,
                        '추천 결과를 맨 위 1번 칸에 넣었어요 ✅' +
                            (costInfo ? '\n' + costInfo.message : ''),
                        false
                    );

                    requestAnimationFrame(() => {
                        const resultDetails = $('#se-persona-result');
                        if (resultDetails && resultDetails.scrollIntoView) {
                            resultDetails.scrollIntoView({
                                behavior: 'smooth',
                                block: 'nearest'
                            });
                        }
                        resultTextarea.scrollTop = 0;
                    });
                },
                error => {
                    button.disabled = false;
                    setInfo(personaStatus, error, true);
                }
            );
        });

        /* 맥락 */
        /* 직전 채팅 맥락은 항상 사용한다. */
        ctxOn.addEventListener('change', () => {
            ctxOn.checked = true;
            GM_setValue(K_CTX_ON, true);
        });

        $('#se-ctx-preview').addEventListener('click', () => {
            const n = clamp(parseInt(ctxN.value, 10) || 6, 1, 30);
            GM_setValue(K_CTX_N, n);

            const visible = collectVisibleChatLines();
            rememberCtxLines(visible);

            const context = collectChatContext(n);
            const latestSnapshot = collectLatestSceneSnapshot();
            const sceneFocus = extractSceneFocus(latestSnapshot.text);

            if (!context.length && !latestSnapshot.text) {
                setInfo(
                    ctxStatus,
                    '대화를 못 잡았어요. 시작 카드와 채팅이 보이는 상태에서 다시 눌러보세요.',
                    true
                );
                return;
            }

            setInfo(
                ctxStatus,
                '실제 생성 기준: ' +
                    (latestSnapshot.source || '판별 실패') + '\n' +
                    '최근 대화 흐름: ' +
                    (sceneFocus.recentDialogue.length ? sceneFocus.recentDialogue.join(' / ') : '(직접 발화 없음)') + '\n' +
                    '장면 참고 단서: ' +
                    (sceneFocus.keywords.join(', ') || '(없음)') + '\n\n' +
                    context.length +
                    '개 참고 예정 (요청 ' +
                    n +
                    '개) / 화면 후보 ' +
                    visible.length +
                    '개 / 누적 캐시 ' +
                    getCtxCache().length +
                    '개\n' +
                    context.map((item, index) => {
                        return (
                            (index + 1) +
                            '. ' +
                            (
                                item.length > 260
                                    ? item.slice(0, 260) + '…'
                                    : item
                            )
                        );
                    }).join('\n'),
                false
            );
        });

        $('#se-ctx-clear').addEventListener('click', () => {
            clearCtxCache();
            setInfo(
                ctxStatus,
                '현재 채팅방의 저장된 맥락 캐시를 지웠어요 🧹',
                false
            );
        });

        /* 비용 */
        costOn.addEventListener('change', () => {
            GM_setValue(K_COST_ON, costOn.checked);
            refreshCost();
        });

        costRate.addEventListener('change', () => {
            GM_setValue(
                K_COST_USDKRW,
                Math.max(1, parseFloat(costRate.value) || 1400)
            );
            refreshCost();
        });

        $('#se-cost-reset').addEventListener('click', () => {
            resetCostStats();
            refreshCost();
        });

        /* 설정 동기화 */
        const syncKeys = [
            K_APIKEY,
            K_MODEL,
            K_MODELLIST,
            K_PERSONAS,
            K_PERSONA_HINT,
            K_STYLES,
            K_NAME,
            K_POV,
            K_LENGTH,
            K_CTX_ON,
            K_CTX_N,
            K_COST_ON,
            K_COST_USDKRW,
            K_COST_TOTAL_USD,
            K_COST_TOTAL_IN,
            K_COST_TOTAL_OUT,
            K_COST_REQ_COUNT,
            K_COST_LOG
        ];

        $('#se-export').addEventListener('click', () => {
            saveSlots();

            const data = {};

            syncKeys.forEach(key => {
                const value = GM_getValue(key, null);
                if (value !== null && value !== undefined) {
                    data[key] = value;
                }
            });

            const code =
                'CSE1:' +
                b64encUtf8(JSON.stringify({
                    version: 1,
                    app: 'crack-se',
                    data
                }));

            syncBox.value = code;

            copyToClipboard(code)
                .then(() => {
                    setInfo(
                        syncStatus,
                        '동기화 코드를 만들고 복사했어요 📋',
                        false
                    );
                })
                .catch(() => {
                    setInfo(
                        syncStatus,
                        '코드를 만들었어요. 위 칸을 직접 복사해 주세요.',
                        false
                    );
                });
        });

        $('#se-import').addEventListener('click', () => {
            let raw = syncBox.value.trim();

            if (!raw) {
                setInfo(syncStatus, '가져올 코드를 붙여넣어 주세요.', true);
                return;
            }

            raw = raw
                .replace(/^```(?:txt|json|js)?/i, '')
                .replace(/```$/i, '')
                .trim();

            try {
                let parsed;

                if (raw.startsWith('CSE1:')) {
                    parsed = JSON.parse(
                        b64decUtf8(raw.slice(5).replace(/\s+/g, ''))
                    );
                } else {
                    parsed = JSON.parse(raw);
                }

                if (!parsed || !parsed.data) {
                    throw new Error('설정 데이터 없음');
                }

                let count = 0;

                syncKeys.forEach(key => {
                    if (
                        Object.prototype.hasOwnProperty.call(
                            parsed.data,
                            key
                        )
                    ) {
                        GM_setValue(key, parsed.data[key]);
                        count++;
                    }
                });

                setInfo(
                    syncStatus,
                    count +
                        '개 설정을 가져왔어요. 잠시 후 새로고침할게요…',
                    false
                );

                setTimeout(() => location.reload(), 700);
            } catch (error) {
                setInfo(
                    syncStatus,
                    '코드를 읽지 못했어요. 전체 코드를 다시 붙여넣어 주세요.',
                    true
                );
            }
        });

        /* 문장 생성 */
        function renderResult(text) {
            lastResult = text;
            output.textContent = text;
            output.classList.add('show');
            insertButton.classList.add('show');
            resultButtons.classList.add('show');

            requestAnimationFrame(() => {
                if (!isSoftKeyboardOpen()) {
                    clampElementToViewport(panel, null, true);
                }
            });
        }

        function run() {
            const d = dialogue.value;
            const a = action.value;

            if (!d.trim() && !a.trim()) {
                flash('대사나 행동 중 하나는 입력해 주세요.', true);
                return;
            }

            GM_setValue(K_APIKEY, keyInput.value.trim());
            GM_setValue(K_MODEL, modelSelect.value);
            saveSlots();

            const context = collectChatContext(
                clamp(parseInt(ctxN.value, 10) || 6, 1, 30)
            );
            const latestSnapshot = collectLatestSceneSnapshot();
            const sceneFocus = extractSceneFocus(latestSnapshot.text);
            const prompt = buildPrompt(d, a, context, latestSnapshot);

            goButton.disabled = true;
            output.classList.remove('show');
            insertButton.classList.remove('show');
            resultButtons.classList.remove('show');
            flash('늘리는 중… ✍️');

            requestGemini(
                prompt.system,
                prompt.user,
                '문장 부풀리기',
                (text, costInfo) => {
                    const formattedText = normalizeRoleplayItalics(text);

                    if (
                        latestSnapshot.text &&
                        !isContextGroundedOutput(formattedText, sceneFocus)
                    ) {
                        flash('문맥과 동떨어진 일반론을 감지해 자동으로 다시 맞추는 중…');

                        const repairUser = [
                            prompt.user,
                            '',
                            '[재교정 요청]',
                            '아래 첫 출력은 어느 장면에도 붙일 수 있는 범용 복종문에 치우쳤다.',
                            '첫 출력: ' + formattedText,
                            '직전 장면의 최근 흐름: ' + (sceneFocus.tail || latestSnapshot.text || '(없음)'),
                            '장면 전체 참고 단서: ' + (sceneFocus.keywords.join(', ') || '(없음)'),
                            '마지막 문장 하나를 복창하지 말고 직전 장면 전체의 사건·감정·관계 변화 중 가장 자연스러운 지점에 반응하는 본문으로 다시 작성해.'
                        ].join('\n');

                        requestGemini(
                            prompt.system,
                            repairUser,
                            '문장 부풀리기 자동 재교정',
                            (repaired, repairCost) => {
                                const formattedRepair = normalizeRoleplayItalics(repaired);
                                renderResult(formattedRepair);
                                refreshCost(repairCost || costInfo);
                                goButton.disabled = false;
                                flash(
                                    repairCost
                                        ? '문맥에 맞게 자동 재교정했어요.\n' + repairCost.message
                                        : '문맥에 맞게 자동 재교정했어요.'
                                );
                            },
                            error => {
                                renderResult(formattedText);
                                refreshCost(costInfo);
                                goButton.disabled = false;
                                flash('자동 재교정은 실패했지만 첫 결과를 표시했어요: ' + error, true);
                            }
                        );
                        return;
                    }

                    renderResult(formattedText);
                    refreshCost(costInfo);
                    goButton.disabled = false;
                    flash(costInfo ? costInfo.message : '');
                },
                error => {
                    goButton.disabled = false;
                    flash(error, true);
                }
            );
        }

        goButton.addEventListener('click', run);
        $('#se-retry').addEventListener('click', run);

        [dialogue, action].forEach(ta => {
            ta.addEventListener('keydown', event => {
                if (
                    (event.ctrlKey || event.metaKey) &&
                    event.key === 'Enter'
                ) {
                    event.preventDefault();
                    run();
                }
            });
        });

        $('#se-copy').addEventListener('click', () => {
            if (!lastResult) return;

            copyToClipboard(lastResult)
                .then(() => flash('복사 완료 📋'))
                .catch(() => flash('복사 실패 😢', true));
        });

        insertButton.addEventListener('click', () => {
            if (!lastResult) return;

            if (insertIntoChat(lastResult)) {
                dialogue.value = '';
                action.value = '';
                panel.style.display = 'none';
                GM_setValue(K_OPEN, false);
            } else {
                copyToClipboard(lastResult)
                    .then(() => {
                        flash(
                            '채팅창을 못 찾아 결과를 복사했어요.',
                            true
                        );
                    })
                    .catch(() => {
                        flash('채팅창을 찾지 못했어요.', true);
                    });
            }
        });

        /* 드래그 */
        makeDraggable(
            panel,
            $('#se-head'),
            K_POS,
            true
        );

        makeDraggable(
            fab,
            fab,
            K_FABPOS,
            false,
            togglePanel
        );

        /* 모바일 화면 변화 복구
         * 소프트 키보드가 열린 동안에는 visualViewport의 크기와 오프셋이
         * 계속 바뀔 수 있으므로 패널과 FAB의 저장 좌표를 아예 건드리지 않는다.
         */
        const repair = () => {
            if (isSoftKeyboardOpen()) return;

            clampElementToViewport(fab, null, false);

            if (getComputedStyle(panel).display !== 'none') {
                clampElementToViewport(panel, null, true);
            }
        };

        window.addEventListener('resize', repair, { passive: true });
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                if (!isSoftKeyboardOpen()) {
                    stableViewportHeight = window.visualViewport
                        ? window.visualViewport.height
                        : window.innerHeight;

                    repair();
                }
            }, 350);
        }, { passive: true });

        if (window.visualViewport) {
            window.visualViewport.addEventListener(
                'resize',
                () => {
                    if (!isSoftKeyboardOpen()) repair();
                },
                { passive: true }
            );

            window.visualViewport.addEventListener(
                'scroll',
                () => {
                    if (!isSoftKeyboardOpen()) repair();
                },
                { passive: true }
            );
        }

        [0, 100, 400, 1000, 2500].forEach(delay => {
            setTimeout(repair, delay);
        });
    }

    /* =========================
     * 시작
     * ========================= */
    function init() {
        if (document.getElementById(PANEL_ID)) return;

        injectStyle();
        buildUI();
        attachContextObserver();

        [100, 500, 1200, 2500, 5000].forEach(delay => {
            setTimeout(collectStoryBootstrap, delay);
        });

        routeTimer = setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                setTimeout(attachContextObserver, 300);
                setTimeout(collectStoryBootstrap, 350);
                setTimeout(collectStoryBootstrap, 1200);
                setTimeout(() => {
                    const panel = document.getElementById(PANEL_ID);
                    const fab = document.getElementById(FAB_ID);

                    if (isSoftKeyboardOpen()) return;

                    clampElementToViewport(fab, null, false);

                    if (
                        panel &&
                        getComputedStyle(panel).display !== 'none'
                    ) {
                        clampElementToViewport(panel, null, true);
                    }
                }, 500);
            }
        }, 1600);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
