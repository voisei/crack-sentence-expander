// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini)
// @namespace    https://crack.wrtn.ai
// @version      6.8.1
// @author       me
// @description  대사칸/행동칸 분리, 유저 페르소나 반영, 1인칭/3인칭 전환, 3인칭에선 단역 NPC 대사·묘사 허용(주요 캐릭터 제외), 모델 목록 선택, 크랙 채팅창 직접 입력. 행동칸은 '실제로 그 행동을 하는 장면'으로 묘사(명령 대사로 바꾸지 않음). 모바일(터치 드래그·하단 잘림) 대응.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @homepageURL  https://github.com/voisei/crack-sentence-expander
// @supportURL   https://github.com/voisei/crack-sentence-expander/issues
// @updateURL    https://raw.githubusercontent.com/voisei/crack-sentence-expander/main/crack-sentence-expander.user.js
// @downloadURL  https://raw.githubusercontent.com/voisei/crack-sentence-expander/main/crack-sentence-expander.user.js
// @license      MIT
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const K_APIKEY    = 'se_gemini_key';
    const K_MODEL     = 'se_gemini_model';
    const K_MODELLIST = 'se_model_list';
    const K_PERSONA   = 'se_persona';
    const K_PERSONAS  = 'se_personas';
    const K_NAME      = 'se_name';
    const K_POV       = 'se_pov';
    const K_LENGTH    = 'se_length';
    const K_POS       = 'se_panel_pos';
    const K_FABPOS    = 'se_fab_pos2';
    const K_STYLE     = 'se_style';
    const K_STYLES    = 'se_styles';
    const K_CTX_ON    = 'se_ctx_on';
    const K_CTX_N     = 'se_ctx_n';
    const K_CTX_SEL   = 'se_ctx_sel';
    const K_OPEN      = 'se_panel_open';

    const DEFAULT_MODELS = [
        { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (프리뷰)' },
    ];

    const LENGTHS = {
        three:  { label: '세줄', guide: '대사와 서술을 합쳐 3문장 안팎(딱 세 줄 정도)으로, 짧고 압축적으로.' },
        short:  { label: '짧게', guide: '간결하게, 핵심만 살짝 살을 붙여서.' },
        medium: { label: '중간', guide: '감각 묘사와 감정을 적당히 풀어서 자연스러운 분량으로.' },
        long:   { label: '길게', guide: '풍부한 문학적 묘사와 내면 묘사를 충분히 펼쳐서 길게.' },
    };

    // ───────────────────────── 프롬프트 ─────────────────────────
    function buildPrompt(dialogue, action, lengthKey, persona, pov, name, style, context) {
        const lenGuide = (LENGTHS[lengthKey] || LENGTHS.medium).guide;
        const isThird = (pov === 'third');
        const lines = [
            '너는 롤플레이(캐릭터 채팅)에서 "유저 캐릭터"의 대사와 행동을 문학적으로 늘려 쓰는 글쓰기 보조다.',
            '입력은 두 칸으로 들어온다: [대사] 칸과 [행동] 칸. 둘 중 하나가 비어 있을 수 있다.',
            '아래 규칙을 반드시 지켜라.',
        ];

        if (persona && persona.trim()) {
            lines.push('');
            lines.push('[유저 캐릭터의 페르소나]');
            lines.push(persona.trim());
            lines.push('- 위 페르소나의 성격·말투·가치관·배경에 어울리게 써라. 설정을 본문에 그대로 나열·설명하지 말고 자연스럽게 녹여라.');
        }

        if (style && style.trim()) {
            lines.push('');
            lines.push('[문체 규칙 — 사용자가 직접 지정함, 매우 중요]');
            lines.push(style.trim());
            lines.push('- 위 문체 규칙을 다른 어떤 규칙보다 우선해서 반드시 지켜라. (단, 따옴표=대사 / 별표=서술 형식과 시점 규칙은 그대로 유지)');
        }

        if (context && context.length) {
            lines.push('');
            lines.push('[직전 대화 맥락 — 참고용]');
            lines.push('아래는 지금까지 오간 대화의 최근 흐름이다(위가 과거, 아래가 최신).');
            context.forEach(m => lines.push('  · ' + m));
            lines.push('- 이 맥락에 자연스럽게 "이어지도록" 유저 캐릭터의 이번 입력을 늘려라.');
            lines.push('- 단, 맥락은 참고만 한다. 맥락 속 상대·NPC의 말이나 행동을 새로 지어내거나 이어 쓰지 마라. 오직 유저 캐릭터의 이번 [대사]/[행동]만 늘린다.');
        }

        lines.push('');
        lines.push('[시점]');
        if (isThird) {
            lines.push('- 3인칭 시점으로 쓴다. 유저 캐릭터를 ' + (name && name.trim()
                ? '"' + name.trim() + '"라는 이름(또는 그/그녀)으로'
                : '"그/그녀" 같은 3인칭 대명사로') + ' 지칭한다. "나/내가"로 쓰지 마라.');
            lines.push('- 장면을 풍부하게 하기 위해 "새로운 단역·배경 NPC"(지나가는 행인, 점원, 군중, 조연 등)를 등장시키고 그들의 대사·행동·묘사를 써도 된다.');
            lines.push('- 단, "주요 캐릭터"(유저의 상대역·메인 등장인물)의 대사·행동·감정·생각·반응은 절대 쓰지 마라. 그건 상대의 차례다.');
            lines.push('- 어떤 인물이 주요 캐릭터인지 애매하면, 주요 캐릭터로 간주하고 건드리지 마라. 새 단역은 이름 있는 기존 주연과 겹치지 않게 만들어라.');
        } else {
            lines.push('- 1인칭 시점으로 쓴다. "나/내가"로 서술한다.');
            lines.push('- 상대 캐릭터(모든 NPC 포함)의 대사·행동·감정·반응·생각은 절대 대신 쓰지 마라. 오직 "내가" 한 것만 쓴다.');
        }

        lines.push('');
        lines.push('[대사 칸 처리]');
        lines.push('- [대사] 칸은 유저 캐릭터가 실제로 입으로 "말하는" 내용이다.');
        lines.push('- 의미는 유지하되 말투를 자연스럽고 생생하게 다듬어, 큰따옴표 "..." 로 감싸 출력한다.');
        lines.push('- 없는 정보를 새로 지어내지 마라.');
        lines.push('');
        lines.push('[행동 칸 처리 — 가장 중요]');
        lines.push('- [행동] 칸은 유저 캐릭터가 "무엇을 하는지"에 대한 지시/의도다. 그 행동을 실제로 "수행하는 장면"으로 *이탤릭* 지문으로 묘사하라.');
        lines.push('- 절대로 그 지시문을 명령형 대사로 바꾸지 마라. 누군가가 그것을 소리내어 말하게 하지도 마라.');
        lines.push('- 행동 내용이 추상적이면, 그 행동의 구체적인 내용을 창의적으로 채워서 "실제로 그것을 해내는 모습"으로 보여줘라.');
        lines.push('- 예시: 행동 칸에 "독창적인 아이디어를 낸다" 라고 적혀 있으면');
        if (isThird) {
            const who = (name && name.trim() ? name.trim() : '그');
            lines.push('    (O)');
            lines.push('    *' + who + '는 손가락으로 턱을 톡톡 두드렸다.*');
            lines.push('');
            lines.push('    "음…"');
            lines.push('');
            lines.push('    *잠깐의 침묵 끝에 눈이 반짝였다.*');
            lines.push('');
            lines.push('    "이렇게 해보면 어떨까? 순서를 아예 거꾸로 뒤집는 거야."');
            lines.push('');
            lines.push('    *말하면서도 스스로 그 그림이 그려지는지 입꼬리가 슬쩍 올라갔다.*');
        } else {
            lines.push('    (O)');
            lines.push('    *나는 손가락으로 턱을 톡톡 두드렸다.*');
            lines.push('');
            lines.push('    "음…"');
            lines.push('');
            lines.push('    *잠깐의 침묵 끝에 눈이 반짝였다.*');
            lines.push('');
            lines.push('    "이렇게 해보면 어떨까? 순서를 아예 거꾸로 뒤집는 거야."');
            lines.push('');
            lines.push('    *말하면서도 스스로 그 그림이 그려지는지 입꼬리가 슬쩍 올라갔다.*');
        }
        lines.push('    → 위처럼 서술과 대사가 한 덩어리로 몰리지 않고, 서술→짧은 대사→서술→긴 대사→서술 식으로 자연스럽게 번갈아 섞여 나오게 한다.');
        lines.push('    (X) "독창적인 아이디어 내봐!"  ← 지시문을 명령 대사로 출력하는 것은 금지');
        lines.push('');
        lines.push('[공통 규칙]');
        lines.push('- 새로운 사건·설정을 멋대로 키우지 말고, 입력이 담은 행동·의도의 범위 안에서만 살을 붙인다.');
        lines.push('- 대사는 큰따옴표 "...", 지문·행동·감정·감각 묘사는 *별표*로 감싼 이탤릭으로 쓴다.');
        lines.push('- 대사와 행동이 둘 다 있으면, 서술 한 덩어리 뒤에 대사 한 덩어리를 붙이는 식의 고정된 순서로 쓰지 마라.');
        lines.push('- 대신 서술과 대사를 문장 단위로 번갈아 자연스럽게 섞어라. 서술이 대사 앞·중간·뒤 어디에 와도 좋고, 한 대사를 둘로 쪼개 사이에 짧은 서술(숨, 시선, 표정, 손짓 등)을 끼워 넣어도 좋다.');
        lines.push('- 다만 따옴표(대사)와 별표(서술) 형식 자체는 항상 지킨다.');
        lines.push('');
        lines.push('[절대 금지 — 반드시 지켜라]');
        lines.push('- 같은 문장이나 같은 표현·구절을 반복하지 마라. 비슷한 의미라도 앞에서 이미 쓴 묘사·문장 구조를 또 쓰지 마라. 매 문장은 새로운 내용을 담아 진행시킨다.');
        lines.push('- 한 응답 안에서 동어 반복(예: "그는 웃었다. 그는 미소 지었다.")이나 같은 행동·감정의 재탕을 하지 마라.');
        lines.push('- 유저의 페르소나·문체 규칙·이름·설정 내용을 본문에서 그대로 읊거나 나열·설명·요약하지 마라. 그 설정들은 "표현 방식"으로만 쓰고, 정보 자체를 캐릭터 입이나 서술로 다시 말하게 하지 마라.');
        lines.push('- 예: 페르소나가 "무뚝뚝한 검사"라고 해서 본문에 "그는 무뚝뚝한 검사였다" 같은 설명을 넣지 마라. 대신 무뚝뚝함이 말투·행동으로 드러나게만 한다.');
        lines.push('- 입력에 없는 설정 소개·자기소개·배경 설명을 끼워 넣지 마라.');
        lines.push('- 길이를 채우려고 했던 말을 늘려 반복하지 마라. 늘릴 내용이 없으면 차라리 짧게 끝내라.');
        lines.push('- 길이: ' + lenGuide);
        lines.push('');
        lines.push('[줄바꿈 형식 — 반드시 지켜라]');
        lines.push('- 서술(*별표*) 묶음과 대사("따옴표") 묶음은 각각 줄을 바꿔서 쓰고, 서로 다른 묶음 사이에는 반드시 빈 줄 한 칸을 넣어 분리한다.');
        lines.push('- 즉 한 문단 = 서술 묶음 하나 또는 대사 하나로 두고, 문단과 문단 사이를 빈 줄로 띄운다. 한 줄에 서술과 대사를 붙여 쓰지 마라.');
        lines.push('- 예시 형식:');
        lines.push('    *그는 천천히 고개를 들었다.*');
        lines.push('');
        lines.push('    "정말 괜찮은 거야?"');
        lines.push('');
        lines.push('    *대답 대신, 그는 옅게 웃을 뿐이었다.*');
        lines.push('');
        lines.push('[출력 규칙]');
        lines.push('- 설명·머리말·해설 없이, 완성된 본문 텍스트만 출력한다.');
        lines.push('- 전체를 따옴표나 코드블록(```)으로 감싸지 마라.');

        const system = lines.join('\n');
        const user = [
            '[대사]', (dialogue.trim() || '(없음)'),
            '', '[행동]', (action.trim() || '(없음)'),
            '', '위 규칙대로 늘려서 본문만 출력해줘.'
        ].join('\n');
        return { system, user };
    }

    // ───────────────────────── 모델 목록 불러오기 ─────────────────────────
    function fetchModels(onDone, onErr) {
        const apiKey = GM_getValue(K_APIKEY, '');
        if (!apiKey) { onErr('API 키를 먼저 넣고 저장해 주세요.'); return; }
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(apiKey),
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) { onErr('목록 조회 실패 (' + res.status + ')'); return; }
                try {
                    const data = JSON.parse(res.responseText);
                    const models = (data.models || [])
                        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                        .filter(m => /gemini/i.test(m.name || ''))
                        .map(m => ({ id: (m.name || '').replace(/^models\//, ''), label: m.displayName || (m.name || '').replace(/^models\//, '') }));
                    if (!models.length) { onErr('쓸 수 있는 모델이 없어요.'); return; }
                    onDone(models);
                } catch (e) { onErr('목록을 읽지 못했어요.'); }
            },
            onerror: function () { onErr('네트워크 오류예요.'); },
            timeout: 30000,
            ontimeout: function () { onErr('시간 초과예요.'); },
        });
    }

    // ───────────────────────── 본문 생성 호출 ─────────────────────────
    const STYLE_SLOTS = 3;
    const PERSONA_SLOTS = 3;

    // 저장된 페르소나 슬롯 배열 (구버전 단일 K_PERSONA 자동 이전)
    function getPersonaSlots() {
        let arr = GM_getValue(K_PERSONAS, null);
        if (!Array.isArray(arr)) {
            const legacy = GM_getValue(K_PERSONA, '');
            arr = [];
            for (let i = 0; i < PERSONA_SLOTS; i++) {
                arr.push({ on: (i === 0 && !!(legacy && legacy.trim())), name: '페르소나 ' + (i + 1), text: (i === 0 ? (legacy || '') : '') });
            }
        }
        return arr;
    }

    // 체크된 페르소나만 합쳐서 하나의 문자열로
    function getActivePersona() {
        return getPersonaSlots()
            .filter(s => s && s.on && s.text && s.text.trim())
            .map(s => ((s.name && s.name.trim()) ? '【' + s.name.trim() + '】 ' : '') + s.text.trim())
            .join('\n');
    }

    // 저장된 문체 슬롯 배열 가져오기 (구버전 단일 K_STYLE 자동 이전)
    function getStyleSlots() {
        let arr = GM_getValue(K_STYLES, null);
        if (!Array.isArray(arr)) {
            const legacy = GM_getValue(K_STYLE, '');
            arr = [];
            for (let i = 0; i < STYLE_SLOTS; i++) {
                arr.push({ on: (i === 0 && !!(legacy && legacy.trim())), name: '문체 ' + (i + 1), text: (i === 0 ? (legacy || '') : '') });
            }
        }
        return arr;
    }

    // 체크된 문체만 합쳐서 하나의 문자열로
    function getActiveStyle() {
        return getStyleSlots()
            .filter(s => s && s.on && s.text && s.text.trim())
            .map(s => ((s.name && s.name.trim()) ? '(' + s.name.trim() + ') ' : '') + s.text.trim())
            .join('\n');
    }

    // 화면에서 최근 대화 메시지 추출 (selector 있으면 우선, 없으면 자동 추정)
    function collectChatContext(maxN, selector) {
        const inPanel = el => el.closest && el.closest('#se-panel');
        let nodes = [];
        if (selector && selector.trim()) {
            try { nodes = Array.from(document.querySelectorAll(selector.trim())); } catch (_) { nodes = []; }
            nodes = nodes.filter(el => !inPanel(el) && isVisible(el));
        }
        if (!nodes.length) {
            // 자동 추정: 적당한 길이의 '가장 안쪽' 텍스트 블록만
            const cands = Array.from(document.body.querySelectorAll('p, div, span, li, article'))
                .filter(el => {
                    if (inPanel(el)) return false;
                    if (el.querySelector('textarea, input, button, select')) return false; // 입력창·UI 컨테이너 제외
                    if (!isVisible(el)) return false;
                    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
                    return t.length >= 2 && t.length <= 1200;
                });
            nodes = cands.filter(el => !cands.some(o => o !== el && el.contains(o)));
        }
        nodes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
        const out = [];
        const seen = new Set();
        for (const el of nodes) {
            const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
            if (!t || seen.has(t)) continue;
            seen.add(t);
            out.push(t);
        }
        return out.slice(-Math.max(1, maxN || 6));
    }

    function callGemini(dialogue, action, onDone, onErr) {
        const apiKey = GM_getValue(K_APIKEY, '');
        const model = GM_getValue(K_MODEL, DEFAULT_MODELS[0].id);
        const lengthKey = GM_getValue(K_LENGTH, 'medium');
        const persona = getActivePersona();
        const style = getActiveStyle();
        let context = [];
        if (GM_getValue(K_CTX_ON, false)) {
            const n = parseInt(GM_getValue(K_CTX_N, 6), 10) || 6;
            const sel = GM_getValue(K_CTX_SEL, '');
            try { context = collectChatContext(n, sel); } catch (_) { context = []; }
        }
        const pov = GM_getValue(K_POV, 'first');
        const name = GM_getValue(K_NAME, '');

        if (!apiKey) { onErr('API 키가 없어요. ⚙️ 설정에서 먼저 넣어주세요.'); return; }
        if (!dialogue.trim() && !action.trim()) { onErr('대사나 행동 중 하나는 입력해 주세요.'); return; }

        const { system, user } = buildPrompt(dialogue, action, lengthKey, persona, pov, name, style, context);
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);

        const body = {
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: 8192 },
        };

        GM_xmlhttpRequest({
            method: 'POST', url: endpoint,
            headers: { 'Content-Type': 'application/json' },
            data: JSON.stringify(body),
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) {
                    let msg = 'API 에러 (' + res.status + ')';
                    try { const e = JSON.parse(res.responseText); if (e.error && e.error.message) msg += ': ' + e.error.message; } catch (_) {}
                    console.error('[문장 부풀리기] API 에러 전체 응답:', res.responseText);
                    onErr(msg); return;
                }
                try {
                    const data = JSON.parse(res.responseText);
                    const cand = data.candidates && data.candidates[0];
                    if (!cand || !cand.content) {
                        const reason = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || '알 수 없음';
                        onErr('응답이 비어 있어요 (사유: ' + reason + '). 입력을 바꾸거나 다시 시도해 보세요.'); return;
                    }
                    const out = (cand.content.parts || []).map(p => p.text || '').join('').trim();
                    if (!out) {
                        const reason = cand.finishReason || '알 수 없음';
                        if (reason === 'MAX_TOKENS') { onErr('생각하는 데 토큰을 다 써서 본문이 안 나왔어요. "짧게"로 바꾸거나 다시 시도해 주세요.'); return; }
                        onErr('빈 응답이 왔어요 (사유: ' + reason + '). 다시 시도해 주세요.'); return;
                    }
                    const truncated = (cand.finishReason === 'MAX_TOKENS');
                    onDone(out, truncated);
                } catch (err) {
                    console.error('[문장 부풀리기] 파싱 실패:', err, res.responseText);
                    onErr('응답을 읽지 못했어요. 콘솔을 확인해 주세요.');
                }
            },
            onerror: function () { onErr('네트워크 오류예요. 연결을 확인해 주세요.'); },
            ontimeout: function () { onErr('시간 초과예요. 다시 시도해 주세요.'); },
            timeout: 60000,
        });
    }

    // ───────────────────── 크랙 채팅창 찾기 & 입력 ─────────────────────
    function isVisible(el) {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 12) return false;
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
        return true;
    }
    function findChatInput() {
        const inPanel = el => el.closest && el.closest('#se-panel');
        let cands = Array.from(document.querySelectorAll('textarea')).filter(el => !inPanel(el) && isVisible(el));
        if (cands.length) { cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top); return cands[0]; }
        cands = Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable=""]')).filter(el => !inPanel(el) && isVisible(el));
        if (cands.length) { cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top); return cands[0]; }
        return null;
    }
    function setNativeValue(el, value) {
        const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, value); else el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function insertIntoChat(text) {
        const el = findChatInput();
        if (!el) return false;
        el.focus();
        const tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            const cur = el.value || '';
            const next = cur.trim() ? (cur.replace(/\s+$/, '') + '\n' + text) : text;
            setNativeValue(el, next);
            try { el.selectionStart = el.selectionEnd = el.value.length; } catch (_) {}
        } else {
            el.focus();
            let ok = false;
            try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
            if (!ok) {
                el.textContent = (el.textContent ? el.textContent + '\n' : '') + text;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
            }
        }
        return true;
    }

    // ───────────────────────── 스타일 ─────────────────────────
    const CSS = `
    #se-panel, #se-fab { position: fixed; z-index: 2147483600; font-family: 'Pretendard','Noto Sans KR',system-ui,sans-serif; box-sizing: border-box; }
    #se-panel *, #se-fab * { box-sizing: border-box; }
    #se-panel { width: 350px; max-width: calc(100vw - 24px); background: #1d1f27; color: #e9eaf0; border: 1px solid #33384a; border-radius: 16px; box-shadow: 0 12px 40px rgba(0,0,0,.45); display: flex; flex-direction: column; overflow: hidden; font-size: 13px; max-height: calc(100vh - 24px); max-height: calc(100dvh - 24px); }
    #se-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: grab; user-select: none; touch-action: none; -webkit-user-select: none; background: linear-gradient(135deg,#2a2d3a,#23262f); border-bottom: 1px solid #33384a; }
    #se-head.dragging { cursor: grabbing; }
    #se-title { font-weight: 700; font-size: 13px; flex: 1; letter-spacing: -.2px; }
    #se-head button { background: transparent; border: none; color: #b9bcca; cursor: pointer; font-size: 15px; padding: 2px 5px; border-radius: 6px; line-height: 1; }
    #se-head button:hover { background: #3a3f52; color: #fff; }
    #se-body { padding: 12px; display: flex; flex-direction: column; gap: 9px; overflow-y: auto; -webkit-overflow-scrolling: touch; flex: 1 1 auto; min-height: 0; }
    .se-field-label { font-size: 11px; font-weight: 700; color: #9aa0b4; margin: 0 0 -4px 2px; letter-spacing: -.2px; }
    .se-ta { width: 100%; min-height: 48px; max-height: 160px; resize: vertical; background: #14161c; color: #e9eaf0; border: 1px solid #33384a; border-radius: 10px; padding: 9px; font-size: 13px; line-height: 1.5; font-family: inherit; }
    .se-ta:focus { outline: none; border-color: #6c7bff; }
    #se-dialogue { border-left: 3px solid #5fd0c3; }
    #se-action   { border-left: 3px solid #c8a6ff; }
    .se-segwrap { display: flex; gap: 6px; }
    .se-seg { display: flex; gap: 4px; background: #14161c; padding: 3px; border-radius: 10px; flex: 1; }
    .se-seg button { flex: 1; background: transparent; border: none; color: #9aa0b4; padding: 6px 0; border-radius: 7px; cursor: pointer; font-size: 12px; font-weight: 600; }
    .se-seg button.active { background: #3a3f52; color: #fff; }
    #se-pov button.active { background: #4a3f6b; color: #e7defb; }
    #se-go { width: 100%; padding: 11px; border: none; border-radius: 10px; cursor: pointer; background: linear-gradient(135deg,#6c7bff,#8a5cff); color: #fff; font-size: 13px; font-weight: 700; letter-spacing: -.2px; }
    #se-go:hover { filter: brightness(1.08); }
    #se-go:disabled { opacity: .6; cursor: default; }
    #se-out { white-space: pre-wrap; word-break: break-word; line-height: 1.65; background: #14161c; border: 1px solid #33384a; border-radius: 10px; padding: 11px; min-height: 40px; max-height: 45vh; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; font-size: 13px; display: none; }
    #se-out.show { display: block; }
    #se-out em { color: #c8bdff; font-style: italic; }
    #se-insert { width: 100%; padding: 10px; border: none; border-radius: 10px; cursor: pointer; background: linear-gradient(135deg,#3ecf8e,#2fb3c0); color: #07241c; font-size: 13px; font-weight: 800; display: none; }
    #se-insert.show { display: block; }
    #se-insert:hover { filter: brightness(1.06); }
    #se-outbtns { display: none; gap: 6px; }
    #se-outbtns.show { display: flex; }
    #se-outbtns button { flex: 1; padding: 8px; border: 1px solid #33384a; border-radius: 9px; background: #23262f; color: #e9eaf0; cursor: pointer; font-size: 12px; font-weight: 600; }
    #se-outbtns button:hover { background: #2d3140; }
    #se-status { font-size: 12px; color: #9aa0b4; min-height: 16px; }
    #se-status.err { color: #ff8a8a; }
    #se-settings { display: none; flex-direction: column; gap: 9px; padding: 12px; border-top: 1px solid #33384a; background: #191b22; overflow-y: auto; -webkit-overflow-scrolling: touch; min-height: 0; }
    #se-settings.show { display: flex; }
    #se-settings label { font-size: 12px; color: #b9bcca; font-weight: 600; }
    #se-settings input, #se-settings select, #se-settings textarea { width: 100%; background: #14161c; color: #e9eaf0; border: 1px solid #33384a; border-radius: 9px; padding: 9px; font-size: 13px; font-family: inherit; }
    .se-style-ta { min-height: 64px; max-height: 160px; resize: vertical; line-height: 1.5; }
    .se-style-slot { display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid #33384a; border-radius: 10px; background: #191b22; }
    .se-style-head { display: flex; align-items: center; gap: 8px; }
    #se-settings .se-style-head input[type="checkbox"] { width: 18px; height: 18px; flex: 0 0 auto; padding: 0; margin: 0; accent-color: #6c7bff; cursor: pointer; }
    #se-settings input.se-style-name { flex: 1 1 auto; padding: 6px 9px; font-size: 12px; }
    .se-style-ta { min-height: 50px !important; }
    #se-settings input:focus, #se-settings select:focus, #se-settings textarea:focus { outline: none; border-color: #6c7bff; }
    #se-fetch { padding: 8px; border: 1px solid #4a4f63; border-radius: 9px; cursor: pointer; background: #23262f; color: #cdd1e0; font-size: 12px; font-weight: 600; }
    #se-fetch:hover { background: #2d3140; }
    #se-fetch:disabled { opacity: .6; cursor: default; }
    #se-fetch-status { font-size: 11px; color: #9aa0b4; min-height: 14px; }
    #se-fetch-status.err { color: #ff8a8a; }
    #se-save { padding: 9px; border: none; border-radius: 9px; cursor: pointer; background: #6c7bff; color: #fff; font-weight: 700; font-size: 13px; }
    #se-hint { font-size: 11px; color: #777c8e; line-height: 1.5; }
    #se-fab { right: 18px; top: 72px; top: calc(72px + env(safe-area-inset-top, 0px)); width: 52px; height: 52px; border-radius: 50%; touch-action: none; background: linear-gradient(135deg,#6c7bff,#8a5cff); color: #fff; border: none; cursor: pointer; font-size: 22px; display: none; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(108,123,255,.5); }
    .se-ctx-row { display: flex; align-items: center; gap: 8px; }
    #se-settings .se-ctx-row input[type="checkbox"] { width: 18px; height: 18px; flex: 0 0 auto; padding: 0; margin: 0; accent-color: #6c7bff; cursor: pointer; }
    #se-settings input.se-ctx-n { width: 64px; flex: 0 0 auto; text-align: center; }
    .se-ctx-label { font-size: 12px; color: #b9bcca; }
    #se-ctx-test { padding: 8px; border: 1px solid #4a4f63; border-radius: 9px; cursor: pointer; background: #23262f; color: #cdd1e0; font-size: 12px; font-weight: 600; }
    #se-ctx-test:hover { background: #2d3140; }
    #se-ctx-status { font-size: 11px; color: #9aa0b4; min-height: 14px; white-space: pre-wrap; max-height: 120px; overflow-y: auto; line-height: 1.5; }
    #se-sync-box { min-height: 56px; max-height: 120px; resize: vertical; line-height: 1.45; font-size: 12px; }
    .se-sync-btns { display: flex; gap: 6px; }
    .se-sync-btns button { flex: 1; padding: 9px; border: 1px solid #4a4f63; border-radius: 9px; cursor: pointer; background: #23262f; color: #cdd1e0; font-size: 12px; font-weight: 700; }
    .se-sync-btns button:hover { background: #2d3140; }
    #se-sync-status { font-size: 11px; color: #9aa0b4; min-height: 14px; }
    #se-sync-status.err { color: #ff8a8a; }
    #se-fab.show { display: flex; }
    `;

    function injectStyle() { const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

    function buildUI() {
        const panel = document.createElement('div');
        panel.id = 'se-panel';
        panel.innerHTML = `
            <div id="se-head">
                <span id="se-title">✨ 문장 부풀리기</span>
                <button id="se-gear" title="설정">⚙️</button>
                <button id="se-min" title="닫기">✕</button>
            </div>
            <div id="se-body">
                <div class="se-field-label">💬 대사 (말하는 내용)</div>
                <textarea id="se-dialogue" class="se-ta" placeholder='예: 괜찮아, 내가 도와줄게'></textarea>
                <div class="se-field-label">🎬 행동 (하는 행동·의도)</div>
                <textarea id="se-action" class="se-ta" placeholder='예: 독창적인 아이디어를 낸다'></textarea>
                <div class="se-segwrap">
                    <div class="se-seg" id="se-pov">
                        <button data-pov="first">1인칭</button>
                        <button data-pov="third">3인칭</button>
                    </div>
                </div>
                <div class="se-seg" id="se-len">
                    <button data-len="three">세줄</button>
                    <button data-len="short">짧게</button>
                    <button data-len="medium" class="active">중간</button>
                    <button data-len="long">길게</button>
                </div>
                <button id="se-go">✨ 문학적으로 늘리기</button>
                <div id="se-status"></div>
                <div id="se-out"></div>
                <button id="se-insert">💬 채팅창에 바로 넣기</button>
                <div id="se-outbtns">
                    <button id="se-copy">📋 복사</button>
                    <button id="se-retry">🔄 다시 뽑기</button>
                </div>
            </div>
            <div id="se-settings">
                <label>🎭 유저 페르소나 (여러 개 저장 → 쓸 것만 체크 ✔)</label>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-persona-chk-0">
                        <input type="text" id="se-persona-name-0" class="se-style-name" placeholder="이름 (예: 검사 서지훈)">
                    </div>
                    <textarea id="se-persona-0" class="se-style-ta" placeholder='예: 27세 무뚝뚝한 검사. 말수 적고 비꼬는 말투. 속은 다정함.'></textarea>
                </div>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-persona-chk-1">
                        <input type="text" id="se-persona-name-1" class="se-style-name" placeholder="이름 (예: 학생 ver)">
                    </div>
                    <textarea id="se-persona-1" class="se-style-ta" placeholder='예: 밝고 발랄한 고등학생. 호기심 많고 장난기 가득.'></textarea>
                </div>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-persona-chk-2">
                        <input type="text" id="se-persona-name-2" class="se-style-name" placeholder="이름 (선택)">
                    </div>
                    <textarea id="se-persona-2" class="se-style-ta" placeholder='예: ...'></textarea>
                </div>
                <label>✍️ 문체 규칙 (여러 개 저장 → 쓸 것만 체크 ✔)</label>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-style-chk-0">
                        <input type="text" id="se-style-name-0" class="se-style-name" placeholder="이름 (예: 건조체)">
                    </div>
                    <textarea id="se-style-0" class="se-style-ta" placeholder='예: 짧고 건조한 문장 위주로. 비유는 적게.'></textarea>
                </div>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-style-chk-1">
                        <input type="text" id="se-style-name-1" class="se-style-name" placeholder="이름 (예: 고풍체)">
                    </div>
                    <textarea id="se-style-1" class="se-style-ta" placeholder='예: 고풍스러운 문어체. 한자어를 적절히.'></textarea>
                </div>
                <div class="se-style-slot">
                    <div class="se-style-head">
                        <input type="checkbox" id="se-style-chk-2">
                        <input type="text" id="se-style-name-2" class="se-style-name" placeholder="이름 (예: 감성체)">
                    </div>
                    <textarea id="se-style-2" class="se-style-ta" placeholder='예: 감각적이고 서정적인 묘사 위주.'></textarea>
                </div>
                <label>🧠 최근 대화 맥락 참고 (실험적)</label>
                <div class="se-ctx-row">
                    <input type="checkbox" id="se-ctx-chk">
                    <span class="se-ctx-label">켜기 · 최근</span>
                    <input type="number" id="se-ctx-n" class="se-ctx-n" min="1" max="30" value="6">
                    <span class="se-ctx-label">개</span>
                </div>
                <input id="se-ctx-sel" type="text" placeholder="(고급) 메시지 CSS 선택자 — 비워두면 자동">
                <button id="se-ctx-test">🔍 맥락 미리보기</button>
                <div id="se-ctx-status"></div>
                <label>🪪 캐릭터 이름 (3인칭일 때 사용, 선택)</label>
                <input id="se-name" type="text" placeholder="예: 서지훈">
                <label>🔑 Gemini API 키</label>
                <input id="se-key" type="password" placeholder="AIza...">
                <label>🤖 모델 (목록에서 선택)</label>
                <select id="se-model"></select>
                <button id="se-fetch">🔄 사용 가능한 모델 불러오기</button>
                <div id="se-fetch-status"></div>
                <button id="se-save">저장</button>
                <label>🔄 설정 동기화 (다른 기기로 옮기기)</label>
                <textarea id="se-sync-box" placeholder="여기서 '내보내기'를 누르면 코드가 생겨요. 다른 기기에선 그 코드를 붙여넣고 '가져오기'를 누르면 똑같이 맞춰져요."></textarea>
                <div class="se-sync-btns">
                    <button id="se-export">📤 내보내기</button>
                    <button id="se-import">📥 가져오기</button>
                </div>
                <div id="se-sync-status"></div>
                <div id="se-hint">키는 aistudio.google.com 에서 발급해요. 이 브라우저에만 저장되고 절대 공유 마세요. 페르소나·문체 각 3칸·이름·시점도 함께 저장돼요. (체크한 것끼리 같이 적용)</div>
            </div>
        `;
        document.body.appendChild(panel);

        const fab = document.createElement('button');
        fab.id = 'se-fab'; fab.title = '문장 부풀리기 열기'; fab.textContent = '✨';
        document.body.appendChild(fab);

        wireUp(panel, fab);
    }

    function wireUp(panel, fab) {
        const $ = sel => panel.querySelector(sel);
        const dialogue = $('#se-dialogue');
        const action   = $('#se-action');
        const out       = $('#se-out');
        const insertBtn = $('#se-insert');
        const outbtns   = $('#se-outbtns');
        const status    = $('#se-status');
        const goBtn     = $('#se-go');
        const settings  = $('#se-settings');
        const modelSel  = $('#se-model');
        const nameInput = $('#se-name');
        const fetchBtn  = $('#se-fetch');
        const fetchStat = $('#se-fetch-status');

        const pos = GM_getValue(K_POS, null);
        if (pos && typeof pos.left === 'number') { panel.style.left = pos.left + 'px'; panel.style.top = pos.top + 'px'; panel.style.right = 'auto'; }
        else { panel.style.right = '18px'; panel.style.top = '90px'; }
        if (GM_getValue(K_OPEN, true) === false) { panel.style.display = 'none'; fab.classList.add('show'); }

        // FAB(✨ 토글) 저장된 위치 복원
        const fpos = GM_getValue(K_FABPOS, null);
        if (fpos && typeof fpos.left === 'number') {
            fab.style.left = fpos.left + 'px'; fab.style.top = fpos.top + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
        }

        // 시점 토글
        const savedPov = GM_getValue(K_POV, 'first');
        $('#se-pov').querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.dataset.pov === savedPov);
            b.addEventListener('click', () => {
                $('#se-pov').querySelectorAll('button').forEach(x => x.classList.remove('active'));
                b.classList.add('active'); GM_setValue(K_POV, b.dataset.pov);
            });
        });

        // 길이
        const savedLen = GM_getValue(K_LENGTH, 'medium');
        $('#se-len').querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.dataset.len === savedLen);
            b.addEventListener('click', () => {
                $('#se-len').querySelectorAll('button').forEach(x => x.classList.remove('active'));
                b.classList.add('active'); GM_setValue(K_LENGTH, b.dataset.len);
            });
        });

        // 설정값 로드
        $('#se-key').value = GM_getValue(K_APIKEY, '');
        nameInput.value = GM_getValue(K_NAME, '');

        // 페르소나 3슬롯 로드 / 저장
        function applyPersonasToUI(arr) {
            for (let i = 0; i < PERSONA_SLOTS; i++) {
                const s = arr[i] || { on: false, name: '', text: '' };
                const chk = $('#se-persona-chk-' + i), nm = $('#se-persona-name-' + i), ta = $('#se-persona-' + i);
                if (chk) chk.checked = !!s.on;
                if (nm) nm.value = s.name || '';
                if (ta) ta.value = s.text || '';
            }
        }
        function collectPersonas() {
            const arr = [];
            for (let i = 0; i < PERSONA_SLOTS; i++) {
                const chk = $('#se-persona-chk-' + i), nm = $('#se-persona-name-' + i), ta = $('#se-persona-' + i);
                arr.push({ on: !!(chk && chk.checked), name: (nm && nm.value.trim()) || ('페르소나 ' + (i + 1)), text: (ta && ta.value) || '' });
            }
            return arr;
        }
        function savePersonas() { GM_setValue(K_PERSONAS, collectPersonas()); }
        applyPersonasToUI(getPersonaSlots());
        for (let i = 0; i < PERSONA_SLOTS; i++) {
            const chk = $('#se-persona-chk-' + i);
            if (chk) chk.addEventListener('change', savePersonas);
        }

        // 문체 3슬롯 로드 / 저장
        function applyStylesToUI(arr) {
            for (let i = 0; i < STYLE_SLOTS; i++) {
                const s = arr[i] || { on: false, name: '', text: '' };
                const chk = $('#se-style-chk-' + i), nm = $('#se-style-name-' + i), ta = $('#se-style-' + i);
                if (chk) chk.checked = !!s.on;
                if (nm) nm.value = s.name || '';
                if (ta) ta.value = s.text || '';
            }
        }
        function collectStyles() {
            const arr = [];
            for (let i = 0; i < STYLE_SLOTS; i++) {
                const chk = $('#se-style-chk-' + i), nm = $('#se-style-name-' + i), ta = $('#se-style-' + i);
                arr.push({ on: !!(chk && chk.checked), name: (nm && nm.value.trim()) || ('문체 ' + (i + 1)), text: (ta && ta.value) || '' });
            }
            return arr;
        }
        function saveStyles() { GM_setValue(K_STYLES, collectStyles()); }
        applyStylesToUI(getStyleSlots());
        // 체크박스는 누르는 즉시 저장(저장 버튼 안 눌러도 적용)
        for (let i = 0; i < STYLE_SLOTS; i++) {
            const chk = $('#se-style-chk-' + i);
            if (chk) chk.addEventListener('change', saveStyles);
        }

        // 대화 맥락 참고 설정
        const ctxChk = $('#se-ctx-chk'), ctxN = $('#se-ctx-n'), ctxSel = $('#se-ctx-sel'), ctxStat = $('#se-ctx-status');
        ctxChk.checked = GM_getValue(K_CTX_ON, false);
        ctxN.value = GM_getValue(K_CTX_N, 6);
        ctxSel.value = GM_getValue(K_CTX_SEL, '');
        ctxChk.addEventListener('change', () => GM_setValue(K_CTX_ON, ctxChk.checked));
        $('#se-ctx-test').addEventListener('click', () => {
            const n = parseInt(ctxN.value, 10) || 6;
            let arr = [];
            try { arr = collectChatContext(n, ctxSel.value); } catch (_) {}
            if (!arr.length) {
                ctxStat.textContent = '못 잡았어요 😅 채팅이 화면에 보이는지 확인하거나, 선택자를 비워 자동으로 두고 다시 해보세요.';
                return;
            }
            ctxStat.textContent = arr.length + '개 잡힘:\n' + arr.map((m, i) => (i + 1) + '. ' + (m.length > 60 ? m.slice(0, 60) + '…' : m)).join('\n');
        });

        function populateModels(list, selected) {
            modelSel.innerHTML = '';
            list.forEach(m => { const o = document.createElement('option'); o.value = m.id; o.textContent = m.label; modelSel.appendChild(o); });
            const want = selected || GM_getValue(K_MODEL, list[0] && list[0].id);
            if (want && list.some(m => m.id === want)) modelSel.value = want;
            else if (list[0]) modelSel.value = list[0].id;
        }
        let storedList = GM_getValue(K_MODELLIST, null);
        if (!Array.isArray(storedList) || !storedList.length) storedList = DEFAULT_MODELS;
        populateModels(storedList);

        fetchBtn.addEventListener('click', () => {
            GM_setValue(K_APIKEY, $('#se-key').value.trim());
            fetchBtn.disabled = true; fetchStat.classList.remove('err'); fetchStat.textContent = '불러오는 중…';
            fetchModels(
                (models) => { GM_setValue(K_MODELLIST, models); populateModels(models, modelSel.value); fetchStat.textContent = models.length + '개 불러왔어요 ✅'; fetchBtn.disabled = false; },
                (err) => { fetchStat.classList.add('err'); fetchStat.textContent = err; fetchBtn.disabled = false; }
            );
        });

        $('#se-gear').addEventListener('click', () => { settings.classList.toggle('show'); setTimeout(() => { if (wireUp._clamp) wireUp._clamp(false); }, 0); });
        $('#se-save').addEventListener('click', () => {
            GM_setValue(K_APIKEY, $('#se-key').value.trim());
            savePersonas();
            saveStyles();
            GM_setValue(K_NAME, nameInput.value.trim());
            GM_setValue(K_CTX_ON, ctxChk.checked);
            GM_setValue(K_CTX_N, parseInt(ctxN.value, 10) || 6);
            GM_setValue(K_CTX_SEL, ctxSel.value.trim());
            if (modelSel.value) GM_setValue(K_MODEL, modelSel.value);
            settings.classList.remove('show');
            flash('저장됐어요 ✅');
        });

        // ── 설정 동기화 (다른 기기로 옮기기) ──
        const SYNC_KEYS = [K_APIKEY, K_MODEL, K_PERSONA, K_PERSONAS, K_STYLES, K_NAME, K_POV, K_LENGTH, K_CTX_ON, K_CTX_N, K_CTX_SEL];
        const syncBox = $('#se-sync-box'), syncStat = $('#se-sync-status');
        function syncFlash(msg, isErr) { syncStat.textContent = msg; syncStat.classList.toggle('err', !!isErr); }
        function b64encUtf8(s) {
            const bytes = new TextEncoder().encode(s);
            let bin = '';
            bytes.forEach(byte => { bin += String.fromCharCode(byte); });
            return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
        }
        function b64decUtf8(b) {
            b = (b || '').trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
            while (b.length % 4) b += '=';
            const bin = atob(b);
            const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
            return new TextDecoder().decode(bytes);
        }
        $('#se-export').addEventListener('click', () => {
            const obj = {};
            SYNC_KEYS.forEach(k => { const v = GM_getValue(k, null); if (v !== null && v !== undefined) obj[k] = v; });
            const json = JSON.stringify({ v: 1, app: 'crack-se', data: obj });
            let code;
            try { code = 'CSE1:' + b64encUtf8(json); } catch (_) { code = json; }
            syncBox.value = code;
            syncBox.focus(); try { syncBox.select(); } catch (_) {}
            copyToClipboard(code,
                () => syncFlash('내보냈어요! 코드가 복사됐으니 다른 기기에 붙여넣으세요 📋'),
                () => syncFlash('코드를 만들었어요. 위 칸을 길게 눌러 직접 복사해 주세요.'));
        });
        function parseSyncCode(rawIn) {
            let raw = (rawIn || '').trim();
            raw = raw
                .replace(/[\u201C\u201D]/g, '"')
                .replace(/[\u2018\u2019]/g, "'")
                .replace(/^```(?:txt|json|js)?/i, '')
                .replace(/```$/i, '')
                .replace(/^`+|`+$/g, '')
                .trim();

            function tryParseJsonText(txt) {
                if (!txt) return null;
                try { return JSON.parse(txt); } catch (_) { return null; }
            }

            // 1) JSON이 그대로 붙어온 경우
            const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
            if (s >= 0 && e > s) {
                const parsedJson = tryParseJsonText(raw.slice(s, e + 1));
                if (parsedJson) return parsedJson;
            }

            // 2) CSE1: 코드 또는 base64/base64url만 붙어온 경우
            const candidates = [];
            const cse = raw.match(/CSE1:\s*([A-Za-z0-9+/_=\-\s]+)/);
            if (cse) candidates.push(cse[1]);

            // 코드가 CSE1: 없이 eyJ...부터 붙어온 경우도 잡기
            const eyj = raw.match(/eyJ[A-Za-z0-9+/_=\-\s]{20,}/);
            if (eyj) candidates.push(eyj[0]);

            // 입력칸 전체가 base64처럼 보이면 그것도 시도
            const compact = raw.replace(/\s+/g, '');
            if (/^[A-Za-z0-9+/_=\-]{20,}$/.test(compact)) candidates.push(compact);

            for (const c of candidates) {
                try {
                    const dec = b64decUtf8(c);
                    const parsed = tryParseJsonText(dec);
                    if (parsed) return parsed;
                } catch (_) {}
            }

            return null;
        }
                $('#se-import').addEventListener('click', () => {
            const raw = (syncBox.value || '').trim();
            if (!raw) { syncFlash('가져올 코드를 먼저 붙여넣어 주세요.', true); return; }
            const parsed = parseSyncCode(raw);
            if (!parsed) { syncFlash('코드를 못 읽었어요 😢 코드 "전체"를 빠짐없이 붙여넣었는지 확인해 주세요.', true); return; }
            const data = parsed && parsed.data;
            if (!data || typeof data !== 'object') { syncFlash('이 코드엔 설정이 없어요 😢', true); return; }
            let cnt = 0;
            SYNC_KEYS.forEach(k => { if (Object.prototype.hasOwnProperty.call(data, k)) { GM_setValue(k, data[k]); cnt++; } });
            if (!cnt) { syncFlash('적용할 설정을 못 찾았어요.', true); return; }
            syncFlash(cnt + '개 설정을 가져왔어요. 잠시 후 새로고침해서 적용할게요… 🔄');
            setTimeout(() => location.reload(), 900);
        });

        $('#se-min').addEventListener('click', () => { panel.style.display = 'none'; fab.classList.add('show'); GM_setValue(K_OPEN, false); });
        // FAB: 살짝만 누르면 열기(클릭), 끌면 위치 이동
        let fabDrag = false, fabMoved = false, fabId = null, fabOffX = 0, fabOffY = 0, fabSX = 0, fabSY = 0;
        function clampFab(save) {
            const r = fab.getBoundingClientRect();
            let l = isNaN(parseFloat(fab.style.left)) ? r.left : parseFloat(fab.style.left);
            let t = isNaN(parseFloat(fab.style.top)) ? r.top : parseFloat(fab.style.top);
            l = Math.max(0, Math.min(l, window.innerWidth - fab.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - fab.offsetHeight));
            fab.style.left = l + 'px'; fab.style.top = t + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
            if (save) GM_setValue(K_FABPOS, { left: l, top: t });
        }
        fab.addEventListener('pointerdown', (e) => {
            fabDrag = true; fabMoved = false; fabId = e.pointerId;
            const r = fab.getBoundingClientRect();
            fabOffX = e.clientX - r.left; fabOffY = e.clientY - r.top;
            fabSX = e.clientX; fabSY = e.clientY;
            try { fab.setPointerCapture(e.pointerId); } catch (_) {}
        });
        fab.addEventListener('pointermove', (e) => {
            if (!fabDrag || e.pointerId !== fabId) return;
            if (Math.abs(e.clientX - fabSX) + Math.abs(e.clientY - fabSY) > 6) fabMoved = true;
            if (!fabMoved) return;
            let l = e.clientX - fabOffX, t = e.clientY - fabOffY;
            l = Math.max(0, Math.min(l, window.innerWidth - fab.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - fab.offsetHeight));
            fab.style.left = l + 'px'; fab.style.top = t + 'px';
            fab.style.right = 'auto'; fab.style.bottom = 'auto';
            e.preventDefault();
        });
        function fabEnd(e) {
            if (!fabDrag) return;
            if (e && e.pointerId != null && e.pointerId !== fabId) return;
            fabDrag = false; fabId = null;
            if (fabMoved) {
                const r = fab.getBoundingClientRect();
                GM_setValue(K_FABPOS, { left: r.left, top: r.top });
            } else {
                // 안 움직였으면 = 클릭 → 패널 열기
                panel.style.display = 'flex'; fab.classList.remove('show'); GM_setValue(K_OPEN, true);
                setTimeout(() => { if (wireUp._clamp) wireUp._clamp(false); }, 0);
            }
        }
        fab.addEventListener('pointerup', fabEnd);
        fab.addEventListener('pointercancel', fabEnd);
        window.addEventListener('resize', () => { if (fab.classList.contains('show')) clampFab(true); });

        let statusTimer = null;
        function flash(msg, isErr) {
            status.textContent = msg; status.classList.toggle('err', !!isErr);
            if (statusTimer) clearTimeout(statusTimer);
            if (!isErr && msg) statusTimer = setTimeout(() => { status.textContent = ''; }, 2500);
        }

        let lastResult = '';
        function renderResult(textRaw) {
            lastResult = textRaw;
            const esc = textRaw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            out.innerHTML = esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');
            out.classList.add('show'); insertBtn.classList.add('show'); outbtns.classList.add('show');
            setTimeout(() => { if (wireUp._clamp) wireUp._clamp(false); }, 0);
        }

        function run() {
            const d = dialogue.value, a = action.value;
            if (!d.trim() && !a.trim()) { flash('대사나 행동 중 하나는 입력해 주세요.', true); return; }
            goBtn.disabled = true;
            out.classList.remove('show'); insertBtn.classList.remove('show'); outbtns.classList.remove('show');
            flash('늘리는 중… ✍️');
            callGemini(d, a,
                (result, truncated) => { renderResult(result); flash(truncated ? '한도에 걸려 끝이 잘렸어요. "짧게"로 바꾸거나 다시 뽑아보세요 ⚠️' : '', !!truncated); goBtn.disabled = false; },
                (err)    => { flash(err, true); goBtn.disabled = false; });
        }
        goBtn.addEventListener('click', run);
        $('#se-retry').addEventListener('click', run);

        [dialogue, action].forEach(ta => ta.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
        }));

        function copyToClipboard(txt, ok, fail) {
            (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
                .then(ok)
                .catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = txt; document.body.appendChild(ta); ta.select();
                    try { document.execCommand('copy'); ok(); } catch (_) { fail(); }
                    document.body.removeChild(ta);
                });
        }
        insertBtn.addEventListener('click', () => {
            if (!lastResult) return;
            if (insertIntoChat(lastResult)) flash('채팅창에 넣었어요 💬');
            else copyToClipboard(lastResult,
                () => flash('채팅창을 못 찾아서 복사했어요. 붙여넣기 해주세요 📋', true),
                () => flash('채팅창을 못 찾았어요 😢', true));
        });
        $('#se-copy').addEventListener('click', () => {
            copyToClipboard(lastResult, () => flash('복사 완료 📋'), () => flash('복사 실패 😢', true));
        });

        // 패널을 항상 화면 안에 가두기 (모바일 주소창/키보드/회전 대응)
        function clampIntoView(savePos) {
            const w = panel.offsetWidth, h = panel.offsetHeight;
            let l = parseFloat(panel.style.left);
            let t = parseFloat(panel.style.top);
            const r = panel.getBoundingClientRect();
            if (isNaN(l)) l = r.left;
            if (isNaN(t)) t = r.top;
            const maxL = Math.max(0, window.innerWidth - w);
            const maxT = Math.max(0, window.innerHeight - h);
            l = Math.max(0, Math.min(l, maxL));
            t = Math.max(0, Math.min(t, maxT));
            panel.style.left = l + 'px';
            panel.style.top = t + 'px';
            panel.style.right = 'auto';
            if (savePos) GM_setValue(K_POS, { left: l, top: t });
        }
        wireUp._clamp = clampIntoView;

        const head = $('#se-head');
        let dragging = false, offX = 0, offY = 0, activeId = null;

        head.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            dragging = true; activeId = e.pointerId; head.classList.add('dragging');
            const r = panel.getBoundingClientRect();
            offX = e.clientX - r.left; offY = e.clientY - r.top;
            panel.style.right = 'auto';
            try { head.setPointerCapture(e.pointerId); } catch (_) {}
            e.preventDefault();
        });
        head.addEventListener('pointermove', (e) => {
            if (!dragging || e.pointerId !== activeId) return;
            let l = e.clientX - offX, t = e.clientY - offY;
            l = Math.max(0, Math.min(l, window.innerWidth - panel.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - panel.offsetHeight));
            panel.style.left = l + 'px'; panel.style.top = t + 'px';
            e.preventDefault();
        });
        function endDrag(e) {
            if (!dragging) return;
            if (e && e.pointerId != null && e.pointerId !== activeId) return;
            dragging = false; activeId = null; head.classList.remove('dragging');
            const r = panel.getBoundingClientRect();
            GM_setValue(K_POS, { left: r.left, top: r.top });
        }
        head.addEventListener('pointerup', endDrag);
        head.addEventListener('pointercancel', endDrag);

        // 화면 크기·회전·키보드 변화 시 패널을 다시 화면 안으로
        window.addEventListener('resize', () => clampIntoView(true));
        window.addEventListener('orientationchange', () => setTimeout(() => clampIntoView(true), 300));
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => clampIntoView(false));
        }

        // 첫 렌더 직후, 저장된 위치가 화면 밖이면 끌어오기
        setTimeout(() => clampIntoView(false), 0);
    }

    function init() { if (document.getElementById('se-panel')) return; injectStyle(); buildUI(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
