// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini) · 풀기능 모바일 수정판
// @namespace    https://crack.wrtn.ai
// @version      6.15.0
// @author       me
// @description  크랙 서버에서 최신 턴부터 거꾸로 정확히 불러오고, 채팅방별 장기기억(관계 변화·내 상태·할 일·있었던 일)을 자동 정리해 문장 부풀리기에 반영하는 경량판. Gemini 무료 키를 먼저 쓰고 한도를 다 쓰면 유료 키로 전환.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @connect      crack-api.wrtn.ai
// @homepageURL  https://github.com/voisei/crack-sentence-expander
// @supportURL   https://github.com/voisei/crack-sentence-expander/issues
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    /*
     * v6.15.0
     * - 🆓 무료 키를 먼저 쓰고, 그 모델의 하루 무료 한도를 다 쓰면 💳 유료 키로 자동 전환한다.
     *   분당 한도는 잠깐 기다렸다 무료로 다시 시도한다. 무료 요청은 비용 ₩0으로 기록한다.
     *
     * v6.14.0
     * - 턴 불러오기: 크랙 서버에서 최신 메시지부터 거꾸로(역순) 페이지를 넘기며
     *   "유저 메시지 N개 = N턴"을 정확히 맞춰 가져온다. 첫 턴 바로 앞 캐릭터 메시지도 함께.
     *   서버에서 못 불러오면 화면(DOM)에서 읽는 기존 방식으로 자동 전환한다.
     * - 장기기억: 채팅방마다 관계 변화 / 내 캐릭터의 현재 상태 / 해야 할 일 / 있었던 일을
     *   저장하고, 새 대화가 일정 턴 쌓이면 ✨늘리기 뒤에 자동으로 정리한다.
     *   정리된 기억은 프롬프트에 들어가 관계 단계·현재 상태에 맞게 문장이 바뀐다.
     *   기본 페르소나 칸은 건드리지 않고, 기억이 페르소나보다 우선하도록 지시한다.
     *
     * v6.13.0 성능 개선 메모
     * - 채팅 화면이 바뀔 때마다 "전체 메시지"를 다시 읽던 백그라운드 감시를 없앴다.
     *   이제 ✨늘리기 / 🔍미리보기 / 페르소나 추천 버튼을 누를 때만 최신 턴 몇 개를 읽는다.
     * - 턴 방향(최신이 위인지 아래인지) 판정은 목록 양 끝 일부만 표본으로 읽는다.
     * - innerText(화면 배치를 강제로 다시 계산시킴) 대신 textContent를 쓴다.
     * - 메시지마다 입력창을 다시 찾던 중복 계산을 없앴다.
     * - 채팅방마다 최대 300개씩 쌓이던 맥락 캐시를 "현재 방 40개"로 줄이고,
     *   예전 캐시는 한 번 정리한다.
     * - 화면 크기 변화 대응은 프레임당 한 번만 실행하고, 위치가 같으면 스타일을 다시 쓰지 않는다.
     */

    /* =========================
     * 저장 키
     * ========================= */
    const K_APIKEY = 'se_gemini_key';            /* 💳 유료(또는 기본) 키 */
    const K_APIKEY_FREE = 'se_gemini_key_free';  /* 🆓 무료 키 · 먼저 사용 */
    const K_FREE_STATE = 'se_free_state_v1';
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
    const K_CTX_LITE = 'se_ctx_lite_v1';
    const K_STORY_BOOTSTRAP_BASE = 'se_ctx_story_bootstrap_v5';
    const K_CLEANUP = 'se_storage_cleanup_v1';
    const LEGACY_CTX_PREFIX = 'se_ctx_cache';
    const LEGACY_BOOTSTRAP_PREFIX = 'se_ctx_story_bootstrap';

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
    const CTX_CACHE_LIMIT = 40;
    const STORY_BOOTSTRAP_LIMIT = 6;
    const TURN_SAMPLE = 8;
    const CTX_MAX_TURNS = 100;
    const FREE_RECHECK_MS = 30 * 60 * 1000;
    const FREE_MINUTE_WAIT_MAX = 20;

    /* 크랙 서버 / 장기기억 */
    const CRACK_API_BASE = 'https://crack-api.wrtn.ai/crack-gen/v3/chats';
    const K_MEM_BASE = 'se_mem_v1';
    const K_MEM_AUTO = 'se_mem_auto';
    const K_MEM_EVERY = 'se_mem_every';
    const MEM_CHUNK_TURNS = 15;
    const MEM_FIRST_TURNS = 20;
    const MEM_AUTO_MAX_TURNS = 30;
    const MEM_MANUAL_MAX_TURNS = 60;
    const MEM_PROMPT_RECENT_EVENTS = 12;
    const MEM_PROMPT_RELATED_EVENTS = 6;
    const MEM_LIMITS = {
        relationships: 15,
        userState: 12,
        todosOpen: 20,
        todosDone: 5,
        events: 120
    };

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

    let bootstrapObserver = null;
    let bootstrapTimer = null;
    let routeTimer = null;
    let lastUrl = location.href;
    let lastCtxSaveSig = '';
    let memoryBusy = false;
    let refreshMemoryUI = null;

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

    /* 긴 목록에서 앞쪽 size개 + 뒤쪽 size개의 인덱스만 고른다. */
    function sampleIndexes(length, size) {
        if (length <= 0) return [];
        if (length <= size * 2) {
            return Array.from({ length }, (_, index) => index);
        }

        const out = [];
        for (let i = 0; i < size; i++) out.push(i);
        for (let i = length - size; i < length; i++) out.push(i);
        return out;
    }

    /* =========================
     * 예전 저장소 정리 (한 번만)
     * ========================= */
    function cleanupLegacyStorage() {
        try {
            if (GM_getValue(K_CLEANUP, false)) return;
            if (
                typeof GM_listValues !== 'function' ||
                typeof GM_deleteValue !== 'function'
            ) {
                return;
            }

            const keys = GM_listValues() || [];

            for (const key of keys) {
                const name = String(key);
                const legacyCache = name.startsWith(LEGACY_CTX_PREFIX);
                const legacyBootstrap =
                    name.startsWith(LEGACY_BOOTSTRAP_PREFIX) &&
                    !name.startsWith(K_STORY_BOOTSTRAP_BASE);

                if (legacyCache || legacyBootstrap) {
                    GM_deleteValue(name);
                }
            }

            GM_setValue(K_CLEANUP, true);
        } catch (_) {}
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
     * 맥락 캐시 (현재 채팅방 1개만, 가볍게)
     * ========================= */
    function getCurrentRoomKey() {
        return (location.pathname || '') +
            (location.search || '') +
            (location.hash || '');
    }

    function getCtxCache() {
        const stored = GM_getValue(K_CTX_LITE, null);
        if (!stored || typeof stored !== 'object') return [];
        if (stored.room !== getCurrentRoomKey()) return [];
        if (!Array.isArray(stored.records)) return [];

        return stored.records.filter(item => {
            return item && typeof item === 'object' &&
                typeof item.id === 'string' &&
                typeof item.text === 'string';
        });
    }

    function saveCtxCache(records) {
        const list = (Array.isArray(records) ? records : [])
            .slice(-CTX_CACHE_LIMIT)
            .map(item => ({
                id: String(item.id || ''),
                role: item.role || 'unknown',
                text: String(item.text || ''),
                turnNumber: Number.isFinite(item.turnNumber) ? item.turnNumber : null
            }));

        GM_setValue(K_CTX_LITE, {
            room: getCurrentRoomKey(),
            records: list
        });
    }

    function clearCtxCache() {
        lastCtxSaveSig = '';
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
        /* 글자·숫자가 하나도 없는 기호뿐인 줄만 버린다.
         * (예전 /^[\s\W_]+$/는 한글을 기호로 취급해 숫자 없는 한글 메시지를 통째로 버렸다.) */
        if (!/[\p{L}\p{N}]/u.test(line)) return true;
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

    function extractTurnNumber(value) {
        const text = String(value || '');
        const matches = [];

        /* [턴7 | ...], [턴 7|...], 턴#7, 턴: 7을 모두 인식한다. */
        const pattern = /(?:^|[\n\r\[【(])\s*턴\s*(?:#|:|-)?\s*(\d{1,6})(?=\s|[|｜\]】)>,.:;!?/\\-]|$)/gim;
        let match;

        while ((match = pattern.exec(text))) {
            const number = parseInt(match[1], 10);
            if (Number.isFinite(number)) matches.push(number);
        }

        return matches.length ? Math.max(...matches) : null;
    }

    function compareContextOrder(a, b) {
        const aTurn = Number.isFinite(a && a.turnNumber) ? a.turnNumber : null;
        const bTurn = Number.isFinite(b && b.turnNumber) ? b.turnNumber : null;

        if (aTurn !== null && bTurn !== null && aTurn !== bTurn) {
            return aTurn - bTurn;
        }

        if (aTurn !== null && bTurn === null) return 1;
        if (aTurn === null && bTurn !== null) return -1;

        const aTop = Number.isFinite(a && a.top) ? a.top : 0;
        const bTop = Number.isFinite(b && b.top) ? b.top : 0;
        if (aTop !== bTop) return aTop - bTop;

        const aDom = Number.isFinite(a && a.domIndex) ? a.domIndex : -1;
        const bDom = Number.isFinite(b && b.domIndex) ? b.domIndex : -1;
        return aDom - bDom;
    }

    function pickLatestContextRecord(records) {
        const list = (Array.isArray(records) ? records : []).filter(Boolean);
        if (!list.length) return null;

        const numbered = list.filter(item => Number.isFinite(item.turnNumber));
        if (numbered.length) {
            return numbered.reduce((latest, item) => {
                if (!latest || item.turnNumber > latest.turnNumber) return item;
                if (item.turnNumber === latest.turnNumber && item.distanceToInput < latest.distanceToInput) {
                    return item;
                }
                return latest;
            }, null);
        }

        const aboveInput = list.filter(item => item.nearInput || item.distanceToInput < 2600);
        const candidates = aboveInput.length ? aboveInput : list;

        return candidates.reduce((latest, item) => {
            if (!latest) return item;
            if (item.distanceToInput < latest.distanceToInput) return item;
            if (item.distanceToInput === latest.distanceToInput && item.top > latest.top) return item;
            return latest;
        }, null);
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
            turnNumber: Number.isFinite(record.turnNumber)
                ? record.turnNumber
                : null,
            nearInput: !!record.nearInput,
            domIndex: Number.isFinite(record.domIndex) ? record.domIndex : -1,
            top: Number.isFinite(record.top) ? record.top : 0,
            bottom: Number.isFinite(record.bottom) ? record.bottom : 0,
            distanceToInput: Number.isFinite(record.distanceToInput)
                ? record.distanceToInput
                : Number.POSITIVE_INFINITY
        };
    }

    /* 버튼을 눌러 읽은 최신 맥락만 저장한다(과거→최신 순서).
     * 예전처럼 화면이 바뀔 때마다 300개를 읽고 쓰지 않는다. */
    function rememberCtxLines(records) {
        const fresh = (Array.isArray(records) ? records : [])
            .filter(item => item && typeof item.text === 'string' && item.text);
        if (!fresh.length) return;

        const sig = getCurrentRoomKey() + '|' +
            fresh.map(item => item.id + ':' + item.text.length).join(',');
        if (sig === lastCtxSaveSig) return;

        lastCtxSaveSig = sig;
        saveCtxCache(fresh);
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

    const MESSAGE_NODE_SELECTORS = [
        '[data-role="user"]', '[data-role="assistant"]',
        '[data-message-role]', '[data-author]',
        '[data-testid*="user"]', '[data-testid*="assistant"]',
        '[data-testid*="message"]', '.wrtn-markdown',
        '[class*="whitespace-pre-wrap"]', '[class*="break-words"]'
    ].join(',');

    function getBestMessageNode(group) {
        const panelSelector = '#' + PANEL_ID;
        let best = null;
        let bestScore = Number.NEGATIVE_INFINITY;

        for (const el of group.querySelectorAll(MESSAGE_NODE_SELECTORS)) {
            if (el.closest(panelSelector)) continue;
            if (el.querySelector('textarea, input, select, button')) continue;

            /* 후보마다 텍스트 정리는 딱 한 번만 한다. */
            const text = cleanContextLine(getRawNodeText(el));
            if (text.length < 1 || text.length > 12000) continue;

            let score = Math.min(text.length, 5000);
            if (el.hasAttribute('data-role')) score += 12000;
            if (el.hasAttribute('data-message-role')) score += 12000;
            if (el.hasAttribute('data-author')) score += 12000;
            if ((el.getAttribute('data-testid') || '').toLowerCase().includes('message')) score += 7000;
            if (el.classList.contains('wrtn-markdown')) score += 4000;

            /* innerText는 화면 밖 메시지까지 배치 계산을 강제하므로 쓰지 않는다. */
            let equivalentChild = false;
            for (const child of el.children) {
                const childText = cleanContextLine(getRawNodeText(child));
                if (childText && childText.length >= text.length * 0.88) {
                    equivalentChild = true;
                    break;
                }
            }
            if (equivalentChild) score -= 8000;

            if (score > bestScore) {
                bestScore = score;
                best = el;
            }
        }

        return best || group;
    }

    function formatContextMessage(role, text) {
        const label = role === 'user'
            ? '유저'
            : role === 'assistant'
                ? '상대 캐릭터'
                : '역할 미확인';
        return '[' + label + ']\n' + text;
    }

    function getRawNodeText(node) {
        if (!node) return '';

        /* 크랙은 화면 밖 메시지에 content-visibility를 사용하기 때문에
         * innerText는 일부만 반환되거나 배치 계산을 강제한다. textContent만 쓴다. */
        return String(node.textContent || '');
    }

    function getInputTop() {
        const input = findChatInput();
        return input ? input.getBoundingClientRect().top : window.innerHeight;
    }

    /* 실제 채팅 목록을 최신→과거 순서로 반환한다.
     * 크랙의 실제 구조는 다음과 같다.
     *   <div class="flex flex-col-reverse ...">
     *     <div data-message-group-id>턴 7</div>  ← DOM 첫 번째, 실제 최신
     *     <div data-message-group-id>유저</div>
     *     <div data-message-group-id>턴 6</div>
     *     ...
     * 같은 부모의 직계 자식 메시지 그룹만 골라 DOM 방향을 판정한다.
     * 성능: 턴 번호는 목록 양 끝 TURN_SAMPLE개씩만 읽는다.
     * 최신 턴은 항상 목록의 한쪽 끝에 있으므로 이것으로 충분하다. */
    function getLiveMessageGroupsNewestFirst(inputTopHint) {
        const panel = document.getElementById(PANEL_ID);

        const allGroups = Array.from(
            document.querySelectorAll('[data-message-group-id]')
        ).filter(group => {
            if (!group || !group.isConnected || !group.parentElement) return false;
            if (panel && panel.contains(group)) return false;
            return true;
        });

        if (!allGroups.length) return [];

        const turnCache = new Map();
        const turnOf = group => {
            if (!turnCache.has(group)) {
                turnCache.set(group, extractTurnNumber(getRawNodeText(group)));
            }
            return turnCache.get(group);
        };

        const readSampledTurns = groups => {
            let numbered = sampleIndexes(groups.length, TURN_SAMPLE)
                .map(index => ({
                    group: groups[index],
                    index,
                    turn: turnOf(groups[index])
                }))
                .filter(item => Number.isFinite(item.turn));

            /* 표본에서 번호를 2개 미만 찾으면 방향을 판정할 수 없으므로
             * 그때만 전체를 읽는다(드문 경우). */
            if (numbered.length < 2 && groups.length > TURN_SAMPLE * 2) {
                numbered = groups
                    .map((group, index) => ({ group, index, turn: turnOf(group) }))
                    .filter(item => Number.isFinite(item.turn));
            }

            return numbered;
        };

        let inputTop = Number.isFinite(inputTopHint) ? inputTopHint : null;
        const resolveInputTop = () => {
            if (inputTop === null) inputTop = getInputTop();
            return inputTop;
        };

        const parents = new Set(allGroups.map(group => group.parentElement));
        const candidates = [];

        for (const parent of parents) {
            /* querySelectorAll이 아니라 직계 자식만 사용한다.
             * 사이드바·숨은 복제 목록·중첩 그룹이 섞이는 것을 차단한다. */
            const groups = Array.from(parent.children || []).filter(child => {
                return child &&
                    child.nodeType === 1 &&
                    child.hasAttribute('data-message-group-id') &&
                    (!panel || !panel.contains(child));
            });

            if (groups.length < 2) continue;

            const numbered = readSampledTurns(groups);
            if (!numbered.length) continue;

            let maxItem = numbered[0];
            let minItem = numbered[0];

            for (const item of numbered) {
                if (item.turn > maxItem.turn) maxItem = item;
                if (item.turn < minItem.turn) minItem = item;
            }

            const maxRect = maxItem.group.getBoundingClientRect();

            candidates.push({
                parent,
                groups,
                maxTurn: maxItem.turn,
                minTurn: minItem.turn,
                maxIndex: maxItem.index,
                minIndex: minItem.index,
                distanceToInput: Math.abs(resolveInputTop() - maxRect.bottom)
            });
        }

        if (!candidates.length) {
            /* 구조가 바뀐 경우에만 전체 그룹을 보조값으로 쓴다. */
            const fallback = allGroups.slice();
            const numbered = readSampledTurns(fallback);

            if (numbered.length >= 2) {
                const maxItem = numbered.reduce((a, b) =>
                    !a || b.turn > a.turn ? b : a, null);
                const minItem = numbered.reduce((a, b) =>
                    !a || b.turn < a.turn ? b : a, null);
                if (maxItem.index > minItem.index) fallback.reverse();
            }

            return fallback;
        }

        /* 가장 큰 턴 번호가 있는 실제 대화 컨테이너를 우선한다.
         * 같은 턴이면 입력창에 가까운 컨테이너, 그다음 메시지가 많은 컨테이너. */
        candidates.sort((a, b) => {
            if (a.maxTurn !== b.maxTurn) return b.maxTurn - a.maxTurn;
            if (a.distanceToInput !== b.distanceToInput) {
                return a.distanceToInput - b.distanceToInput;
            }
            return b.groups.length - a.groups.length;
        });

        const picked = candidates[0];
        let groups = picked.groups.slice();

        /* 턴 번호 위치로 DOM 방향을 자동 보정한다. */
        const domIsNewestFirst = picked.maxIndex < picked.minIndex;
        if (!domIsNewestFirst) groups.reverse();

        /* 최신 턴보다 앞에 광고·시스템 그룹이 끼어 있을 경우 제거한다.
         * 최신 턴은 앞쪽 표본 범위 안에 있으므로 그 범위만 찾는다. */
        const searchLimit = Math.min(groups.length, TURN_SAMPLE * 2 + 2);
        let latestIndex = -1;

        for (let i = 0; i < searchLimit; i++) {
            if (turnOf(groups[i]) === picked.maxTurn) {
                latestIndex = i;
                break;
            }
        }

        if (latestIndex > 0) groups = groups.slice(latestIndex);

        return groups;
    }

    function recordFromMessageGroup(group, index, inputTop) {
        if (!group) return null;

        const contentEl = getBestMessageNode(group);
        const rawGroupText = getRawNodeText(group);
        const rawContentText = contentEl === group
            ? rawGroupText
            : getRawNodeText(contentEl);

        /* 최신 턴은 아직 스트리밍 중이거나 내부 후보 노드가 비어 있을 수 있다.
         * 이때 해당 턴을 통째로 버리지 말고 메시지 그룹 전체 텍스트로 복구한다. */
        let text = cleanContextLine(rawContentText);
        if (isBadContextLine(text) && contentEl !== group) {
            text = cleanContextLine(rawGroupText);
        }
        if (isBadContextLine(text)) return null;

        const baseTop = Number.isFinite(inputTop) ? inputTop : getInputTop();
        const rect = group.getBoundingClientRect();
        const rawId = group.getAttribute('data-message-group-id') || '';

        return normalizeContextRecord({
            id: rawId || ('group-' + hashContextId(text + '|' + index)),
            text,
            turnNumber: extractTurnNumber(rawGroupText) ?? extractTurnNumber(rawContentText),
            role: detectMessageRole(group, contentEl),
            top: Number.isFinite(rect.top) ? rect.top : index,
            bottom: Number.isFinite(rect.bottom) ? rect.bottom : index,
            distanceToInput: Number.isFinite(rect.bottom)
                ? Math.abs(baseTop - rect.bottom)
                : Number.POSITIVE_INFINITY,
            domIndex: index,
            nearInput: true
        });
    }

    /* 최신 메시지부터 필요한 만큼만 읽는다.
     * turnCount개의 턴과 minRecords개의 메시지를 모으면 즉시 멈춘다. */
    function scanRecentRecords(turnCount, minRecords) {
        const wantTurns = clamp(parseInt(turnCount, 10) || 6, 1, CTX_MAX_TURNS);
        const wantRecords = Math.max(1, parseInt(minRecords, 10) || 1);
        const inputTop = getInputTop();
        const groups = getLiveMessageGroupsNewestFirst(inputTop);
        const cap = Math.min(groups.length, wantTurns * 4 + 12);
        const records = [];
        const seenTurns = new Set();

        for (let i = 0; i < cap; i++) {
            const record = recordFromMessageGroup(groups[i], i, inputTop);
            if (!record) continue;

            records.push(record);

            if (Number.isFinite(record.turnNumber)) {
                seenTurns.add(record.turnNumber);
            }

            if (seenTurns.size >= wantTurns && records.length >= wantRecords) break;
        }

        /* records는 최신→과거 순서 */
        return { groups, records, inputTop };
    }

    function inferMissingRoles(entries) {
        const hasKnownRole = entries.some(item => item.role !== 'unknown');
        if (!hasKnownRole && entries.length) {
            let role = 'assistant';
            for (let i = entries.length - 1; i >= 0; i--) {
                entries[i].role = role;
                role = role === 'assistant' ? 'user' : 'assistant';
            }
            return entries;
        }

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

        return entries;
    }

    /* 메시지 그룹 구조를 못 찾았을 때만 쓰는 보조 경로.
     * .wrtn-markdown 노드를 양 끝 일부만 읽어 과거→최신으로 정렬한다. */
    function collectVisibleChatLines() {
        const panelSelector = '#' + PANEL_ID;
        const nodes = document.querySelectorAll('.wrtn-markdown');

        const entries = sampleIndexes(nodes.length, 30)
            .map(index => {
                const el = nodes[index];
                if (!el || el.closest(panelSelector)) return null;

                const text = cleanContextLine(getRawNodeText(el));
                if (isBadContextLine(text)) return null;

                const owner = el.closest('[data-message-group-id]') || el.parentElement;
                const rect = el.getBoundingClientRect();

                return normalizeContextRecord({
                    id: 'markdown-' + hashContextId(text),
                    text,
                    turnNumber: extractTurnNumber(owner ? getRawNodeText(owner) : text),
                    role: detectMessageRole(el.parentElement || el, el),
                    top: Number.isFinite(rect.top) ? rect.top : index,
                    bottom: Number.isFinite(rect.bottom) ? rect.bottom : index,
                    distanceToInput: Number.POSITIVE_INFINITY,
                    domIndex: index,
                    nearInput: true
                });
            })
            .filter(Boolean);

        entries.sort(compareContextOrder);
        return inferMissingRoles(entries);
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

        const next = merged.slice(-STORY_BOOTSTRAP_LIMIT);
        const changed =
            next.length !== old.length ||
            next.some((text, index) => text !== old[index]);

        /* 내용이 바뀌었을 때만 저장소에 쓴다. */
        if (changed) GM_setValue(key, next);
    }

    /* 채팅 턴이 하나라도 있는지 양 끝 일부만 보고 판단한다. */
    function hasAnyChatTurn() {
        const groups = document.querySelectorAll('[data-message-group-id]');
        if (!groups.length) return false;

        for (const index of sampleIndexes(groups.length, 6)) {
            if (Number.isFinite(extractTurnNumber(getRawNodeText(groups[index])))) {
                return true;
            }
        }

        return false;
    }

    function collectStoryBootstrap() {
        if (!getStoryId()) return [];

        /* 채팅 턴이 이미 존재하면 시작 카드 수집을 중단한다.
         * 사이드바의 채팅방 설정/유저 노트 같은 UI가 시작 상황으로 섞이는 것을 막는다. */
        if (hasAnyChatTurn()) return getStoryBootstrap();

        const panel = document.getElementById(PANEL_ID);
        const found = [];

        const selectors = [
            '#story-detail-scroll .wrtn-markdown',
            '[data-testid*="prologue"] .wrtn-markdown',
            '[data-testid*="scenario"] .wrtn-markdown',
            '[data-testid*="play-guide"] .wrtn-markdown',
            '[class*="prologue"] .wrtn-markdown',
            '[class*="scenario"] .wrtn-markdown',
            '[class*="play-guide"] .wrtn-markdown'
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

                const text = cleanContextLine(getRawNodeText(el));
                if (text.length < 20 || text.length > 14000 || isBadContextLine(text)) continue;
                if (/채팅방 설정|플레이 가이드|대화 프로필|유저 노트|키보드 단축키|전체 설정|업데이트 정보|시작설정|기본 설정|나의 크래커/.test(text)) continue;
                found.push(text);
            }
        }

        saveStoryBootstrap(found);
        return getStoryBootstrap();
    }

    /* 첫 턴 전(프롤로그만 있는 상태)에만 가볍게 지켜보고,
     * 채팅 턴이 생기면 즉시 감시를 끈다. 긴 채팅에서는 아예 돌지 않는다. */
    function stopBootstrapWatch() {
        if (bootstrapObserver) {
            bootstrapObserver.disconnect();
            bootstrapObserver = null;
        }
        if (bootstrapTimer) {
            clearTimeout(bootstrapTimer);
            bootstrapTimer = null;
        }
    }

    function watchStoryBootstrap() {
        stopBootstrapWatch();

        if (!getStoryId() || hasAnyChatTurn()) return;

        collectStoryBootstrap();

        bootstrapObserver = new MutationObserver(() => {
            if (bootstrapTimer) return;

            bootstrapTimer = setTimeout(() => {
                bootstrapTimer = null;

                if (!getStoryId() || hasAnyChatTurn()) {
                    stopBootstrapWatch();
                    return;
                }

                collectStoryBootstrap();
            }, 1500);
        });

        bootstrapObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function deriveContextRecords(newestFirst, maxN) {
        const n = clamp(parseInt(maxN, 10) || 6, 1, CTX_MAX_TURNS);
        const picked = [];
        const seenTurns = new Set();

        /* 설정값은 메시지 개수가 아니라 실제 턴 개수다.
         * 최신 턴부터 세어 n개 턴이 포함될 때까지 유저 메시지도 함께 담는다. */
        for (const item of newestFirst) {
            picked.push(item);

            if (Number.isFinite(item.turnNumber)) {
                seenTurns.add(item.turnNumber);
                if (seenTurns.size >= n) break;
            }
        }

        /* 번호가 없는 구조에서는 메시지 n개를 사용한다. */
        const recentNewestFirst = seenTurns.size
            ? picked
            : newestFirst.slice(0, n);

        return recentNewestFirst.slice().reverse();
    }

    function getRecentContextRecords(maxN, scan) {
        const n = clamp(parseInt(maxN, 10) || 6, 1, CTX_MAX_TURNS);
        const result = scan || scanRecentRecords(n, 3);

        if (result.records.length) {
            const recent = deriveContextRecords(result.records, n);
            rememberCtxLines(recent);
            return recent;
        }

        /* 화면 DOM을 못 잡았을 때만 저장된 최근 맥락을 사용한다. */
        return getCtxCache().slice(-n);
    }

    function getUnifiedContext(maxN, scan) {
        const records = getRecentContextRecords(maxN, scan);
        const hasNumberedChat = records.some(item => Number.isFinite(item.turnNumber));
        const recent = records.map(item => formatContextMessage(item.role, item.text));

        if (hasNumberedChat) return recent;

        collectStoryBootstrap();
        const story = getStoryBootstrap()
            .slice(-2)
            .map(text => '[시작 상황/플레이 가이드]\n' + text);

        return [...story, ...recent];
    }

    function collectChatContext(maxN, scan) {
        return getUnifiedContext(maxN, scan);
    }

    function collectLatestSceneSnapshot(scan) {
        const result = scan || scanRecentRecords(1, 3);
        const newestFirst = result.records;

        /* DOM 첫 항목을 무조건 믿지 않는다.
         * 읽은 레코드 중 가장 큰 턴 번호를 직전 턴으로 고정한다. */
        const directLatest = pickLatestContextRecord(newestFirst);

        if (directLatest) {
            const latestIndex = newestFirst.findIndex(item =>
                item === directLatest ||
                (item.id && directLatest.id && item.id === directLatest.id)
            );
            const start = latestIndex >= 0 ? latestIndex : 0;
            const nearby = newestFirst
                .slice(start, start + 3)
                .reverse()
                .map(item => formatContextMessage(item.role, item.text))
                .join('\n\n');

            return {
                text: directLatest.text || '',
                nearby,
                source: Number.isFinite(directLatest.turnNumber)
                    ? '감지된 최대 턴 번호 · 턴 ' + directLatest.turnNumber
                    : '현재 채팅에서 가장 최신 메시지',
                role: directLatest.role || 'unknown',
                id: directLatest.id || '',
                turnNumber: directLatest.turnNumber
            };
        }

        const visible = collectVisibleChatLines();
        if (visible.length) {
            const picked = visible[visible.length - 1];
            return {
                text: picked.text || '',
                nearby: visible
                    .slice(-3)
                    .map(item => formatContextMessage(item.role, item.text))
                    .join('\n\n'),
                source: '현재 DOM 최종 메시지 보조 판정',
                role: picked.role || 'unknown',
                id: picked.id || '',
                turnNumber: picked.turnNumber
            };
        }

        const story = getStoryBootstrap();
        if (story.length) {
            return {
                text: story[story.length - 1],
                nearby: '',
                source: '첫 시작 장면',
                role: 'assistant',
                id: '',
                turnNumber: null
            };
        }

        return { text: '', nearby: '', source: '판별 실패', role: 'unknown', id: '', turnNumber: null };
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

    /* =========================
     * 크랙 서버에서 대화 불러오기 (정확한 턴 수, 최신부터 역순)
     * ========================= */
    function getCrackChatId() {
        const match = (location.pathname || '').match(/\/episodes\/([A-Za-z0-9_-]+)/);
        return match ? match[1] : '';
    }

    function getCrackToken() {
        const match = String(document.cookie || '').match(/(?:^|;\s*)access_token=([^;]+)/);
        return match ? match[1] : '';
    }

    function crackApiGet(path) {
        const token = getCrackToken();
        const chatId = getCrackChatId();

        if (!token || !chatId) {
            return Promise.reject(new Error('크랙 로그인 정보나 채팅방 주소를 찾지 못했어요.'));
        }

        const url = CRACK_API_BASE + '/' + encodeURIComponent(chatId) + path;
        const headers = {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
        };

        /* 페이지 fetch가 막히는 환경(일부 모바일 확장)에서는 GM 요청으로 한 번 더 시도한다. */
        const viaGM = () => new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                reject(new Error('크랙 서버에 연결하지 못했어요.'));
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url,
                headers,
                timeout: 20000,
                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(new Error('크랙 서버 오류 (' + response.status + ')'));
                        return;
                    }
                    try {
                        resolve(JSON.parse(response.responseText || '{}'));
                    } catch (_) {
                        reject(new Error('크랙 서버 응답을 읽지 못했어요.'));
                    }
                },
                onerror() {
                    reject(new Error('크랙 서버 네트워크 오류예요.'));
                },
                ontimeout() {
                    reject(new Error('크랙 서버 응답 시간이 초과됐어요.'));
                }
            });
        });

        if (typeof fetch !== 'function') return viaGM();

        return fetch(url, { method: 'GET', headers })
            .then(async response => {
                const raw = await response.text();
                if (!response.ok) {
                    const error = new Error('크랙 서버 오류 (' + response.status + ')');
                    error.httpStatus = response.status;
                    throw error;
                }
                return raw ? JSON.parse(raw) : {};
            })
            .catch(error => {
                if (error && error.httpStatus) throw error;
                return viaGM();
            });
    }

    function crackMessageId(message) {
        return String((message && (message.id || message._id || message.messageId)) || '');
    }

    function crackMessageTime(message) {
        const raw = message && (
            message.createdAt || message.created_at || message.timestamp || message.sentAt
        ) || '';
        const value = Date.parse(raw);
        return Number.isFinite(value) ? value : 0;
    }

    function crackRole(message) {
        const role = String(message && message.role || '').toLowerCase();
        if (role === 'user' || role === 'human') return 'user';
        if (role === 'system') return 'system';
        return 'assistant';
    }

    function dedupeCrackMessages(list) {
        const out = [];
        const seen = new Set();

        for (const message of list) {
            if (!message) continue;
            const key = crackMessageId(message) || [
                message.role || '',
                message.createdAt || message.created_at || '',
                String(message.content || '').slice(0, 200)
            ].join('::');

            if (seen.has(key)) continue;
            seen.add(key);
            out.push(message);
        }

        return out;
    }

    /* 크랙 API는 최신 → 과거 순으로 준다. 시간 정보가 충분하면 시간순으로,
     * 아니면 받은 순서를 뒤집어 과거 → 최신으로 맞춘다. */
    function orderCrackMessages(list) {
        const unique = dedupeCrackMessages(list);
        const timed = unique.filter(message => crackMessageTime(message) > 0).length;

        if (timed >= Math.max(2, Math.floor(unique.length * 0.6))) {
            return unique
                .map((message, index) => ({ message, index }))
                .sort((a, b) =>
                    (crackMessageTime(a.message) - crackMessageTime(b.message)) ||
                    (b.index - a.index)
                )
                .map(item => item.message);
        }

        return unique.reverse();
    }

    /* 최신 페이지부터 거꾸로 넘기며 필요한 만큼만 가져온다.
     * turns: 필요한 유저 턴 수(0 = 전체), stopAtId: 이 메시지를 만나면 멈춤. */
    async function fetchCrackMessages(options) {
        const wantTurns = Math.max(0, parseInt(options && options.turns, 10) || 0);
        const stopAtId = String(options && options.stopAtId || '');
        const all = [];
        let cursor = null;

        for (let page = 0; page < 400; page++) {
            let path = '/messages?limit=50';
            if (cursor) path += '&cursor=' + encodeURIComponent(cursor);

            const response = await crackApiGet(path);
            const data = response && response.data;
            const list = data && Array.isArray(data.messages) ? data.messages : [];
            if (!list.length) break;

            all.push(...list);

            if (stopAtId && list.some(message => crackMessageId(message) === stopAtId)) break;

            if (wantTurns > 0) {
                const users = dedupeCrackMessages(all)
                    .filter(message => crackRole(message) === 'user').length;
                /* 요청 턴보다 하나 더 모이면 멈춘다.
                 * 첫 턴 바로 앞의 캐릭터 메시지(상황)까지 확보하기 위해서다. */
                if (users > wantTurns) break;
            }

            if (data.hasNext && data.nextCursor) cursor = data.nextCursor;
            else break;
        }

        return orderCrackMessages(all).filter(message => crackRole(message) !== 'system');
    }

    function crackMessagesToRecords(messages) {
        const records = [];

        messages.forEach((message, index) => {
            const raw = String(message.content || message.text || message.message || '');
            const record = normalizeContextRecord({
                id: crackMessageId(message) || ('api-' + hashContextId(raw + '|' + index)),
                role: crackRole(message),
                text: raw.length > 11000 ? raw.slice(-11000) : raw,
                turnNumber: extractTurnNumber(raw),
                domIndex: index,
                nearInput: true
            });
            if (record) records.push(record);
        });

        return records;
    }

    /* 과거→최신 목록에서 마지막 유저 메시지 N개(=N턴)를 정확히 자른다.
     * 첫 턴 바로 앞이 캐릭터 메시지면 상황 파악용으로 함께 넣는다. */
    function sliceLatestTurns(records, turns) {
        if (!turns) return records.slice();

        let found = 0;
        let start = 0;

        for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].role === 'user') {
                found++;
                if (found === turns) {
                    start = i;
                    break;
                }
            }
        }

        if (found < turns) start = 0;
        if (start > 0 && records[start - 1].role !== 'user') start--;
        return records.slice(start);
    }

    function countRecordTurns(records) {
        const users = records.filter(item => item.role === 'user').length;
        if (users) return users;
        const numbered = new Set(
            records.map(item => item.turnNumber).filter(Number.isFinite)
        ).size;
        return numbered || Math.ceil(records.length / 2);
    }

    /* 미리보기용 라벨: 최신 턴부터 거꾸로 센다. */
    function turnAgoLabels(records) {
        const labels = new Array(records.length).fill('');
        const totalUsers = records.filter(item => item.role === 'user').length;
        let turn = 1;

        for (let i = records.length - 1; i >= 0; i--) {
            const item = records[i];
            if (Number.isFinite(item.turnNumber)) labels[i] = '턴 ' + item.turnNumber;
            else if (!totalUsers) labels[i] = '';
            else if (turn > totalUsers) labels[i] = '앞 장면';
            else labels[i] = '최근 ' + turn + '번째 턴';

            if (item.role === 'user') turn++;
        }

        return labels;
    }

    function snapshotFromRecords(records, sourceLabel) {
        for (let i = records.length - 1; i >= 0; i--) {
            if (records[i].role !== 'assistant') continue;

            const latest = records[i];
            return {
                text: latest.text,
                nearby: records
                    .slice(Math.max(0, i - 2), i + 1)
                    .map(item => formatContextMessage(item.role, item.text))
                    .join('\n\n'),
                source: sourceLabel +
                    (Number.isFinite(latest.turnNumber) ? ' · 턴 ' + latest.turnNumber : ''),
                role: 'assistant',
                id: latest.id,
                turnNumber: latest.turnNumber
            };
        }

        return null;
    }

    /* 문장 부풀리기 / 미리보기 / 페르소나 추천이 함께 쓰는 대화 불러오기.
     * 1순위 크랙 서버(정확한 턴 수), 실패하면 화면 읽기. */
    async function loadRecentChat(turnCount) {
        const n = clamp(parseInt(turnCount, 10) || 6, 1, CTX_MAX_TURNS);
        let apiError = '';

        if (getCrackChatId() && getCrackToken()) {
            try {
                const ordered = await fetchCrackMessages({ turns: n });
                const records = sliceLatestTurns(crackMessagesToRecords(ordered), n);
                const snapshot = snapshotFromRecords(records, '크랙 서버의 최신 캐릭터 메시지');

                if (records.length && snapshot) {
                    return {
                        source: 'api',
                        requested: n,
                        actualTurns: records.filter(item => item.role === 'user').length,
                        records,
                        context: records.map(item => formatContextMessage(item.role, item.text)),
                        snapshot
                    };
                }

                apiError = '서버에 캐릭터 메시지가 없음';
            } catch (error) {
                apiError = error && error.message ? error.message : String(error);
            }
        } else {
            apiError = '크랙 로그인 정보나 채팅방 주소를 찾지 못함';
        }

        const scan = scanRecentRecords(n, 3);
        const records = getRecentContextRecords(n, scan);
        const context = getUnifiedContext(n, scan);
        const snapshot = collectLatestSceneSnapshot(scan);
        const numberedTurns = new Set(
            records.map(item => item.turnNumber).filter(Number.isFinite)
        ).size;

        return {
            source: 'dom',
            requested: n,
            actualTurns: numberedTurns || records.filter(item => item.role === 'user').length,
            records,
            context,
            snapshot,
            apiError,
            scan
        };
    }

    /* =========================
     * 장기기억 (채팅방별)
     * - relationships: 관계와 최근 변화
     * - userState: 내 캐릭터의 현재 상태(페르소나와 달라진 점)
     * - todos: 해야 할 일 (시킨 사람, 기한, 완료 여부)
     * - events: 있었던 일
     * ========================= */
    function getMemoryKey() {
        return K_MEM_BASE + '::' + (getCrackChatId() || getCurrentRoomKey());
    }

    function cleanMemText(value, max) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, max || 300);
    }

    function memKey(value) {
        return String(value || '').replace(/[\s.,!?·~'"“”‘’()\[\]-]+/g, '').toLowerCase();
    }

    function emptyMemory() {
        return {
            v: 1,
            updatedAt: '',
            lastMessageId: '',
            processedTurns: 0,
            relationships: [],
            userState: [],
            todos: [],
            events: []
        };
    }

    function sanitizeMemory(raw) {
        const mem = emptyMemory();
        if (!raw || typeof raw !== 'object') return mem;

        mem.updatedAt = cleanMemText(raw.updatedAt, 60);
        mem.lastMessageId = String(raw.lastMessageId || '');
        mem.processedTurns = Math.max(0, parseInt(raw.processedTurns, 10) || 0);

        const relationships = new Map();
        (Array.isArray(raw.relationships) ? raw.relationships : []).forEach(item => {
            if (!item || typeof item !== 'object') return;
            const name = cleanMemText(item.name, 40);
            if (!name) return;
            relationships.delete(memKey(name));
            relationships.set(memKey(name), {
                name,
                relation: cleanMemText(item.relation, 120),
                change: cleanMemText(item.change, 200)
            });
        });
        mem.relationships = Array.from(relationships.values()).slice(-MEM_LIMITS.relationships);

        const states = [];
        const stateKeys = new Set();
        (Array.isArray(raw.userState) ? raw.userState : []).forEach(item => {
            const text = cleanMemText(
                typeof item === 'string' ? item : item && item.text,
                200
            );
            if (!text || stateKeys.has(memKey(text))) return;
            stateKeys.add(memKey(text));
            states.push(text);
        });
        mem.userState = states.slice(-MEM_LIMITS.userState);

        const todos = new Map();
        (Array.isArray(raw.todos) ? raw.todos : []).forEach(item => {
            if (!item) return;
            const isText = typeof item === 'string';
            const text = cleanMemText(isText ? item : item.text, 200);
            if (!text) return;
            todos.set(memKey(text), {
                text,
                from: isText ? '' : cleanMemText(item.from, 40),
                due: isText ? '' : cleanMemText(item.due, 60),
                done: isText ? false : !!item.done
            });
        });
        const todoList = Array.from(todos.values());
        const openTodos = todoList.filter(item => !item.done).slice(-MEM_LIMITS.todosOpen);
        const doneTodos = todoList.filter(item => item.done).slice(-MEM_LIMITS.todosDone);
        const keep = new Set([...openTodos, ...doneTodos]);
        mem.todos = todoList.filter(item => keep.has(item));

        mem.events = (Array.isArray(raw.events) ? raw.events : [])
            .map(item => item && typeof item === 'object'
                ? {
                    title: cleanMemText(item.title, 40),
                    summary: cleanMemText(item.summary, 400)
                }
                : null)
            .filter(item => item && (item.title || item.summary))
            .slice(-MEM_LIMITS.events);

        return mem;
    }

    function getMemory() {
        return sanitizeMemory(GM_getValue(getMemoryKey(), null));
    }

    function saveMemory(mem) {
        GM_setValue(getMemoryKey(), sanitizeMemory(mem));
    }

    function clearMemory() {
        if (typeof GM_deleteValue === 'function') {
            try {
                GM_deleteValue(getMemoryKey());
                return;
            } catch (_) {}
        }
        GM_setValue(getMemoryKey(), emptyMemory());
    }

    function pickMemoryEvents(events, sceneText) {
        const list = Array.isArray(events) ? events : [];
        if (list.length <= MEM_PROMPT_RECENT_EVENTS) return list.slice();

        const recentStart = list.length - MEM_PROMPT_RECENT_EVENTS;
        const keywords = extractSceneKeywords(sceneText);
        const related = [];

        if (keywords.length) {
            for (let i = 0; i < recentStart; i++) {
                const haystack = list[i].title + ' ' + list[i].summary;
                const hits = keywords.filter(word => haystack.includes(word)).length;
                if (hits) related.push({ index: i, hits });
            }
        }

        const picked = related
            .sort((a, b) => (b.hits - a.hits) || (b.index - a.index))
            .slice(0, MEM_PROMPT_RELATED_EVENTS)
            .map(item => item.index)
            .sort((a, b) => a - b);

        return [...picked.map(index => list[index]), ...list.slice(recentStart)];
    }

    /* 프롬프트에 넣을 장기기억 블록. 오래된 사건은 지금 장면과 관련된 것만 골라 넣는다. */
    function memoryToPrompt(mem, sceneText) {
        if (!mem) return '';

        const lines = [];

        if (mem.relationships.length) {
            lines.push('(현재 관계)');
            mem.relationships.forEach(item => {
                lines.push(
                    '- ' + item.name + ': ' + (item.relation || '관계 미정') +
                    (item.change ? ' / 최근 변화: ' + item.change : '')
                );
            });
        }

        if (mem.userState.length) {
            lines.push('(유저 캐릭터의 현재 상태 · 기본 페르소나보다 우선)');
            mem.userState.forEach(item => lines.push('- ' + item));
        }

        const openTodos = mem.todos.filter(item => !item.done);
        if (openTodos.length) {
            lines.push('(유저 캐릭터가 아직 하지 않은 할 일)');
            openTodos.forEach(item => {
                lines.push(
                    '- ' + item.text +
                    (item.from ? ' (시킨 사람: ' + item.from + ')' : '') +
                    (item.due ? ' (기한: ' + item.due + ')' : '')
                );
            });
        }

        const events = pickMemoryEvents(mem.events, sceneText);
        if (events.length) {
            lines.push('(있었던 일 · 위가 과거, 아래가 최근)');
            events.forEach(item => {
                lines.push('- ' + (item.title ? '[' + item.title + '] ' : '') + item.summary);
            });
        }

        return lines.join('\n');
    }

    function buildMemoryPrompt(mem, chunkRecords, chunkIndex, chunkTotal) {
        const name = String(GM_getValue(K_NAME, '') || '').trim();
        const persona = getActivePersona();

        const system = [
            '너는 롤플레이 캐릭터 채팅의 장기기억 정리 담당이다.',
            '[기존 기억]과 [새 대화 로그]를 읽고, 유저 캐릭터 입장에서 기억을 갱신한 JSON 하나만 출력한다.',
            '',
            '[누가 유저인가]',
            '- [유저] 메시지는 유저 캐릭터' + (name ? '(이름: ' + name + ')' : '') + '의 말과 행동이다.',
            '- [캐릭터] 메시지는 상대 캐릭터·NPC·내레이터의 출력이다.',
            persona ? '- 유저 캐릭터 기본 설정:\n' + persona.slice(0, 1500) : '',
            '',
            '[relationships] 유저 캐릭터와 다른 인물의 현재 관계 전체 목록',
            '- name: 인물 이름. 기존 인물은 이름을 글자 그대로 유지한다.',
            '- relation: 지금 시점의 관계를 짧게 현재형으로. 예: "조금 의지하기 시작한 직장 상사"',
            '- change: 가장 최근 관계 변화와 그 계기 한 줄. 이번 로그에 변화가 없으면 기존 값을 그대로 둔다.',
            '- 로그에 근거한 변화만 반영한다. 새 인물은 유저와 의미 있는 상호작용이 있을 때만 추가한다.',
            '',
            '[userState] 유저 캐릭터의 현재 상태 중 기본 설정과 달라졌거나 새로 생긴 사실',
            '- 부상, 소지품, 직책, 거처, 소속, 외모 변화, 알게 된 비밀, 남에게 숨기고 있는 것 등. 각 1문장.',
            '- 해소되었거나 더 이상 사실이 아닌 상태는 목록에서 뺀다.',
            '',
            '[todos] 유저 캐릭터가 해야 할 일',
            '- 다른 인물의 지시·부탁·명령, 유저가 한 약속, 유저가 스스로 정한 목표를 모두 포함한다.',
            '- text: 할 일 한 문장. 기존 할 일은 text를 글자 그대로 유지한다.',
            '- from: 시킨 사람(스스로 정했으면 ""), due: 언급된 기한(없으면 "").',
            '- done: 로그에서 완료가 확인되거나 취소·무효가 되면 true. 기존 할 일을 목록에서 빼지 말고 done으로 표시한다.',
            '',
            '[newEvents] 새 대화 로그 안에서 일어난 중요한 사건만 시간순으로 새로 작성',
            '- 기존 기억에 이미 있는 사건은 다시 쓰지 않는다.',
            '- 장소, 시간대, 주요 인물 구성이 바뀌면 사건을 나눈다.',
            '- title: 공백 포함 20자 이내. 관련 인물명과 핵심 소재. 유저 이름은 빼고 조사는 피한다.',
            '- summary: 200자 이내 요약체(~함). 행동 → 상대 반응 → 변화의 인과를 쓰고, 대명사 대신 이름을 쓴다.',
            '- 결정적 약속, 거짓말, 숨긴 것, 받은 물건, 중요한 대사는 짧게 보존한다.',
            '- 사소한 잡담은 생략한다. 로그에 없는 사실이나 의도를 만들지 않는다.',
            '',
            '[출력 형식 — 설명 없이 JSON만]',
            '{"relationships":[{"name":"","relation":"","change":""}],' +
                '"userState":[""],' +
                '"todos":[{"text":"","from":"","due":"","done":false}],' +
                '"newEvents":[{"title":"","summary":""}]}',
            '- 모든 값은 한국어로 쓴다.'
        ].filter(line => line !== null).join('\n');

        const oldMemory = {
            relationships: mem.relationships,
            userState: mem.userState,
            todos: mem.todos,
            recentEvents: mem.events.slice(-8)
        };

        const log = chunkRecords.map(item => {
            const label = item.role === 'user'
                ? '유저'
                : item.role === 'assistant'
                    ? '캐릭터'
                    : '역할 미확인';
            return '[' + label + ']\n' + item.text;
        }).join('\n\n');

        const user = [
            chunkTotal > 1 ? '[진행] 전체 ' + chunkTotal + '구간 중 ' + chunkIndex + '번째 구간' : '',
            '[기존 기억]',
            JSON.stringify(oldMemory, null, 1),
            '',
            '[새 대화 로그 — 위가 과거, 아래가 최신]',
            log,
            '',
            '새 대화 로그를 반영해 갱신된 기억을 지정한 JSON 형식으로만 출력해.'
        ].filter(Boolean).join('\n');

        return { system, user };
    }

    function parseJsonLoose(text) {
        const source = String(text || '')
            .replace(/^\s*```(?:json)?\s*/i, '')
            .replace(/\s*```\s*$/, '')
            .trim();

        try {
            return JSON.parse(source);
        } catch (_) {}

        const start = source.indexOf('{');
        const end = source.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(source.slice(start, end + 1));
            } catch (_) {}
        }

        throw new Error('기억 정리 결과(JSON)를 읽지 못했어요.');
    }

    /* 모델이 목록 일부를 빠뜨려도 기존 기억이 사라지지 않도록 합친다. */
    function applyMemoryUpdate(memInput, out) {
        const mem = sanitizeMemory(memInput);
        if (!out || typeof out !== 'object') return mem;

        if (Array.isArray(out.relationships)) {
            const merged = new Map(mem.relationships.map(item => [memKey(item.name), item]));
            sanitizeMemory({ relationships: out.relationships }).relationships.forEach(item => {
                const key = memKey(item.name);
                const old = merged.get(key);
                merged.delete(key);
                merged.set(key, {
                    name: item.name,
                    relation: item.relation || (old && old.relation) || '',
                    change: item.change || (old && old.change) || ''
                });
            });
            mem.relationships = Array.from(merged.values());
        }

        if (Array.isArray(out.userState)) {
            const states = sanitizeMemory({ userState: out.userState }).userState;
            if (states.length || !mem.userState.length) mem.userState = states;
        }

        if (Array.isArray(out.todos)) {
            const merged = new Map(mem.todos.map(item => [memKey(item.text), item]));
            sanitizeMemory({ todos: out.todos }).todos.forEach(item => {
                const key = memKey(item.text);
                const old = merged.get(key);
                merged.set(key, {
                    text: item.text,
                    from: item.from || (old && old.from) || '',
                    due: item.due || (old && old.due) || '',
                    done: !!item.done
                });
            });
            mem.todos = Array.from(merged.values());
        }

        const newEvents = Array.isArray(out.newEvents)
            ? out.newEvents
            : Array.isArray(out.events) ? out.events : [];
        const recentKeys = new Set(mem.events.slice(-20).map(item => memKey(item.title + item.summary)));

        sanitizeMemory({ events: newEvents }).events.forEach(item => {
            const key = memKey(item.title + item.summary);
            if (recentKeys.has(key)) return;
            recentKeys.add(key);
            mem.events.push(item);
        });

        return sanitizeMemory(mem);
    }

    function splitRecordsByTurns(records, maxTurns) {
        const hasUsers = records.some(item => item.role === 'user');
        const chunks = [];
        let current = [];
        let turns = 0;

        for (const item of records) {
            const startsTurn = hasUsers ? item.role === 'user' : current.length >= maxTurns * 2;
            if (startsTurn && (hasUsers ? turns >= maxTurns : true) && current.length) {
                chunks.push(current);
                current = [];
                turns = 0;
            }
            current.push(item);
            if (item.role === 'user') turns++;
        }

        if (current.length) chunks.push(current);
        return chunks;
    }

    async function loadMessagesForMemory(capTurns, stopAtId) {
        if (getCrackChatId() && getCrackToken()) {
            try {
                const ordered = await fetchCrackMessages({ turns: capTurns, stopAtId });
                const records = crackMessagesToRecords(ordered);
                if (records.length) return { source: 'api', records };
            } catch (_) {}
        }

        const turns = Math.min(capTurns || CTX_MAX_TURNS, CTX_MAX_TURNS);
        const scan = scanRecentRecords(turns, 1);
        return { source: 'dom', records: scan.records.slice().reverse() };
    }

    function requestGeminiAsync(system, user, label, options) {
        return new Promise((resolve, reject) => {
            requestGemini(
                system,
                user,
                label,
                (text, cost) => resolve({ text, cost }),
                error => reject(new Error(error)),
                options
            );
        });
    }

    /* mode: 'auto' | 'manual' | 'rebuild' */
    async function runMemoryUpdate(mode, options, onProgress) {
        if (memoryBusy) throw new Error('이미 기억을 정리하는 중이에요.');
        memoryBusy = true;

        try {
            const roomKey = getMemoryKey();
            let mem = mode === 'rebuild' ? emptyMemory() : getMemory();
            const every = clamp(parseInt(GM_getValue(K_MEM_EVERY, 5), 10) || 5, 1, 50);
            let records;

            if (mode === 'rebuild') {
                const turns = Math.max(0, parseInt(options && options.turns, 10) || 0);
                const loaded = await loadMessagesForMemory(turns, '');
                records = turns ? sliceLatestTurns(loaded.records, turns) : loaded.records;
            } else {
                const cap = mode === 'auto' ? MEM_AUTO_MAX_TURNS : MEM_MANUAL_MAX_TURNS;
                const loaded = await loadMessagesForMemory(cap, mem.lastMessageId);
                const all = loaded.records;
                const lastIndex = mem.lastMessageId
                    ? all.findIndex(item => item.id === mem.lastMessageId)
                    : -1;

                if (lastIndex >= 0) {
                    records = all.slice(lastIndex + 1);
                } else {
                    records = sliceLatestTurns(all, mem.lastMessageId ? cap : MEM_FIRST_TURNS);
                }

                const pending = countRecordTurns(records);
                if (!records.length || (mode === 'auto' && pending < every)) {
                    return { skipped: true, pendingTurns: records.length ? pending : 0, mem };
                }
            }

            if (!records.length) return { skipped: true, pendingTurns: 0, mem };

            const chunks = splitRecordsByTurns(records, MEM_CHUNK_TURNS);
            let lastCost = null;

            for (let i = 0; i < chunks.length; i++) {
                if (typeof onProgress === 'function') onProgress(i + 1, chunks.length);

                const prompt = buildMemoryPrompt(mem, chunks[i], i + 1, chunks.length);
                const result = await requestGeminiAsync(
                    prompt.system,
                    prompt.user,
                    mode === 'rebuild' ? '장기기억 다시 만들기' : '장기기억 정리',
                    { json: true }
                );

                /* 정리 도중 다른 채팅방으로 옮겼으면 엉뚱한 방에 저장하지 않는다. */
                if (getMemoryKey() !== roomKey) {
                    throw new Error('채팅방이 바뀌어서 정리를 멈췄어요.');
                }

                mem = applyMemoryUpdate(mem, parseJsonLoose(result.text));
                mem.lastMessageId = chunks[i][chunks[i].length - 1].id;
                mem.processedTurns += countRecordTurns(chunks[i]);
                mem.updatedAt = new Date().toLocaleString('ko-KR');
                saveMemory(mem);
                lastCost = result.cost || lastCost;
            }

            return { skipped: false, chunks: chunks.length, mem, cost: lastCost };
        } finally {
            memoryBusy = false;
        }
    }

    /* 직접 편집용 텍스트 형식 */
    function memoryToEditText(mem) {
        const lines = ['# 관계 (이름 | 지금 관계 | 최근 변화)'];
        mem.relationships.forEach(item => {
            lines.push('- ' + [item.name, item.relation, item.change].join(' | '));
        });

        lines.push('', '# 내 상태 (기본 설정과 달라진 점)');
        mem.userState.forEach(item => lines.push('- ' + item));

        lines.push('', '# 할 일 ([ ] 안 함 · [x] 완료 · 할 일 | 시킨 사람 | 기한)');
        mem.todos.forEach(item => {
            lines.push(
                '- [' + (item.done ? 'x' : ' ') + '] ' +
                [item.text, item.from, item.due].join(' | ').replace(/(\s\|\s)+$/, '')
            );
        });

        lines.push('', '# 있었던 일 ([제목] 내용 · 위가 과거)');
        mem.events.forEach(item => {
            lines.push('- ' + (item.title ? '[' + item.title + '] ' : '') + item.summary);
        });

        return lines.join('\n');
    }

    function editTextToMemory(text, base) {
        const mem = sanitizeMemory(base);
        const out = { relationships: [], userState: [], todos: [], events: [] };
        let section = '';

        String(text || '').split('\n').forEach(rawLine => {
            const line = rawLine.trim();
            if (!line) return;

            if (line.startsWith('#')) {
                if (/관계/.test(line)) section = 'rel';
                else if (/상태/.test(line)) section = 'state';
                else if (/할\s*일/.test(line)) section = 'todo';
                else if (/있었던|사건/.test(line)) section = 'event';
                else section = '';
                return;
            }

            const item = line.replace(/^[-*•]\s*/, '').trim();
            if (!item) return;

            if (section === 'rel') {
                const [name, relation, change] = item.split('|').map(part => part.trim());
                out.relationships.push({ name, relation, change });
            } else if (section === 'state') {
                out.userState.push(item);
            } else if (section === 'todo') {
                const match = item.match(/^\[\s*([xXvV✓✔])?\s*\]\s*(.*)$/);
                const body = match ? match[2] : item;
                const [todoText, from, due] = body.split('|').map(part => part.trim());
                out.todos.push({ text: todoText, from, due, done: !!(match && match[1]) });
            } else if (section === 'event') {
                const match = item.match(/^\[([^\]]*)\]\s*(.*)$/);
                out.events.push(match
                    ? { title: match[1], summary: match[2] }
                    : { title: '', summary: item });
            }
        });

        return sanitizeMemory({ ...mem, ...out });
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

    function buildPrompt(dialogue, action, context, latestSnapshot, memoryBlock) {
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

        if (memoryBlock) {
            lines.push('');
            lines.push('[장기기억 — 이 채팅방에서 자동 정리된 관계·현재 상태·할 일·있었던 일]');
            lines.push(memoryBlock);
            lines.push('- 우선순위: 최근 대화 > 장기기억의 현재 상태·관계 > 페르소나 기본 설정.');
            lines.push('- 장기기억의 현재 상태·관계가 페르소나와 다르면 장기기억을 따른다.');
            lines.push('- 지금 관계 단계에 맞는 거리감·호칭·말투로 반응한다. 가까워졌으면 그만큼 편하게, 틀어졌으면 그만큼 경계하거나 서먹하게.');
            lines.push('- 유저 캐릭터의 현재 상태(부상, 소지품, 처지, 숨기는 것 등)를 행동과 내면 묘사에 자연스럽게 반영한다.');
            lines.push('- 아직 하지 않은 할 일은 지금 장면과 관련 있을 때만 자연스럽게 떠올리거나 언급한다. 억지로 꺼내지 않는다.');
            lines.push('- 있었던 일은 회상이나 감정의 근거로만 쓰고, 기록에 없는 과거 사건을 지어내지 않는다.');
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

    function buildPersonaPrompt(keywords, storyDetail, recentContext, memoryBlock) {
        const system = [
            '너는 롤플레이 캐릭터 채팅용 유저 캐릭터 페르소나를 만드는 설정 보조다.',
            '제작자 설정, 상세 설명, 프롤로그와 최근 상황을 읽고 세계관에 자연스럽게 맞는 유저 캐릭터를 만든다.',
            '장기기억에 관계 변화나 현재 상태가 있으면 지금 시점 기준으로 반영한다.',
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
            '[장기기억 — 관계·상태 변화]',
            memoryBlock || '(없음)',
            '',
            '위 자료를 바탕으로 페르소나 칸에 바로 넣을 완성형 페르소나만 출력해줘.'
        ].join('\n');

        return { system, user };
    }

    /* =========================
     * 무료 키 우선 사용
     * - 무료 등급 한도는 "프로젝트 · 모델" 단위이고, 하루 한도는 미국 태평양 시간 자정에 다시 채워진다.
     * - 무료 키(결제 연결 안 된 프로젝트)를 먼저 쓰고, 하루 한도를 다 쓰면 유료 키로 넘어간다.
     * - 분당 한도에 걸리면 잠깐 기다렸다가 무료 키로 한 번 더 시도한다.
     * ========================= */
    function getFreeKey() {
        return String(GM_getValue(K_APIKEY_FREE, '') || '').trim();
    }

    function getPaidKey() {
        return String(GM_getValue(K_APIKEY, '') || '').trim();
    }

    function getCurrentModel() {
        return String(
            GM_getValue(K_MODEL, DEFAULT_MODELS[0].id) ||
            DEFAULT_MODELS[0].id
        ).trim();
    }

    function pacificDate(time) {
        const when = new Date(Number.isFinite(time) ? time : Date.now());
        try {
            return new Intl.DateTimeFormat('en-CA', {
                timeZone: 'America/Los_Angeles',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(when);
        } catch (_) {
            return new Date(when.getTime() - 8 * 3600000).toISOString().slice(0, 10);
        }
    }

    /* 다음 충전 시각(태평양 자정)을 사용자 시간대로 보여준다. 한국은 오후 4시 또는 5시. */
    function nextFreeResetText() {
        const now = Date.now();
        const today = pacificDate(now);
        let low = now;
        let high = now + 26 * 3600000;

        for (let i = 0; i < 26; i++) {
            const mid = (low + high) / 2;
            if (pacificDate(mid) === today) low = mid;
            else high = mid;
        }

        /* high는 자정 직후 몇 ms 이내라서 가장 가까운 분으로 반올림한다. */
        const reset = new Date(Math.round(high / 60000) * 60000);
        try {
            return reset.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
        } catch (_) {
            return reset.getHours() + ':' + String(reset.getMinutes()).padStart(2, '0');
        }
    }

    function getFreeState() {
        const today = pacificDate();
        const saved = GM_getValue(K_FREE_STATE, null);

        if (!saved || typeof saved !== 'object' || saved.date !== today) {
            return { date: today, exhausted: {}, used: {} };
        }

        return {
            date: today,
            exhausted: saved.exhausted && typeof saved.exhausted === 'object' ? saved.exhausted : {},
            used: saved.used && typeof saved.used === 'object' ? saved.used : {}
        };
    }

    function saveFreeState(state) {
        GM_setValue(K_FREE_STATE, state);
    }

    /* 소진 표시는 30분마다 한 번씩 다시 확인한다.
     * 분당 한도를 하루 한도로 잘못 읽었을 때 하루 종일 유료로 새는 것을 막기 위해서다. */
    function isFreeExhausted(model) {
        const markedAt = getFreeState().exhausted[model];
        return Number.isFinite(markedAt) && Date.now() - markedAt < FREE_RECHECK_MS;
    }

    function markFreeExhausted(model) {
        const state = getFreeState();
        state.exhausted[model] = Date.now();
        saveFreeState(state);
    }

    function noteFreeSuccess(model) {
        const state = getFreeState();
        delete state.exhausted[model];
        state.used[model] = (parseInt(state.used[model], 10) || 0) + 1;
        saveFreeState(state);
        return state.used[model];
    }

    function freeUsedToday() {
        return Object.values(getFreeState().used)
            .reduce((sum, value) => sum + (parseInt(value, 10) || 0), 0);
    }

    /* 지금 요청을 보낼 수 있는 키가 있는지(자동 기억 정리 전에 확인). */
    function canRequestGemini() {
        const free = getFreeKey();
        return !!getPaidKey() || (!!free && !isFreeExhausted(getCurrentModel()));
    }

    function parseGeminiError(response) {
        let parsed = null;
        try {
            parsed = JSON.parse(response.responseText || '{}');
        } catch (_) {}

        const error = parsed && parsed.error ? parsed.error : {};
        const details = Array.isArray(error.details) ? error.details : [];
        let quota = null;
        let retrySec = null;
        let freeTier = false;

        details.forEach(detail => {
            const type = String(detail && detail['@type'] || '');

            if (type.includes('QuotaFailure') && Array.isArray(detail.violations)) {
                detail.violations.forEach(violation => {
                    const id = String(violation.quotaId || '') + ' ' + String(violation.quotaMetric || '');
                    if (/free_?tier/i.test(id)) freeTier = true;
                    if (/PerDay/i.test(id)) quota = 'day';
                    else if (/PerMinute/i.test(id) && quota !== 'day') quota = 'minute';
                });
            }

            if (type.includes('RetryInfo') && detail.retryDelay) {
                const seconds = parseFloat(String(detail.retryDelay));
                if (Number.isFinite(seconds)) retrySec = seconds;
            }
        });

        if (!freeTier && /free[_ ]?tier/i.test(String(error.message || ''))) freeTier = true;

        return {
            status: response.status,
            quota,
            retrySec,
            freeTier,
            message: 'API 오류 (' + response.status + ')' + (error.message ? ': ' + error.message : '')
        };
    }

    function geminiPost(apiKey, model, body, handlers) {
        GM_xmlhttpRequest({
            method: 'POST',
            url:
                'https://generativelanguage.googleapis.com/v1beta/models/' +
                encodeURIComponent(model) +
                ':generateContent?key=' +
                encodeURIComponent(apiKey),
            headers: { 'Content-Type': 'application/json' },
            data: body,
            timeout: 60000,
            onload(response) {
                if (response.status < 200 || response.status >= 300) {
                    handlers.fail(parseGeminiError(response));
                    return;
                }

                let data;
                try {
                    data = JSON.parse(response.responseText);
                } catch (_) {
                    handlers.fail({ status: 0, message: 'API 응답을 읽지 못했어요.' });
                    return;
                }
                handlers.ok(data);
            },
            onerror() {
                handlers.fail({ status: 0, message: '네트워크 오류예요.' });
            },
            ontimeout() {
                handlers.fail({ status: 0, message: '요청 시간이 초과됐어요.' });
            }
        });
    }

    /* =========================
     * Gemini / 모델
     * ========================= */
    function fetchModels(onDone, onError) {
        const apiKey = getFreeKey() || getPaidKey();

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

    /* options.json: JSON으로 받기, options.onNotice(문구): 키 전환·대기 안내 */
    function requestGemini(system, user, label, onDone, onError, options) {
        const freeKey = getFreeKey();
        const paidKey = getPaidKey();
        const model = getCurrentModel();
        const notice = options && typeof options.onNotice === 'function'
            ? options.onNotice
            : () => {};

        if (!freeKey && !paidKey) {
            onError('API 키가 없어요. ⚙️ 설정에서 먼저 저장해 주세요.');
            return;
        }

        const body = JSON.stringify({
            system_instruction: {
                parts: [{ text: system }]
            },
            contents: [{
                role: 'user',
                parts: [{ text: user }]
            }],
            generationConfig: options && options.json
                ? { maxOutputTokens: 8192, responseMimeType: 'application/json' }
                : { maxOutputTokens: 8192 }
        });

        let switchedFromFree = false;

        const freeLimitMessage = () =>
            '🆓 오늘 이 모델(' + model + ')의 무료 한도를 다 썼어요.\n' +
            nextFreeResetText() + '에 다시 채워져요. 💳 유료 키를 넣으면 그동안 이어서 쓸 수 있어요.';

        const handleSuccess = (data, keyType) => {
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

            const free = keyType === 'free';
            const freeCount = free ? noteFreeSuccess(model) : 0;
            const cost = recordCostUsage(model, data.usageMetadata, label, free);

            if (cost) {
                if (free) {
                    cost.message = '🆓 무료 키로 처리 (₩0) · 오늘 무료 ' + freeCount + '회 · 누적 약 ₩' +
                        formatMoney(cost.totalKrw);
                } else if (switchedFromFree) {
                    cost.message = '💳 무료 한도를 다 써서 유료 키로 처리 · ' + cost.message.replace('💸 ', '');
                }
            }

            onDone(output, cost);
        };

        const attempt = (keyType, retriedFree) => {
            const apiKey = keyType === 'free' ? freeKey : paidKey;

            geminiPost(apiKey, model, body, {
                ok: data => handleSuccess(data, keyType),
                fail: info => {
                    if (keyType === 'free') {
                        if (info.status === 429) {
                            /* 분당 한도: 잠깐 기다렸다가 무료로 한 번 더 */
                            const waitSec = Number.isFinite(info.retrySec) ? info.retrySec : 10;
                            if (info.quota === 'minute' && !retriedFree && waitSec <= FREE_MINUTE_WAIT_MAX) {
                                notice('🆓 무료 분당 한도에 걸려서 ' + Math.ceil(waitSec) + '초 뒤 다시 시도할게요…');
                                setTimeout(() => attempt('free', true), (Math.ceil(waitSec) + 1) * 1000);
                                return;
                            }

                            if (info.quota !== 'minute') markFreeExhausted(model);

                            if (paidKey) {
                                switchedFromFree = true;
                                notice('🆓 무료 한도를 다 써서 💳 유료 키로 이어서 할게요…');
                                attempt('paid', true);
                                return;
                            }

                            onError(info.quota === 'minute'
                                ? '🆓 무료 분당 한도에 걸렸어요. ' + Math.ceil(waitSec) + '초쯤 뒤에 다시 눌러주세요.'
                                : freeLimitMessage());
                            return;
                        }

                        /* 구글 서버가 바쁠 때(5xx)는 유료 키로 넘긴다. */
                        if ((info.status >= 500 || info.status === 0) && paidKey) {
                            switchedFromFree = true;
                            notice('🆓 무료 키 응답이 불안정해서 💳 유료 키로 시도할게요…');
                            attempt('paid', true);
                            return;
                        }

                        onError('🆓 무료 키 오류 · ' + info.message);
                        return;
                    }

                    if (info.status === 429 && info.freeTier) {
                        onError(
                            '💳 유료 키 칸의 키가 무료 등급(결제 미연결)으로 보여요.\n' +
                            freeLimitMessage()
                        );
                        return;
                    }

                    onError(info.message);
                }
            });
        };

        if (freeKey && !isFreeExhausted(model)) {
            attempt('free', false);
        } else if (paidKey) {
            switchedFromFree = !!freeKey;
            attempt('paid', true);
        } else {
            onError(freeLimitMessage());
        }
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

    function recordCostUsage(modelId, usage, label, free) {
        const tokens = getUsageTokens(usage);

        if (!tokens.input && !tokens.output) return null;

        const rates = getModelCostRates(modelId, tokens.input);
        /* 무료 키로 처리한 요청은 요금이 없으므로 ₩0으로 기록한다. */
        const usd = free
            ? 0
            : (
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
            label: (label || '요청') + (free ? ' 🆓' : ''),
            model: modelId,
            modelLabel: free ? rates.label + ' · 무료' : rates.label,
            free: !!free,
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

        if (getFreeKey()) {
            const model = getCurrentModel();
            lines.push(
                '🆓 오늘 무료 ' + freeUsedToday() + '회' +
                    (isFreeExhausted(model)
                        ? ' · 이 모델 무료 다 씀 → ' + (getPaidKey() ? '💳 유료 키 사용 중' : '충전 대기')
                        : ' · 무료 먼저 사용 중') +
                    ' · ' + nextFreeResetText() + ' 충전'
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
            contain: layout style;
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

        /* 설정 칸이 많아도 서로 찌그러지지 않고 스크롤되게 한다. */
        #se-body > *,
        #se-settings > * {
            flex-shrink: 0;
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
        #se-mem-meta,
        #se-mem-status,
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

        #se-mem-chip {
            width: 100%;
            min-height: 30px;
            padding: 6px 9px;
            border: 1px solid rgba(95,208,195,.35);
            border-radius: 9px;
            background: rgba(95,208,195,.08);
            color: #dff7f3;
            font-size: 11px;
            font-weight: 700;
            text-align: left;
            cursor: pointer;
        }

        #se-mem-chip.busy {
            border-color: rgba(200,166,255,.55);
            background: rgba(200,166,255,.10);
            color: #efe6ff;
        }

        #se-mem-chip.err {
            border-color: rgba(255,146,146,.5);
            background: rgba(255,146,146,.08);
        }

        #se-mem-view {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }

        .se-mem-group {
            padding: 7px 8px;
            border: 1px solid #363b4d;
            border-radius: 9px;
            background: #181a21;
            font-size: 11.5px;
            line-height: 1.5;
        }

        .se-mem-group-title {
            margin-bottom: 3px;
            color: #fff;
            font-weight: 800;
        }

        .se-mem-item {
            padding: 2px 0;
            color: #d6d9e6;
            word-break: break-word;
        }

        .se-mem-sub {
            color: #9da2b6;
        }

        .se-mem-empty {
            color: #7d8296;
            font-size: 11px;
        }

        .se-mem-todo {
            display: flex;
            align-items: flex-start;
            gap: 6px;
            padding: 3px 0;
            color: #d6d9e6;
            word-break: break-word;
        }

        .se-mem-todo.done span {
            color: #7d8296;
            text-decoration: line-through;
        }

        .se-mem-more {
            margin-top: 4px;
            border: 0;
            padding: 2px 0;
            background: transparent;
            color: #8fb4ff;
            font-size: 11px;
            cursor: pointer;
        }

        #se-mem-text {
            min-height: 220px !important;
            max-height: 50vh !important;
            font-size: 11.5px !important;
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
                <span id="se-title">✨ 문장 부풀리기 · v6.15.0</span>
                <button id="se-gear" type="button" title="설정">⚙️</button>
                <button id="se-close" type="button" title="닫기">✕</button>
            </div>

            <div id="se-body">
                <div id="se-cost-top">아직 계산된 사용량이 없어요.</div>
                <button id="se-mem-chip" type="button">🧠 장기기억 불러오는 중…</button>

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
                            <span>최신부터 거꾸로</span>
                            <input
                                id="se-ctx-n"
                                class="se-inline-number"
                                type="number"
                                min="1"
                                max="100"
                                value="6"
                            >
                            <span>턴</span>
                        </div>

                        <div class="se-label">유저 메시지 1개 = 1턴으로 세서, 최신 턴부터 거꾸로 딱 그 수만큼 불러와요. 첫 턴 바로 앞 캐릭터 메시지도 같이 넣어요. 크랙 서버에서 못 불러오면 화면에서 읽어요.</div>

                        <div class="se-btn-row">
                            <button id="se-ctx-preview" type="button">🔍 실제로 읽힌 맥락 보기</button>
                            <button id="se-ctx-clear" type="button">🧹 이 채팅방 캐시 지우기</button>
                        </div>

                        <div id="se-ctx-status"></div>
                    </div>
                </details>

                <details class="se-section" id="se-mem-section">
                    <summary>🧠 장기기억 · 관계 · 할 일 (이 채팅방)</summary>
                    <div class="se-section-body">
                        <div class="se-inline">
                            <input id="se-mem-auto" type="checkbox">
                            <span>자동 정리 · 새 대화</span>
                            <input
                                id="se-mem-every"
                                class="se-inline-number"
                                type="number"
                                min="1"
                                max="50"
                                value="5"
                            >
                            <span>턴마다</span>
                        </div>

                        <div class="se-label">✨늘리기를 쓴 뒤 새 대화가 위 턴 수만큼 쌓였으면 관계 변화·내 상태·할 일·있었던 일을 알아서 정리해요. 그때만 Gemini를 한 번 더 불러요.</div>

                        <div id="se-mem-meta"></div>

                        <div class="se-btn-row">
                            <button id="se-mem-now" type="button">🧠 지금 정리</button>
                            <button id="se-mem-edit-btn" type="button">✏️ 직접 편집</button>
                        </div>

                        <div id="se-mem-view"></div>

                        <div id="se-mem-editor" style="display:none">
                            <textarea id="se-mem-text"></textarea>
                            <div class="se-btn-row" style="margin-top:6px">
                                <button id="se-mem-edit-save" type="button">💾 편집 저장</button>
                                <button id="se-mem-edit-cancel" type="button">취소</button>
                            </div>
                        </div>

                        <div class="se-inline">
                            <span>처음부터 다시 만들기</span>
                            <input
                                id="se-mem-rebuild-turns"
                                class="se-inline-number"
                                type="number"
                                min="0"
                                value="0"
                            >
                            <span>턴 (0 = 전체)</span>
                        </div>

                        <div class="se-btn-row">
                            <button id="se-mem-rebuild" type="button">📚 다시 만들기</button>
                            <button id="se-mem-clear" type="button">🗑️ 이 방 기억 지우기</button>
                        </div>

                        <div id="se-mem-status"></div>
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

                        <div class="se-label">🆓 무료 키 · 먼저 사용 (결제를 연결하지 않은 프로젝트의 키)</div>
                        <input id="se-key-free" type="password" placeholder="AIza... (비워두면 아래 키만 사용)">

                        <div class="se-label">💳 유료 키 · 무료 한도를 다 쓰면 자동 전환 (비워두면 무료만 사용)</div>
                        <input id="se-key" type="password" placeholder="AIza...">

                        <button id="se-key-swap" class="se-secondary" type="button">⇅ 두 칸 서로 바꾸기</button>

                        <div class="se-label" id="se-free-info">무료 한도는 프로젝트·모델마다 따로 있고, 매일 미국 태평양 시간 자정에 다시 채워져요. 결제를 연결한 프로젝트의 키를 무료 칸에 넣으면 ₩0으로 표시돼도 실제로는 요금이 나가요.</div>

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

        left = Math.round(clamp(
            left,
            viewport.left + EDGE,
            Math.max(
                viewport.left + EDGE,
                viewport.left + viewport.width - width - EDGE
            )
        ));

        top = Math.round(clamp(
            top,
            viewport.top + EDGE,
            Math.max(
                viewport.top + EDGE,
                viewport.top + viewport.height -
                    Math.min(height, isPanel ? 90 : height) -
                    EDGE
            )
        ));

        const style = element.style;
        const leftPx = left + 'px';
        const topPx = top + 'px';

        /* 위치가 그대로면 스타일을 다시 쓰지 않는다(불필요한 화면 재계산 방지). */
        const alreadyPlaced =
            style.getPropertyValue('position') === 'fixed' &&
            style.getPropertyValue('left') === leftPx &&
            style.getPropertyValue('top') === topPx &&
            style.getPropertyPriority('left') === 'important' &&
            style.getPropertyPriority('top') === 'important';

        if (!alreadyPlaced) {
            style.setProperty('position', 'fixed', 'important');
            style.setProperty('left', leftPx, 'important');
            style.setProperty('top', topPx, 'important');
            style.setProperty('right', 'auto', 'important');
            style.setProperty('bottom', 'auto', 'important');
            style.setProperty('transform', 'none', 'important');
        }

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
        const freeKeyInput = $('#se-key-free');

        function saveKeys() {
            GM_setValue(K_APIKEY, keyInput.value.trim());
            GM_setValue(K_APIKEY_FREE, freeKeyInput.value.trim());
        }
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
        freeKeyInput.value = GM_getValue(K_APIKEY_FREE, '');
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
                if (typeof refreshMemoryUI === 'function') refreshMemoryUI();
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
            saveKeys();
            GM_setValue(K_NAME, nameInput.value.trim());
            GM_setValue(K_PERSONA_HINT, personaHint.value.trim());
            GM_setValue(K_CTX_ON, true);
            GM_setValue(
                K_CTX_N,
                clamp(parseInt(ctxN.value, 10) || 6, 1, CTX_MAX_TURNS)
            );
            GM_setValue(K_COST_ON, costOn.checked);
            GM_setValue(
                K_COST_USDKRW,
                Math.max(1, parseFloat(costRate.value) || 1400)
            );
            GM_setValue(K_MEM_AUTO, $('#se-mem-auto').checked);
            GM_setValue(
                K_MEM_EVERY,
                clamp(parseInt($('#se-mem-every').value, 10) || 5, 1, 50)
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

            saveKeys();

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
            refreshCost();
        });

        /* 🆓 무료 키 / 💳 유료 키 */
        [keyInput, freeKeyInput].forEach(input => {
            input.addEventListener('change', () => {
                saveKeys();
                refreshCost();
            });
        });

        $('#se-key-swap').addEventListener('click', () => {
            const free = freeKeyInput.value;
            freeKeyInput.value = keyInput.value;
            keyInput.value = free;
            saveKeys();
            refreshCost();
            setInfo($('#se-fetch-status'), '두 칸을 서로 바꿨어요 ⇅', false);
        });

        /* 페르소나 자동추천 */
        $('#se-persona-suggest').addEventListener('click', async () => {
            const button = $('#se-persona-suggest');
            if (button.disabled) return;
            const keywords = personaHint.value.trim();

            saveKeys();
            GM_setValue(K_MODEL, modelSelect.value);
            GM_setValue(K_PERSONA_HINT, keywords);

            button.disabled = true;
            setInfo(personaStatus, '설정과 최근 대화를 불러오는 중…', false);

            const storyDetail = collectStoryDetail();
            let context = [];
            let memoryBlock = '';

            try {
                const loaded = await loadRecentChat(
                    clamp(parseInt(ctxN.value, 10) || 10, 6, 20)
                );
                context = loaded.context;
                memoryBlock = memoryToPrompt(getMemory(), loaded.snapshot && loaded.snapshot.text);
            } catch (_) {}

            if (!keywords && !storyDetail && !context.length) {
                button.disabled = false;
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
                context,
                memoryBlock
            );

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
                    /* 추천 결과는 항상 맨 위 1번 칸에 넣는다. */
                    const index = 0;
                    const resultTextarea = $('#se-persona-text-0');

                    $('#se-persona-on-0').checked = true;
                    resultTextarea.value = text;

                    /* 결과는 접이식 영역 안에서 제한된 높이로 보여 하단 설정을 가리지 않는다. */
                    const resultDetails = $('#se-persona-result');
                    if (resultDetails) resultDetails.open = true;
                    resultTextarea.style.height = '';

                    const slotNameInput = $('#se-persona-name-' + index);
                    if (
                        !slotNameInput.value.trim() ||
                        /^페르소나\s*\d+$/.test(slotNameInput.value.trim())
                    ) {
                        slotNameInput.value = '자동추천 페르소나';
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
                        const details = $('#se-persona-result');
                        if (details && details.scrollIntoView) {
                            details.scrollIntoView({
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

        let previewBusy = false;

        $('#se-ctx-preview').addEventListener('click', async () => {
            if (previewBusy) return;
            const n = clamp(parseInt(ctxN.value, 10) || 6, 1, CTX_MAX_TURNS);
            ctxN.value = n;
            GM_setValue(K_CTX_N, n);

            previewBusy = true;
            setInfo(ctxStatus, '최신 턴부터 거꾸로 불러오는 중… 📥', false);

            let loaded;
            try {
                loaded = await loadRecentChat(n);
            } catch (error) {
                setInfo(ctxStatus, '불러오기 실패: ' + (error && error.message || error), true);
                return;
            } finally {
                previewBusy = false;
            }

            const records = loaded.records;
            const latestSnapshot = loaded.snapshot || {};

            if (!records.length && !latestSnapshot.text) {
                setInfo(
                    ctxStatus,
                    '대화를 못 잡았어요. 채팅방 안에서 다시 눌러보세요.' +
                        (loaded.apiError ? '\n(서버: ' + loaded.apiError + ')' : ''),
                    true
                );
                return;
            }

            /* 미리보기만 최신 → 과거 순서로 보여준다.
             * records 원본은 건드리지 않으므로 Gemini 전달 순서는 계속 과거 → 최신이다. */
            const labels = turnAgoLabels(records);
            const previewText = records
                .map((item, index) => ({ item, label: labels[index] }))
                .reverse()
                .map((entry, index) => {
                    const item = entry.item;
                    const roleLabel = item.role === 'user'
                        ? '유저'
                        : item.role === 'assistant'
                            ? '상대 캐릭터'
                            : '역할 미확인';
                    const preview = String(item.text || '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    return (
                        (index + 1) + '. [' + (entry.label ? entry.label + ' · ' : '') + roleLabel + ']\n' +
                        (preview.length > 220 ? preview.slice(0, 220) + '…' : preview)
                    );
                })
                .join('\n\n');

            const sourceLine = loaded.source === 'api'
                ? '불러온 곳: 크랙 서버 (최신부터 역순, 정확한 턴 수)'
                : '불러온 곳: 화면 읽기' +
                    (loaded.apiError ? ' (서버 실패: ' + loaded.apiError + ')' : '') +
                    (loaded.scan ? '\n화면의 전체 메시지: ' + loaded.scan.groups.length + '개' : '');

            setInfo(
                ctxStatus,
                sourceLine +
                    '\n요청 ' + n + '턴 → 실제 ' + loaded.actualTurns + '턴 · 메시지 ' + records.length + '개' +
                    (loaded.source === 'api' && loaded.actualTurns < n
                        ? ' (대화가 아직 ' + loaded.actualTurns + '턴뿐이에요)'
                        : '') +
                    '\n직전 장면: ' + (latestSnapshot.source || '판별 실패') +
                    '\n미리보기 순서: 최신 → 과거\n' +
                    'Gemini 전달 순서: 과거 → 최신\n\n' +
                    previewText,
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
            K_APIKEY_FREE,
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
            K_COST_LOG,
            K_MEM_AUTO,
            K_MEM_EVERY
        ];

        const isMemoryKey = key => String(key).startsWith(K_MEM_BASE + '::');

        $('#se-export').addEventListener('click', () => {
            saveSlots();

            const data = {};

            syncKeys.forEach(key => {
                const value = GM_getValue(key, null);
                if (value !== null && value !== undefined) {
                    data[key] = value;
                }
            });

            /* 채팅방별 장기기억도 함께 옮긴다(다른 기기에서도 이어서 쓰도록). */
            if (typeof GM_listValues === 'function') {
                try {
                    (GM_listValues() || []).filter(isMemoryKey).forEach(key => {
                        const value = GM_getValue(key, null);
                        if (value) data[key] = value;
                    });
                } catch (_) {}
            }

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

                Object.keys(parsed.data).filter(isMemoryKey).forEach(key => {
                    GM_setValue(key, sanitizeMemory(parsed.data[key]));
                    count++;
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

        /* =========================
         * 장기기억 UI
         * ========================= */
        const memChip = $('#se-mem-chip');
        const memSection = $('#se-mem-section');
        const memAuto = $('#se-mem-auto');
        const memEvery = $('#se-mem-every');
        const memMeta = $('#se-mem-meta');
        const memView = $('#se-mem-view');
        const memEditor = $('#se-mem-editor');
        const memText = $('#se-mem-text');
        const memStatus = $('#se-mem-status');
        const memRebuildTurns = $('#se-mem-rebuild-turns');
        let memShowAllEvents = false;
        let chipTimer = null;

        memAuto.checked = GM_getValue(K_MEM_AUTO, true) !== false;
        memEvery.value = clamp(parseInt(GM_getValue(K_MEM_EVERY, 5), 10) || 5, 1, 50);

        memAuto.addEventListener('change', () => {
            GM_setValue(K_MEM_AUTO, memAuto.checked);
        });

        memEvery.addEventListener('change', () => {
            const value = clamp(parseInt(memEvery.value, 10) || 5, 1, 50);
            memEvery.value = value;
            GM_setValue(K_MEM_EVERY, value);
        });

        function memoryChipText(mem) {
            const open = mem.todos.filter(item => !item.done).length;
            if (
                !mem.relationships.length && !mem.userState.length &&
                !mem.todos.length && !mem.events.length
            ) {
                return '🧠 장기기억 비어 있음 · 눌러서 보기';
            }
            return '🧠 할 일 ' + open +
                ' · 관계 ' + mem.relationships.length +
                ' · 있었던 일 ' + mem.events.length;
        }

        function setChip(text, state) {
            if (chipTimer) {
                clearTimeout(chipTimer);
                chipTimer = null;
            }
            memChip.textContent = text;
            memChip.classList.toggle('busy', state === 'busy');
            memChip.classList.toggle('err', state === 'err');
        }

        function makeEl(tag, className, text) {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text != null) node.textContent = text;
            return node;
        }

        function memGroup(title, nodes, emptyText) {
            const box = makeEl('div', 'se-mem-group');
            box.appendChild(makeEl('div', 'se-mem-group-title', title));
            if (!nodes.length) box.appendChild(makeEl('div', 'se-mem-empty', emptyText));
            nodes.forEach(node => box.appendChild(node));
            return box;
        }

        function renderMemory() {
            const mem = getMemory();

            memMeta.textContent = mem.updatedAt
                ? '마지막 정리: ' + mem.updatedAt + ' · 지금까지 반영한 턴 ' + mem.processedTurns + '개'
                : '아직 정리된 기억이 없어요. ✨늘리기를 쓰거나 🧠 지금 정리를 눌러보세요.';

            memView.textContent = '';

            memView.appendChild(memGroup('👥 관계', mem.relationships.map(item => {
                const row = makeEl('div', 'se-mem-item');
                row.appendChild(makeEl('b', '', item.name));
                row.appendChild(document.createTextNode(' — ' + (item.relation || '관계 미정')));
                if (item.change) row.appendChild(makeEl('div', 'se-mem-sub', '↳ ' + item.change));
                return row;
            }), '아직 없어요'));

            memView.appendChild(memGroup(
                '🙋 내 캐릭터의 지금 상태',
                mem.userState.map(text => makeEl('div', 'se-mem-item', '• ' + text)),
                '기본 설정 그대로예요'
            ));

            memView.appendChild(memGroup('📌 해야 할 일', mem.todos.map(item => {
                const row = makeEl('label', 'se-mem-todo' + (item.done ? ' done' : ''));
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = item.done;
                box.addEventListener('change', () => {
                    const current = getMemory();
                    const target = current.todos.find(todo => memKey(todo.text) === memKey(item.text));
                    if (target) {
                        target.done = box.checked;
                        saveMemory(current);
                    }
                    renderMemory();
                });
                row.appendChild(box);
                row.appendChild(makeEl(
                    'span',
                    '',
                    item.text +
                        (item.from ? ' · ' + item.from : '') +
                        (item.due ? ' · 기한 ' + item.due : '')
                ));
                return row;
            }), '지금은 없어요'));

            const events = mem.events.slice().reverse();
            const shown = memShowAllEvents ? events : events.slice(0, 6);
            const eventBox = memGroup('📖 있었던 일 · 최근 순', shown.map(item => {
                const row = makeEl('div', 'se-mem-item');
                if (item.title) row.appendChild(makeEl('b', '', '[' + item.title + '] '));
                row.appendChild(document.createTextNode(item.summary));
                return row;
            }), '아직 없어요');

            if (events.length > 6) {
                const more = makeEl(
                    'button',
                    'se-mem-more',
                    memShowAllEvents ? '접기' : '더보기 (' + (events.length - 6) + '개 더)'
                );
                more.type = 'button';
                more.addEventListener('click', () => {
                    memShowAllEvents = !memShowAllEvents;
                    renderMemory();
                });
                eventBox.appendChild(more);
            }

            memView.appendChild(eventBox);

            if (!memoryBusy) setChip(memoryChipText(mem));
        }

        refreshMemoryUI = renderMemory;

        function closeMemoryEditor() {
            memEditor.style.display = 'none';
            memView.style.display = '';
        }

        function startMemoryJob(mode, options, labels) {
            if (memoryBusy) {
                setInfo(memStatus, '이미 기억을 정리하는 중이에요.', true);
                return Promise.resolve(null);
            }

            saveKeys();
            if (modelSelect.value) GM_setValue(K_MODEL, modelSelect.value);
            closeMemoryEditor();

            if (labels.start) {
                setChip(labels.start, 'busy');
                setInfo(memStatus, labels.start, false);
            }

            return runMemoryUpdate(mode, options, (index, total) => {
                const text = labels.progress + ' (' + index + '/' + total + ')';
                setChip(text, 'busy');
                setInfo(memStatus, text, false);
            }).then(result => {
                renderMemory();
                if (result && result.cost) refreshCost(result.cost);
                return result;
            }).catch(error => {
                const message = '🧠 기억 정리 실패: ' + (error && error.message || error);
                setChip(message, 'err');
                setInfo(memStatus, message, true);
                chipTimer = setTimeout(() => setChip(memoryChipText(getMemory())), 6000);
                return null;
            });
        }

        function maybeAutoMemory() {
            if (!memAuto.checked || memoryBusy) return;
            /* 무료 한도를 다 썼고 유료 키도 없으면 조용히 건너뛴다. */
            if (!canRequestGemini()) return;

            startMemoryJob('auto', null, {
                progress: '🧠 새 대화로 기억 정리 중…'
            }).then(result => {
                if (!result || result.skipped) return;
                setChip('✅ 기억 업데이트 · ' + memoryChipText(result.mem).replace('🧠 ', ''));
                setInfo(
                    memStatus,
                    '자동 정리 완료 ✅' + (result.cost ? '\n' + result.cost.message : ''),
                    false
                );
                chipTimer = setTimeout(() => setChip(memoryChipText(getMemory())), 5000);
            });
        }

        memChip.addEventListener('click', () => {
            settings.classList.add('show');
            body.classList.add('hide');
            memSection.open = true;
            renderMemory();

            requestAnimationFrame(() => {
                if (memSection.scrollIntoView) memSection.scrollIntoView({ block: 'start' });
                if (!isSoftKeyboardOpen()) clampElementToViewport(panel, null, true);
            });
        });

        $('#se-mem-now').addEventListener('click', () => {
            startMemoryJob('manual', null, {
                start: '🧠 새 대화를 불러오는 중…',
                progress: '🧠 기억 정리 중…'
            }).then(result => {
                if (!result) return;
                if (result.skipped) {
                    setInfo(memStatus, '새로 정리할 대화가 없어요 🙂', false);
                } else {
                    setInfo(
                        memStatus,
                        '정리 완료 ✅ (Gemini ' + result.chunks + '번 호출)' +
                            (result.cost ? '\n' + result.cost.message : ''),
                        false
                    );
                }
            });
        });

        $('#se-mem-rebuild').addEventListener('click', () => {
            const turns = Math.max(0, parseInt(memRebuildTurns.value, 10) || 0);
            const ok = window.confirm(
                (turns ? '최근 ' + turns + '턴' : '이 채팅방 전체 대화') +
                '으로 장기기억을 처음부터 다시 만들까요?\n\n' +
                '· ' + MEM_CHUNK_TURNS + '턴마다 Gemini를 한 번씩 불러요 (100턴이면 약 7번).\n' +
                '· 지금 기억(직접 편집한 내용 포함)은 새로 만든 기억으로 바뀌어요.'
            );
            if (!ok) return;

            startMemoryJob('rebuild', { turns }, {
                start: '📚 대화를 불러오는 중…',
                progress: '📚 다시 만드는 중…'
            }).then(result => {
                if (!result) return;
                if (result.skipped) {
                    setInfo(memStatus, '불러올 대화가 없어요.', true);
                } else {
                    setInfo(
                        memStatus,
                        '다시 만들기 완료 ✅ (Gemini ' + result.chunks + '번 호출)' +
                            (result.cost ? '\n' + result.cost.message : ''),
                        false
                    );
                }
            });
        });

        $('#se-mem-edit-btn').addEventListener('click', () => {
            if (memEditor.style.display === 'none') {
                memText.value = memoryToEditText(getMemory());
                memEditor.style.display = 'block';
                memView.style.display = 'none';
            } else {
                closeMemoryEditor();
            }
        });

        $('#se-mem-edit-save').addEventListener('click', () => {
            if (memoryBusy) {
                setInfo(memStatus, '기억 정리가 끝난 뒤에 저장해 주세요.', true);
                return;
            }
            saveMemory(editTextToMemory(memText.value, getMemory()));
            closeMemoryEditor();
            renderMemory();
            setInfo(memStatus, '편집한 기억을 저장했어요 💾', false);
        });

        $('#se-mem-edit-cancel').addEventListener('click', closeMemoryEditor);

        $('#se-mem-clear').addEventListener('click', () => {
            if (memoryBusy) {
                setInfo(memStatus, '기억 정리가 끝난 뒤에 지워 주세요.', true);
                return;
            }
            if (!window.confirm('이 채팅방의 장기기억(관계·상태·할 일·있었던 일)을 모두 지울까요?')) return;
            clearMemory();
            closeMemoryEditor();
            renderMemory();
            setInfo(memStatus, '이 채팅방 기억을 지웠어요 🗑️', false);
        });

        renderMemory();

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

            /* 결과를 보여준 뒤, 새 대화가 충분히 쌓였으면 장기기억을 정리한다. */
            setTimeout(maybeAutoMemory, 300);
        }

        let runBusy = false;

        async function run() {
            const d = dialogue.value;
            const a = action.value;

            if (!d.trim() && !a.trim()) {
                flash('대사나 행동 중 하나는 입력해 주세요.', true);
                return;
            }
            if (runBusy) return;
            runBusy = true;

            saveKeys();
            GM_setValue(K_MODEL, modelSelect.value);
            saveSlots();

            goButton.disabled = true;
            output.classList.remove('show');
            insertButton.classList.remove('show');
            resultButtons.classList.remove('show');
            flash('최신 대화 불러오는 중… 📥');

            /* 대화는 여기서 딱 한 번만 불러오고, 맥락과 직전 장면이 같은 결과를 공유한다. */
            const n = clamp(parseInt(ctxN.value, 10) || 6, 1, CTX_MAX_TURNS);
            let loaded;

            try {
                loaded = await loadRecentChat(n);
            } catch (error) {
                runBusy = false;
                goButton.disabled = false;
                flash('대화를 불러오지 못했어요: ' + (error && error.message || error), true);
                return;
            }

            const context = loaded.context;
            const latestSnapshot = loaded.snapshot || {
                text: '', nearby: '', source: '판별 실패', role: 'unknown', id: '', turnNumber: null
            };
            const memoryBlock = memoryToPrompt(getMemory(), latestSnapshot.text);
            const sceneFocus = extractSceneFocus(latestSnapshot.text);
            const prompt = buildPrompt(d, a, context, latestSnapshot, memoryBlock);

            /* 아래 요청 콜백에서 버튼을 다시 켤 때 진행 중 표시도 함께 푼다. */
            const releaseButton = () => {
                runBusy = false;
                goButton.disabled = false;
            };

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
                                releaseButton();
                                flash(
                                    repairCost
                                        ? '문맥에 맞게 자동 재교정했어요.\n' + repairCost.message
                                        : '문맥에 맞게 자동 재교정했어요.'
                                );
                            },
                            error => {
                                renderResult(formattedText);
                                refreshCost(costInfo);
                                releaseButton();
                                flash('자동 재교정은 실패했지만 첫 결과를 표시했어요: ' + error, true);
                            },
                            { onNotice: message => flash(message) }
                        );
                        return;
                    }

                    renderResult(formattedText);
                    refreshCost(costInfo);
                    releaseButton();
                    flash(costInfo ? costInfo.message : '');
                },
                error => {
                    releaseButton();
                    flash(error, true);
                },
                { onNotice: message => flash(message) }
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
         * 스크롤 중 주소창이 접히면 resize/scroll 이벤트가 연달아 오므로
         * 한 프레임에 한 번만 처리한다. 키보드가 열린 동안에는 건드리지 않는다. */
        let repairQueued = false;
        const repair = () => {
            if (repairQueued) return;
            repairQueued = true;

            requestAnimationFrame(() => {
                repairQueued = false;
                if (isSoftKeyboardOpen()) return;

                clampElementToViewport(fab, null, false);
                clampElementToViewport(panel, null, true);
            });
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
            window.visualViewport.addEventListener('resize', repair, { passive: true });
            window.visualViewport.addEventListener('scroll', repair, { passive: true });
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

        cleanupLegacyStorage();
        injectStyle();
        buildUI();
        watchStoryBootstrap();

        [100, 500, 1200, 2500, 5000].forEach(delay => {
            setTimeout(collectStoryBootstrap, delay);
        });

        routeTimer = setInterval(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastCtxSaveSig = '';
                setTimeout(watchStoryBootstrap, 300);
                setTimeout(() => {
                    if (typeof refreshMemoryUI === 'function') refreshMemoryUI();
                }, 400);
                setTimeout(collectStoryBootstrap, 1200);
                setTimeout(() => {
                    const panel = document.getElementById(PANEL_ID);
                    const fab = document.getElementById(FAB_ID);

                    if (isSoftKeyboardOpen()) return;

                    clampElementToViewport(fab, null, false);
                    clampElementToViewport(panel, null, true);
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
