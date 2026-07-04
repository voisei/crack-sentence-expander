// ==UserScript==
// @name         크랙 문장 부풀리기 (Gemini)
// @namespace    https://crack.wrtn.ai
// @version      6.10.5
// @author       me
// @description  대사칸/행동칸 분리, 페르소나/문체 다중 저장, 1인칭/3인칭 전환, 최근 대화 맥락 참고, 채팅방별 최근 대화 캐시, 크랙 요약 메모리 자동 참고, 크랙 채팅창 직접 입력.
// @match        https://crack.wrtn.ai/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// @homepageURL  https://github.com/voisei/crack-sentence-expander
// @supportURL   https://github.com/voisei/crack-sentence-expander/issues
// @updateURL    https://raw.githubusercontent.com/voisei/crack-sentence-expander/refs/heads/main/crack-sentence-expander.user.js
// @downloadURL  https://raw.githubusercontent.com/voisei/crack-sentence-expander/refs/heads/main/crack-sentence-expander.user.js
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
    const K_OPEN      = 'se_panel_open';

    const K_STYLE     = 'se_style';
    const K_STYLES    = 'se_styles';

    const K_CTX_ON    = 'se_ctx_on';
    const K_CTX_N     = 'se_ctx_n';
    const K_CTX_SEL   = 'se_ctx_sel';
    const K_CTX_CACHE_BASE = 'se_ctx_cache_by_room';

    const K_MEMORY_ON   = 'se_crack_memory_on';
    const K_MEMORY_AUTO = 'se_crack_memory_auto';
    const K_MEMORY_TEXT = 'se_crack_memory_text';

    const K_PERSONA_HINT = 'se_persona_hint';

    const K_COST_ON = 'se_cost_on';
    const K_COST_USDKRW = 'se_cost_usdkrw';
    const K_COST_TOTAL_USD = 'se_cost_total_usd';
    const K_COST_TOTAL_IN = 'se_cost_total_input_tokens';
    const K_COST_TOTAL_OUT = 'se_cost_total_output_tokens';
    const K_COST_REQ_COUNT = 'se_cost_request_count';
    const K_COST_LOG = 'se_cost_log';

    const STYLE_SLOTS = 3;
    const PERSONA_SLOTS = 3;
    const CTX_CACHE_LIMIT = 300;

    const DEFAULT_MODELS = [
        { id: 'gemini-3.5-flash',       label: 'Gemini 3.5 Flash' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview' },
        { id: 'gemini-3.1-flash-lite',  label: 'Gemini 3.1 Flash-Lite' },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
        { id: 'gemini-2.5-flash',       label: 'Gemini 2.5 Flash' },
        { id: 'gemini-2.5-pro',         label: 'Gemini 2.5 Pro' },
    ];

    const LENGTHS = {
        three:  { label: '세줄', guide: '대사와 서술을 합쳐 3문장 안팎으로, 짧고 압축적으로.' },
        short:  { label: '짧게', guide: '간결하게, 핵심만 살짝 살을 붙여서.' },
        medium: { label: '중간', guide: '감각 묘사와 감정을 적당히 풀어서 자연스러운 분량으로.' },
        long:   { label: '길게', guide: '풍부한 문학적 묘사와 내면 묘사를 충분히 펼쳐서 길게.' },
    };

    function buildPrompt(dialogue, action, lengthKey, persona, pov, name, style, context, crackMemory) {
        const lenGuide = (LENGTHS[lengthKey] || LENGTHS.medium).guide;
        const isThird = pov === 'third';

        const lines = [
            '너는 롤플레이(캐릭터 채팅)에서 "유저 캐릭터"의 이번 대사와 행동을 문학적으로 확장하는 글쓰기 보조다.',
            '중요: 너는 새로운 장면을 처음부터 쓰는 작가가 아니라, 크랙/상대 캐릭터가 방금 출력한 내용에 이어 유저 캐릭터가 받아치는 답변을 만들어야 한다.',
            '중요: 이번 출력은 유저가 이전에 보낸 문장을 계속 늘려 쓰는 것이 아니다. 직전 크랙/상대 출력에 대한 현재 반응이어야 한다.',
            '중요: 이미 진행 중인 행동은 절대 시작 전으로 되감지 않는다. 현재 진행 중인 순간부터 이어 쓴다.',
            '입력은 두 칸으로 들어온다: [대사] 칸과 [행동] 칸. 둘 중 하나가 비어 있을 수 있다.',
            '아래 규칙을 반드시 지켜라.',
        ];

        if (persona && persona.trim()) {
            lines.push('');
            lines.push('[유저 캐릭터의 페르소나 — 기본 설정일 뿐, 현재 상태가 아님]');
            lines.push(persona.trim());
            lines.push('- 위 페르소나는 캐릭터의 기본 성격·말투·가치관·배경·평소 습관이다.');
            lines.push('- 페르소나에 적힌 외모·상태·차림·소지품·기분 등은 "평소의 기본값"일 뿐, 지금 이 순간의 사실로 단정하지 마라.');
            lines.push('- 현재 상태, 옷차림, 노출 정도, 청결 상태, 자세, 위치, 소지품은 항상 [직전 채팅 맥락]과 이번 [행동]/[대사]를 우선한다.');
            lines.push('- 페르소나 내용이 [직전 채팅 맥락]이나 이번 [행동]/[대사]와 어긋나면, 반드시 더 최근 상황을 따른다.');
            lines.push('- 예: 페르소나에 "평소 지저분하다"가 있어도, 방금 씻었거나 옷을 갈아입은 맥락이면 그 순간엔 깨끗한 상태로 묘사한다.');
            lines.push('- 예: 페르소나에 "평소 메리야스를 입는다"가 있어도, 방금 샤워하고 나왔거나 벗고 있거나 수건만 걸친 맥락이면 메리야스를 입었다고 묘사하지 마라.');
            lines.push('- 예: 페르소나에 특정 옷차림이 적혀 있어도, 최근 대화에서 벗었다/갈아입었다/젖었다/찢어졌다/벗겨졌다/입었다는 변화가 있으면 그 변화 후의 상태를 현재 상태로 유지하라.');
            lines.push('- 현재 장면에 없는 옷, 장신구, 소지품을 페르소나에 있다는 이유만으로 새로 착용시키거나 들려주지 마라.');
            lines.push('- 설정을 본문에 그대로 나열·설명하지 말고 자연스럽게 녹여라.');
        }

        if (style && style.trim()) {
            lines.push('');
            lines.push('[문체 규칙 — 사용자가 직접 지정함, 매우 중요]');
            lines.push(style.trim());
            lines.push('- 위 문체 규칙을 다른 어떤 규칙보다 우선해서 최대한 지켜라.');
            lines.push('- 단, 따옴표=대사 / 별표=서술 형식, 시점 규칙, 상대 캐릭터를 대신 쓰지 않는 규칙은 절대 깨지 마라.');
        }

        if (crackMemory && crackMemory.trim()) {
            lines.push('');
            lines.push('[크랙 요약 메모리 — 장기 기억/단기 기억/관계도/목표]');
            lines.push(crackMemory.trim());
            lines.push('- 위 내용은 크랙이 정리한 기억이다. 현재 장면의 배경 기억으로 참고하라.');
            lines.push('- 단, 본문에 그대로 복붙하거나 설명문처럼 읊지 마라.');
            lines.push('- 필요한 경우 관계성, 거리감, 감정선, 이전 사건의 여파, 목표를 자연스럽게 반영하라.');
            lines.push('- 요약 메모리와 [직전 채팅 맥락]이 어긋나면, 더 최근 상황인 직전 채팅 맥락을 우선한다.');
            lines.push('- 이번 출력은 어디까지나 유저 캐릭터의 이번 [대사]/[행동]만 확장하는 것이다.');
        }

        if (context && context.length) {
            lines.push('');
            lines.push('[직전 채팅 맥락 — 크랙/상대 캐릭터의 직전 출력 포함, 현재 상황의 최우선 근거]');
            lines.push('아래는 화면에서 읽은 최근 채팅 흐름이다. 위가 과거, 아래가 최신이다.');
            lines.push('여기에는 유저가 전에 보낸 말뿐 아니라, 크랙/상대 캐릭터가 방금 출력한 대사·행동·상황도 포함된다.');
            lines.push('가장 중요한 목적은 "유저가 전에 쓴 문장 이어쓰기"가 아니라, "크랙/상대 캐릭터의 직전 출력에 유저 캐릭터가 반응하는 티키타카"를 만드는 것이다.');

            context.forEach((m, i) => {
                if (i === context.length - 1) {
                    lines.push('  · [가장 최신 맥락 / 직전 크랙 출력일 가능성 높음] ' + m);
                } else {
                    lines.push('  · [이전 흐름] ' + m);
                }
            });

            lines.push('- 최신 맥락에서 크랙/상대 캐릭터가 방금 한 말, 질문, 행동, 표정, 분위기, 감정선을 찾아 가장 우선적으로 반응하라.');
            lines.push('- 상대가 방금 질문했으면 그 질문에 답하고, 상대가 행동했으면 그 행동을 보고 반응하고, 상대가 감정을 드러냈으면 그 감정선을 받아서 이어라.');
            lines.push('- 직전 크랙 출력에서 이미 벌어진 일은 현재 사실로 인정하고 이어간다.');
            lines.push('- 유저가 이전에 보낸 문장이나 행동을 다시 반복하거나 계속 늘어뜨리지 마라.');
            lines.push('- 이번 [대사]/[행동]은 직전 크랙 출력에 대한 현재 반응으로 해석하라.');
            lines.push('- 맥락에 있는 상대 캐릭터의 말·행동·상태를 무시하지 마라.');
            lines.push('- 맥락은 "지금 이 순간"의 상황을 알려주는 가장 신뢰할 근거다. 페르소나나 요약 메모리와 충돌하면 이 맥락을 따른다.');
            lines.push('- 단, 상대 캐릭터/크랙의 다음 대사·행동·감정·생각은 새로 쓰지 마라.');
            lines.push('- 이미 출력된 직전 크랙 내용에 유저 캐릭터가 반응하는 것까지만 허용한다.');
            lines.push('- 오직 유저 캐릭터의 이번 [대사]/[행동]만 확장한다.');
        }

        lines.push('');
        lines.push('[시점]');
        if (isThird) {
            lines.push('- 3인칭 시점으로 쓴다.');
            lines.push('- 유저 캐릭터를 ' + (name && name.trim()
                ? '"' + name.trim() + '"라는 이름 또는 그/그녀로'
                : '"그/그녀" 같은 3인칭 대명사로') + ' 지칭한다.');
            lines.push('- "나/내가"로 쓰지 마라.');
            lines.push('- 장면을 풍부하게 하기 위해 새로운 단역·배경 NPC의 아주 짧은 묘사는 허용한다.');
            lines.push('- 단, 주요 캐릭터, 유저의 상대역, 메인 등장인물의 대사·행동·감정·생각·반응은 절대 쓰지 마라.');
            lines.push('- 어떤 인물이 주요 캐릭터인지 애매하면 주요 캐릭터로 간주하고 건드리지 마라.');
        } else {
            lines.push('- 1인칭 시점으로 쓴다. "나/내가"로 서술한다.');
            lines.push('- 상대 캐릭터와 모든 NPC의 대사·행동·감정·반응·생각은 절대 대신 쓰지 마라.');
            lines.push('- 오직 내가 말하고, 내가 느끼고, 내가 행동한 것만 쓴다.');
        }

        lines.push('');
        lines.push('[대사 칸 처리]');
        lines.push('- [대사] 칸은 유저 캐릭터가 실제로 입으로 말하는 내용이다.');
        lines.push('- 의미는 유지하되, 직전 크랙/상대 출력에 자연스럽게 반응하는 말투로 다듬어 큰따옴표 "..." 로 감싸 출력한다.');
        lines.push('- [대사]가 짧아도 직전 상황에 맞게 감정과 뉘앙스를 살려라.');
        lines.push('- 없는 정보, 새로운 설정, 상대의 반응을 새로 지어내지 마라.');

        lines.push('');
        lines.push('[행동 칸 처리 — 가장 중요]');
        lines.push('- [행동] 칸은 유저 캐릭터가 무엇을 하는지에 대한 지시/의도이자, 현재 장면에서 이미 벌어지고 있는 상태일 수 있다.');
        lines.push('- 행동 입력이 "~하고 있다", "~하는 중", "~먹고 있음", "~앉아 있음", "~누워 있음", "~입고 있음", "~벗고 있음"처럼 진행형/상태형이면, 그 행동을 새로 시작하지 말고 이미 진행 중인 현재 상태로 묘사하라.');
        lines.push('- 예: "밥을 먹고 있어"는 밥을 차리거나 숟가락을 드는 시작 장면이 아니라, 이미 밥을 먹는 중인 장면이다. 입안에 밥이 있거나, 숟가락을 내려놓거나, 씹고 삼키는 현재 순간부터 묘사하라.');
        lines.push('- 예: "침대에 누워 있어"는 침대로 걸어가 눕는 장면이 아니라, 이미 침대에 누운 상태에서 몸을 뒤척이거나 시선을 돌리는 장면으로 써라.');
        lines.push('- 예: "샤워하고 나왔어"는 샤워하러 들어가는 장면이 아니라, 이미 샤워를 끝내고 나온 직후의 젖은 머리, 물기, 수건, 깨끗한 상태를 묘사하라.');
        lines.push('- 예: "옷을 벗고 있어"는 갑자기 평소 옷차림으로 되돌리지 말고, 이미 벗었거나 벗는 중인 현재 노출/착의 상태를 유지하라.');
        lines.push('- 행동 입력이 단순 동사형이라도, 직전 크랙/상대 출력에서 이미 그 행동이 시작되었거나 진행 중이면 현재 진행 상태를 우선한다.');
        lines.push('- 그 행동을 실제로 수행하는 장면으로 *별표* 지문으로 묘사하라.');
        lines.push('- 절대로 그 지시문을 명령형 대사로 바꾸지 마라.');
        lines.push('- 누군가가 그것을 소리내어 말하게 하지도 마라.');
        lines.push('- 행동 내용이 추상적이면, 직전 크랙/상대 출력에 맞춰 그 행동의 구체적인 내용을 자연스럽게 채워라.');
        lines.push('- 단, 행동의 시간축을 과거로 되감지 마라. 이미 진행 중인 행동을 준비 단계나 시작 전 상황으로 되돌리지 마라.');
        lines.push('- 단, 행동의 범위를 넘어 새로운 사건을 크게 만들지 마라.');

        lines.push('');
        lines.push('[현재 상태 유지 규칙]');
        lines.push('- 직전 맥락에서 바뀐 상태는 계속 유지한다.');
        lines.push('- 샤워함/젖음/말림/갈아입음/벗음/입음/누움/앉음/다침/울음/화남/취함/피곤함/먹는 중/마시는 중 같은 최신 상태 변화를 잊지 마라.');
        lines.push('- 현재 행동이 이미 진행 중이면 그 행동의 시작 전으로 되감지 마라. 준비 과정, 이동 과정, 시작 동작을 새로 만들지 말고 현재 진행 중인 순간부터 이어라.');
        lines.push('- "먹고 있다/마시고 있다/입고 있다/벗고 있다/누워 있다/앉아 있다/울고 있다/웃고 있다/기다리고 있다" 같은 상태형 표현은 현재 사실로 고정한다.');
        lines.push('- 예: 밥을 먹고 있는 맥락이면 밥을 차리는 장면, 숟가락을 처음 드는 장면, 식탁 앞에 앉기 전 장면으로 돌아가지 마라.');
        lines.push('- 예: 이미 상대 앞에 서 있는 맥락이면 문을 열고 들어오는 장면부터 다시 쓰지 마라.');
        lines.push('- 옷차림은 특히 조심하라. 페르소나의 평소 옷차림보다 최근 맥락의 착용/탈의 상태가 항상 우선이다.');
        lines.push('- 최근 맥락에 없는 옷을 갑자기 입히지 마라.');
        lines.push('- 최근 맥락상 벗고 있거나 수건만 두른 상태라면, 페르소나에 적힌 평소 옷을 자동으로 입히지 마라.');
        lines.push('- 최근 맥락상 깨끗해졌다면 더럽다/냄새난다/헝클어졌다는 식으로 되돌리지 마라.');
        lines.push('- 반대로 최근 맥락상 더럽거나 젖거나 다친 상태라면 갑자기 멀쩡하고 단정한 상태로 만들지 마라.');

        lines.push('');
        lines.push('[공통 규칙]');
        lines.push('- 새로운 사건·설정을 멋대로 키우지 말고, 입력이 담은 행동·의도의 범위 안에서만 살을 붙인다.');
        lines.push('- 대사는 큰따옴표 "...", 지문·행동·감정·감각 묘사는 *별표*로 감싼다.');
        lines.push('- 대사와 행동이 둘 다 있으면 서술과 대사를 자연스럽게 번갈아 섞어라.');
        lines.push('- 서술이 대사 앞·중간·뒤 어디에 와도 좋다.');
        lines.push('- 한 대사를 둘로 쪼개 사이에 짧은 서술을 끼워 넣어도 좋다.');
        lines.push('- 다만 따옴표와 별표 형식 자체는 항상 지킨다.');
        lines.push('- 직전 크랙 출력과 감정선이 이어지는 느낌을 최우선으로 한다.');
        lines.push('- 상대의 말에 대답하지 않고 혼잣말처럼 엉뚱하게 새 장면을 시작하지 마라.');

        lines.push('');
        lines.push('[절대 금지]');
        lines.push('- 같은 문장이나 같은 표현·구절을 반복하지 마라.');
        lines.push('- 비슷한 의미라도 앞에서 이미 쓴 묘사·문장 구조를 또 쓰지 마라.');
        lines.push('- 동어 반복이나 같은 행동·감정의 재탕을 하지 마라.');
        lines.push('- 유저가 이전에 보낸 문장을 계속 이어 쓰지 마라. 반드시 직전 크랙/상대 출력에 대한 현재 반응으로 써라.');
        lines.push('- 이미 진행 중인 행동을 시작 전 상황으로 되감지 마라. 예: 밥을 먹고 있는데 밥을 차리거나 먹기 전 망설이는 장면부터 쓰지 마라.');
        lines.push('- 페르소나·문체 규칙·이름·설정·크랙 요약 메모리를 본문에서 그대로 읊거나 설명하지 마라.');
        lines.push('- 페르소나의 평소 옷차림·청결 상태·소지품을 최근 상황과 충돌하게 되살리지 마라. 예: 샤워 후 벗고 있는데 메리야스를 입었다고 묘사.');
        lines.push('- 페르소나의 "평소 상태"를 최근 상황과 충돌하게 억지로 끼워 넣지 마라.');
        lines.push('- 입력에 없는 자기소개·배경 설명을 끼워 넣지 마라.');
        lines.push('- 상대 캐릭터의 다음 대사, 다음 행동, 속마음, 감정, 반응을 쓰지 마라.');
        lines.push('- 크랙/상대 캐릭터가 앞으로 어떻게 반응할지 예측해서 쓰지 마라.');
        lines.push('- 길이를 채우려고 했던 말을 늘려 반복하지 마라.');
        lines.push('- 늘릴 내용이 없으면 차라리 짧게 끝내라.');
        lines.push('- 길이: ' + lenGuide);

        lines.push('');
        lines.push('[줄바꿈 형식]');
        lines.push('- 서술(*별표*) 묶음과 대사("따옴표") 묶음은 각각 줄을 바꿔 쓴다.');
        lines.push('- 서로 다른 묶음 사이에는 반드시 빈 줄 한 칸을 넣어 분리한다.');
        lines.push('- 한 줄에 서술과 대사를 붙여 쓰지 마라.');
        lines.push('- 예시:');
        lines.push('    *나는 잠시 숨을 고르듯 눈을 내리깔았다.*');
        lines.push('');
        lines.push('    "그러니까, 방금 네가 한 말이... 진심이라는 거야?"');
        lines.push('');
        lines.push('    *말끝이 조금 흔들렸지만, 시선만큼은 피하지 않았다.*');

        lines.push('');
        lines.push('[출력 규칙]');
        lines.push('- 설명·머리말·해설 없이 완성된 본문 텍스트만 출력한다.');
        lines.push('- 전체를 따옴표나 코드블록으로 감싸지 마라.');

        const system = lines.join('\n');

        const user = [
            '[대사]',
            dialogue.trim() || '(없음)',
            '',
            '[행동]',
            action.trim() || '(없음)',
            '',
            '위 규칙대로 직전 크랙/상대 출력에 이어지는 유저 캐릭터의 이번 반응 본문만 출력해줘.'
        ].join('\n');

        return { system, user };
    }


    function fetchModels(onDone, onErr) {
        const apiKey = GM_getValue(K_APIKEY, '');

        if (!apiKey) {
            onErr('API 키를 먼저 넣고 저장해 주세요.');
            return;
        }

        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(apiKey),
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) {
                    onErr('목록 조회 실패 (' + res.status + ')');
                    return;
                }

                try {
                    const data = JSON.parse(res.responseText);
                    const models = (data.models || [])
                        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
                        .filter(m => /gemini/i.test(m.name || ''))
                        .map(m => ({
                            id: (m.name || '').replace(/^models\//, ''),
                            label: m.displayName || (m.name || '').replace(/^models\//, '')
                        }));

                    if (!models.length) {
                        onErr('쓸 수 있는 모델이 없어요.');
                        return;
                    }

                    onDone(models);
                } catch (e) {
                    onErr('목록을 읽지 못했어요.');
                }
            },
            onerror: function () {
                onErr('네트워크 오류예요.');
            },
            timeout: 30000,
            ontimeout: function () {
                onErr('시간 초과예요.');
            },
        });
    }

    function getPersonaSlots() {
        let arr = GM_getValue(K_PERSONAS, null);

        if (!Array.isArray(arr)) {
            const legacy = GM_getValue(K_PERSONA, '');
            arr = [];

            for (let i = 0; i < PERSONA_SLOTS; i++) {
                arr.push({
                    on: i === 0 && !!(legacy && legacy.trim()),
                    name: '페르소나 ' + (i + 1),
                    text: i === 0 ? (legacy || '') : ''
                });
            }
        }

        return arr;
    }

    function getActivePersona() {
        return getPersonaSlots()
            .filter(s => s && s.on && s.text && s.text.trim())
            .map(s => ((s.name && s.name.trim()) ? '【' + s.name.trim() + '】 ' : '') + s.text.trim())
            .join('\n');
    }

    function getStyleSlots() {
        let arr = GM_getValue(K_STYLES, null);

        if (!Array.isArray(arr)) {
            const legacy = GM_getValue(K_STYLE, '');
            arr = [];

            for (let i = 0; i < STYLE_SLOTS; i++) {
                arr.push({
                    on: i === 0 && !!(legacy && legacy.trim()),
                    name: '문체 ' + (i + 1),
                    text: i === 0 ? (legacy || '') : ''
                });
            }
        }

        return arr;
    }

    function getActiveStyle() {
        return getStyleSlots()
            .filter(s => s && s.on && s.text && s.text.trim())
            .map(s => ((s.name && s.name.trim()) ? '(' + s.name.trim() + ') ' : '') + s.text.trim())
            .join('\n');
    }

    function isVisible(el) {
        if (!el) return false;

        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 12) return false;

        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;

        return true;
    }

    function cleanContextLine(t) {
        return (t || '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isBadContextLine(line) {
        if (!line) return true;

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
        ]);

        if (bannedExact.has(line)) return true;
        if (/^✨?\s*문장 부풀리기/.test(line)) return true;
        if (/Gemini API|API 키|모델|페르소나|문체 규칙/.test(line)) return true;
        if (/최근 대화 맥락 참고|맥락 미리보기|요약 메모리/.test(line)) return true;
        if (/현재 화면에서 메모리 가져오기|프롬프트에 참고시키기/.test(line)) return true;
        if (/사용 가능한 모델 불러오기|설정 동기화|내보내기|가져오기/.test(line)) return true;
        if (/^[\s\W_]+$/.test(line)) return true;

        return false;
    }

    function getCurrentChatCacheKey() {
        const path = location.pathname || '';
        const search = location.search || '';
        const hash = location.hash || '';

        return K_CTX_CACHE_BASE + '::' + path + search + hash;
    }

    function getCtxCache() {
        const key = getCurrentChatCacheKey();
        const arr = GM_getValue(key, []);

        return Array.isArray(arr) ? arr : [];
    }

    function saveCtxCache(arr) {
        const key = getCurrentChatCacheKey();

        GM_setValue(key, arr.slice(-CTX_CACHE_LIMIT));
    }

    // 스트리밍 중간 조각("안녕","안녕하","안녕하세"…)이 캐시를 오염시키지 않도록,
    // 뒤 항목이 앞 항목을 접두사로 포함하면(=자라나는 중이면) 앞의 짧은 조각을 제거한다.
    function dropStreamingPrefixes(arr) {
        const out = [];

        for (const cur of arr) {
            while (out.length) {
                const last = out[out.length - 1];

                // 마지막에 쌓인 게 현재 줄의 앞부분(접두사)이고, 현재 줄이 그걸 이어붙여 자란 형태면
                // 마지막 조각은 미완성 스트리밍 조각으로 보고 버린다.
                if (cur.length > last.length && cur.startsWith(last)) {
                    out.pop();
                    continue;
                }
                break;
            }
            out.push(cur);
        }

        return out;
    }

    function rememberCtxLines(lines) {
        const old = getCtxCache();
        const seen = new Set(old.slice(-40));
        let merged = old.slice();

        for (const raw of lines || []) {
            const t = cleanContextLine(raw);

            if (!t) continue;
            if (isBadContextLine(t)) continue;
            if (t.length < 2) continue;
            if (t.length > 1200) continue;

            const last = merged[merged.length - 1];

            // 바로 직전과 완전히 같은 줄만 중복 방지
            if (last === t) continue;

            // 너무 최근에 이미 본 줄만 중복 방지
            if (seen.has(t)) continue;

            seen.add(t);
            merged.push(t);
        }

        merged = dropStreamingPrefixes(merged);

        saveCtxCache(merged);
    }

    function clearCtxCache() {
        const key = getCurrentChatCacheKey();

        GM_setValue(key, []);
    }

    function collectChatContextFromDOM(maxN, selector) {
        const inPanel = el => el.closest && el.closest('#se-panel');
        let nodes = [];

        if (selector && selector.trim()) {
            try {
                nodes = Array.from(document.querySelectorAll(selector.trim()));
            } catch (_) {
                nodes = [];
            }

            nodes = nodes.filter(el => !inPanel(el) && isVisible(el));
        }

        // 크랙 UI는 채팅 말풍선/메시지 묶음에 data-message-group-id를 붙인다.
        // 그래서 p/div/span을 막 긁기 전에 이 메시지 묶음을 최우선으로 읽는다.
        if (!nodes.length) {
            nodes = Array.from(document.querySelectorAll('div[data-message-group-id]'))
                .slice(-30)
                .filter(el => !inPanel(el) && isVisible(el));
        }

        // 그래도 못 잡으면 기존 자동 탐색 방식으로 fallback한다.
        if (!nodes.length) {
            const cands = Array.from(document.body.querySelectorAll('p, div, span, li, article'))
                .filter(el => {
                    if (inPanel(el)) return false;
                    if (el.querySelector('textarea, input, button, select')) return false;
                    if (!isVisible(el)) return false;

                    const t = cleanContextLine(el.innerText || '');

                    if (isBadContextLine(t)) return false;

                    return t.length >= 2 && t.length <= 1200;
                });

            nodes = cands.filter(el => !cands.some(o => o !== el && el.contains(o)));
        }

        nodes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

        const out = [];
        const seen = new Set();

        for (const el of nodes) {
            let t = cleanContextLine(el.innerText || '');

            if (!t) continue;
            if (isBadContextLine(t)) continue;
            if (t.length < 2) continue;
            if (t.length > 2000) continue;

            // 메시지 묶음 안에 섞일 수 있는 UI 버튼/메뉴 텍스트를 최대한 제거한다.
            t = t
                .replace(/\b복사\b/g, '')
                .replace(/\b다시 생성\b/g, '')
                .replace(/\b삭제\b/g, '')
                .replace(/\b수정\b/g, '')
                .replace(/\b공유\b/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!t) continue;
            if (isBadContextLine(t)) continue;
            if (seen.has(t)) continue;

            seen.add(t);
            out.push(t);
        }

        return dropStreamingPrefixes(out).slice(-Math.max(1, maxN || 6));
    }

    function collectChatContext(maxN, selector) {
        const n = Math.max(1, maxN || 6);

        let domLines = [];

        try {
            domLines = collectChatContextFromDOM(Math.max(n, 80), selector);
            rememberCtxLines(domLines);
        } catch (_) {
            domLines = [];
        }

        // 지금 화면에 실제로 보이는 대화(순서가 정확함)를 최우선으로 쓴다.
        // 화면에서 아무것도 못 잡았을 때만 캐시를 대체로 사용한다.
        const base = getCtxCache().concat(domLines);

        const merged = [];
        const seen = new Set();

        for (const raw of base) {
            const line = cleanContextLine(raw);

            if (!line) continue;
            if (isBadContextLine(line)) continue;
            if (seen.has(line)) continue;

            seen.add(line);
            merged.push(line);
        }

        return merged.slice(-n);
    }

    function collectCrackMemoryFromPage() {
        const rootCandidates = Array.from(document.querySelectorAll('[role="dialog"], main, section, article, div'))
            .filter(el => {
                if (!isVisible(el)) return false;

                const t = (el.innerText || '').trim();
                if (!t) return false;

                return /요약\s*메모리|장기\s*기억|단기\s*기억|관계도|목표/.test(t);
            });

        let root = null;

        if (rootCandidates.length) {
            rootCandidates.sort((a, b) => {
                const at = (a.innerText || '').length;
                const bt = (b.innerText || '').length;
                return at - bt;
            });

            root = rootCandidates.find(el => {
                const t = (el.innerText || '').trim();
                return t.length >= 20 && t.length <= 12000;
            }) || rootCandidates[0];
        }

        if (!root) return '';

        const rawLines = (root.innerText || '')
            .split(/\n+/)
            .map(s => s.replace(/\s+/g, ' ').trim())
            .filter(Boolean);

        const bannedExact = new Set([
            '요약 메모리',
            '장기 기억',
            '단기 기억',
            '관계도',
            '목표',
            '추가',
            '최신순',
            '오래된순',
            '닫기',
            '확인',
            '취소',
            '저장',
            '삭제',
            '수정',
            '뒤로',
        ]);

        const useful = [];
        const seen = new Set();

        for (const line of rawLines) {
            if (!line) continue;
            if (seen.has(line)) continue;
            seen.add(line);

            if (bannedExact.has(line)) continue;
            if (/^총\s*\d+\s*개$/.test(line)) continue;
            if (/^총\s*\d+개$/.test(line)) continue;
            if (/^더 많은 메시지가 필요해요/.test(line)) continue;
            if (/요약 메모리가 추가되려면/.test(line)) continue;
            if (/^[<>∨⌄⌃^]+$/.test(line)) continue;
            if (line.length < 2) continue;

            useful.push(line);
        }

        if (!useful.length) return '';

        const limited = useful.slice(0, 120);

        return limited.join('\n').trim();
    }

    function getCrackMemoryForPrompt() {
        if (!GM_getValue(K_MEMORY_ON, false)) return '';

        let saved = GM_getValue(K_MEMORY_TEXT, '');

        if (GM_getValue(K_MEMORY_AUTO, true)) {
            try {
                const fresh = collectCrackMemoryFromPage();

                if (fresh && fresh.trim()) {
                    saved = fresh.trim();
                    GM_setValue(K_MEMORY_TEXT, saved);
                }
            } catch (_) {}
        }

        return saved || '';
    }



    function getModelCostRates(modelId, inputTokens) {
        const id = (modelId || '').toLowerCase();
        const inputN = Number(inputTokens || 0);
        const over200k = inputN > 200000;

        // USD / 1,000,000 tokens. Google Gemini Developer API Standard 가격 기준의 추정치.
        // 무료 티어, 캐시, Batch/Flex/Priority, 세금, 실제 청구 환율, 정책 변경은 반영하지 못한다.

        if (id.includes('gemini-3.5-flash')) {
            return { input: 1.50, output: 9.00, label: 'Gemini 3.5 Flash' };
        }

        if (id.includes('gemini-3.1-pro-preview') || id.includes('gemini-3.1-pro')) {
            return {
                input: over200k ? 4.00 : 2.00,
                output: over200k ? 18.00 : 12.00,
                label: over200k ? 'Gemini 3.1 Pro Preview >200K' : 'Gemini 3.1 Pro Preview'
            };
        }

        if (id.includes('gemini-3.1-flash-lite')) {
            return { input: 0.25, output: 1.50, label: 'Gemini 3.1 Flash-Lite' };
        }

        if (id.includes('gemini-3-flash-preview')) {
            return { input: 0.50, output: 3.00, label: 'Gemini 3 Flash Preview' };
        }

        if (id.includes('gemini-2.5-pro')) {
            return {
                input: over200k ? 2.50 : 1.25,
                output: over200k ? 15.00 : 10.00,
                label: over200k ? 'Gemini 2.5 Pro >200K' : 'Gemini 2.5 Pro'
            };
        }

        if (id.includes('gemini-2.5-flash-lite')) {
            return { input: 0.10, output: 0.40, label: 'Gemini 2.5 Flash-Lite' };
        }

        if (id.includes('gemini-2.5-flash')) {
            return { input: 0.30, output: 2.50, label: 'Gemini 2.5 Flash' };
        }

        return { input: 1.50, output: 9.00, label: (modelId || '알 수 없는 모델') + ' · 3.5 Flash 기준 추정' };
    }

    function getUsageTokens(usage) {
        const u = usage || {};
        const input =
            Number(u.promptTokenCount || 0)
            + Number(u.cachedContentTokenCount || 0);

        const output =
            Number(u.candidatesTokenCount || 0)
            + Number(u.thoughtsTokenCount || 0);

        const total = Number(u.totalTokenCount || (input + output) || 0);

        return { input, output, total };
    }

    function estimateCost(modelId, usage) {
        const tokens = getUsageTokens(usage);

        if (!tokens.input && !tokens.output && !tokens.total) return null;

        const rates = getModelCostRates(modelId, tokens.input);
        const usd = ((tokens.input * rates.input) + (tokens.output * rates.output)) / 1000000;
        const usdkrw = Math.max(1, parseFloat(GM_getValue(K_COST_USDKRW, 1400)) || 1400);
        const krw = usd * usdkrw;

        return { tokens, rates, usd, krw, usdkrw };
    }

    function fmtMoney(n) {
        const v = Number(n || 0);
        if (v < 1) return v.toFixed(2);
        if (v < 1000) return v.toFixed(1);
        return Math.round(v).toLocaleString('ko-KR');
    }

    function getCostLog() {
        const raw = GM_getValue(K_COST_LOG, []);
        return Array.isArray(raw) ? raw : [];
    }

    function recordCostUsage(modelId, usage, label) {
        // 비용 추정은 "페르소나 추천"뿐 아니라 이 스크립트가 Gemini API를 호출한 모든 요청을 기록한다.
        // K_COST_ON은 상단 표시 여부만 담당하고, 기록 자체는 항상 누적한다.
        const info = estimateCost(modelId, usage);
        if (!info) return null;

        const oldUsd = parseFloat(GM_getValue(K_COST_TOTAL_USD, 0)) || 0;
        const oldIn = parseInt(GM_getValue(K_COST_TOTAL_IN, 0), 10) || 0;
        const oldOut = parseInt(GM_getValue(K_COST_TOTAL_OUT, 0), 10) || 0;
        const oldReq = parseInt(GM_getValue(K_COST_REQ_COUNT, 0), 10) || 0;

        const totalUsd = oldUsd + info.usd;
        const totalIn = oldIn + info.tokens.input;
        const totalOut = oldOut + info.tokens.output;
        const totalReq = oldReq + 1;

        GM_setValue(K_COST_TOTAL_USD, totalUsd);
        GM_setValue(K_COST_TOTAL_IN, totalIn);
        GM_setValue(K_COST_TOTAL_OUT, totalOut);
        GM_setValue(K_COST_REQ_COUNT, totalReq);

        const totalKrw = totalUsd * info.usdkrw;

        const entry = {
            at: new Date().toLocaleString('ko-KR'),
            label: label || '요청',
            model: modelId || '',
            modelLabel: info.rates.label,
            input: info.tokens.input,
            output: info.tokens.output,
            usd: info.usd,
            krw: info.krw
        };

        const log = getCostLog();
        log.unshift(entry);
        GM_setValue(K_COST_LOG, log.slice(0, 50));

        return {
            ...entry,
            totalUsd,
            totalKrw,
            totalIn,
            totalOut,
            totalReq,
            message: '💸 이번 약 ₩' + fmtMoney(info.krw) + ' / 누적 약 ₩' + fmtMoney(totalKrw)
        };
    }

    function getCostTopText(lastInfo) {
        if (!GM_getValue(K_COST_ON, true)) {
            return '표시 꺼짐 · 비용 기록은 계속 누적 중이에요.';
        }

        const usdkrw = Math.max(1, parseFloat(GM_getValue(K_COST_USDKRW, 1400)) || 1400);
        const totalUsd = parseFloat(GM_getValue(K_COST_TOTAL_USD, 0)) || 0;
        const totalIn = parseInt(GM_getValue(K_COST_TOTAL_IN, 0), 10) || 0;
        const totalOut = parseInt(GM_getValue(K_COST_TOTAL_OUT, 0), 10) || 0;
        const totalReq = parseInt(GM_getValue(K_COST_REQ_COUNT, 0), 10) || 0;
        const totalKrw = totalUsd * usdkrw;

        const last = lastInfo || getCostLog()[0];

        const lines = [
            '누적 약 ₩' + fmtMoney(totalKrw) + ' · 요청 ' + totalReq + '회',
            '입력 ' + totalIn.toLocaleString('ko-KR') + 'tok · 출력 ' + totalOut.toLocaleString('ko-KR') + 'tok'
        ];

        if (last) {
            lines.push('방금/최근: ' + last.label + ' · 약 ₩' + fmtMoney(last.krw));
        }

        return lines.join('\n');
    }

    function getCostSummaryText(lastInfo) {
        const usdkrw = Math.max(1, parseFloat(GM_getValue(K_COST_USDKRW, 1400)) || 1400);
        const totalUsd = parseFloat(GM_getValue(K_COST_TOTAL_USD, 0)) || 0;
        const totalIn = parseInt(GM_getValue(K_COST_TOTAL_IN, 0), 10) || 0;
        const totalOut = parseInt(GM_getValue(K_COST_TOTAL_OUT, 0), 10) || 0;
        const totalReq = parseInt(GM_getValue(K_COST_REQ_COUNT, 0), 10) || 0;
        const totalKrw = totalUsd * usdkrw;
        const log = getCostLog();

        const lines = [];

        lines.push('상단 표시: ' + (GM_getValue(K_COST_ON, true) ? '켜짐' : '꺼짐') + ' · 기록은 모든 Gemini 요청에 누적돼요.');
        lines.push('누적: 약 ₩' + fmtMoney(totalKrw) + ' / $' + totalUsd.toFixed(6));
        lines.push('전체 요청 ' + totalReq + '회 · 입력 ' + totalIn.toLocaleString('ko-KR') + 'tok · 출력 ' + totalOut.toLocaleString('ko-KR') + 'tok');

        if (lastInfo) {
            lines.push('방금: ' + lastInfo.label + ' · ' + lastInfo.modelLabel + ' · 약 ₩' + fmtMoney(lastInfo.krw));
        }

        if (log.length) {
            lines.push('');
            lines.push('최근 사용내역 최대 50건');
            log.slice(0, 20).forEach((x, i) => {
                lines.push(
                    (i + 1) + '. ' + x.at + ' · ' + x.label
                    + ' · ' + x.modelLabel
                    + ' · 입력 ' + Number(x.input || 0).toLocaleString('ko-KR') + 'tok'
                    + ' / 출력 ' + Number(x.output || 0).toLocaleString('ko-KR') + 'tok'
                    + ' · 약 ₩' + fmtMoney(x.krw)
                );
            });

            if (log.length > 20) {
                lines.push('…나머지 ' + (log.length - 20) + '건은 내부에 저장돼요.');
            }
        } else {
            lines.push('');
            lines.push('아직 기록된 요청이 없어요.');
        }

        lines.push('');
        lines.push('※ 문장 부풀리기 + 페르소나 자동추천 둘 다 포함. 무료 티어/캐시/세금/Batch/Flex/Priority/실제 청구 환율은 반영 안 된 Standard 기준 대략값.');

        return lines.join('\n');
    }

    function resetCostStats() {
        GM_setValue(K_COST_TOTAL_USD, 0);
        GM_setValue(K_COST_TOTAL_IN, 0);
        GM_setValue(K_COST_TOTAL_OUT, 0);
        GM_setValue(K_COST_REQ_COUNT, 0);
        GM_setValue(K_COST_LOG, []);
    }

    function collectCrackStoryDetailFromPage() {
        const roots = Array.from(document.querySelectorAll('#story-detail-scroll .wrtn-markdown, #story-detail-scroll'))
            .filter(el => isVisible(el));

        const texts = [];
        const seen = new Set();

        for (const el of roots) {
            let t = (el.innerText || '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!t) continue;
            if (t.length < 10) continue;
            if (t.length > 12000) t = t.slice(0, 12000).trim() + '…';
            if (seen.has(t)) continue;

            seen.add(t);
            texts.push(t);
        }

        return texts.join('\n\n---\n\n').trim();
    }

    function buildPersonaSuggestPrompt(keywords, storyDetail, recentContext) {
        const system = [
            '너는 롤플레이 캐릭터 채팅용 "유저 캐릭터 페르소나"를 만들어주는 설정 보조다.',
            '목표는 제작자 설정, 상세 설명, 프롤로그/시작 상황을 읽고 그 세계관에 자연스럽게 들어맞는 유저 캐릭터 페르소나를 작성하는 것이다.',
            '사용자가 준 키워드를 반드시 반영하되, 제작자 설정과 충돌하지 않게 조정한다.',
            '',
            '[중요 원칙]',
            '- "유저 캐릭터"의 페르소나만 만든다. 상대 캐릭터, 크랙 캐릭터, NPC의 설정을 대신 확정하지 마라.',
            '- 제작자 설정/프롤로그에 이미 있는 사실을 우선한다.',
            '- 사용자가 준 키워드가 제작자 설정과 충돌하면, 충돌하지 않는 방향으로 자연스럽게 완화한다.',
            '- 페르소나는 현재 장면의 고정 상태가 아니라 기본 성격, 배경, 말투, 습관, 관계성 중심으로 쓴다.',
            '- 옷차림, 청결 상태, 자세, 소지품처럼 장면마다 바뀌는 것은 "평소"로만 조심스럽게 적고 현재 사실로 고정하지 않는다.',
            '- 선정적/폭력적/과한 설정을 새로 만들지 말고, 필요한 경우 간접적이고 안전하게 정리한다.',
            '- 한국어로 작성한다.',
            '',
            '[출력 형식]',
            '설명 없이 페르소나 본문만 출력한다.',
            '아래 항목을 자연스럽게 포함하되, 너무 길게 장황하게 쓰지 마라.',
            '- 기본 정보: 나이대, 성별/젠더 표현이 사용자가 준 경우, 직업/신분',
            '- 성격: 핵심 성향 3~5개',
            '- 말투: 대사 톤과 대화 습관',
            '- 배경: 제작자 설정에 맞는 최소한의 과거/직업 배경',
            '- 관계/목표: 현재 시작상황에서 왜 이 장면에 있는지, 무엇을 원하거나 경계하는지',
            '- 금지/주의: 상대 캐릭터의 행동이나 감정을 대신 정하지 않는 방향',
            '',
            '최종 출력은 8~14문장 정도의 한 덩어리 페르소나로 작성한다.'
        ].join('\n');

        const user = [
            '[사용자 키워드]',
            keywords && keywords.trim() ? keywords.trim() : '(없음)',
            '',
            '[크랙 상세 설명/제작자 설정/프롤로그]',
            storyDetail && storyDetail.trim() ? storyDetail.trim() : '(현재 화면에서 읽은 설정 없음)',
            '',
            '[최근 채팅 맥락]',
            recentContext && recentContext.length ? recentContext.map(m => '· ' + m).join('\n') : '(없음)',
            '',
            '위 자료를 바탕으로 유저 페르소나 칸에 넣기 좋은 완성형 페르소나만 출력해줘.'
        ].join('\n');

        return { system, user };
    }

    function callGeminiPersonaSuggest(keywords, onDone, onErr) {
        const apiKey = GM_getValue(K_APIKEY, '');
        const model = GM_getValue(K_MODEL, DEFAULT_MODELS[0].id);

        if (!apiKey) {
            onErr('API 키가 없어요. ⚙️ 설정에서 먼저 넣어주세요.');
            return;
        }

        const storyDetail = collectCrackStoryDetailFromPage();

        let recentContext = [];
        try {
            const n = parseInt(GM_getValue(K_CTX_N, 10), 10) || 10;
            const sel = GM_getValue(K_CTX_SEL, '') || 'div[data-message-group-id]';
            recentContext = collectChatContext(Math.min(Math.max(n, 6), 20), sel);
        } catch (_) {
            recentContext = [];
        }

        if (!storyDetail && !recentContext.length && !(keywords && keywords.trim())) {
            onErr('읽을 설정이나 키워드가 없어요. 크랙 상세 설명/프롤로그 화면을 열거나 키워드를 적어주세요.');
            return;
        }

        const { system, user } = buildPersonaSuggestPrompt(keywords, storyDetail, recentContext);

        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + encodeURIComponent(model)
            + ':generateContent?key='
            + encodeURIComponent(apiKey);

        const body = {
            system_instruction: {
                parts: [{ text: system }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: user }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 8192
            },
        };

        GM_xmlhttpRequest({
            method: 'POST',
            url: endpoint,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(body),
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) {
                    let msg = 'API 에러 (' + res.status + ')';

                    try {
                        const e = JSON.parse(res.responseText);
                        if (e.error && e.error.message) msg += ': ' + e.error.message;
                    } catch (_) {}

                    console.error('[문장 부풀리기] 페르소나 추천 API 에러:', res.responseText);
                    onErr(msg);
                    return;
                }

                try {
                    const data = JSON.parse(res.responseText);
                    const cand = data.candidates && data.candidates[0];

                    if (!cand || !cand.content) {
                        const reason =
                            (cand && cand.finishReason)
                            || (data.promptFeedback && data.promptFeedback.blockReason)
                            || '알 수 없음';

                        onErr('추천 응답이 비어 있어요 (사유: ' + reason + '). 키워드를 조금 바꿔보세요.');
                        return;
                    }

                    const out = (cand.content.parts || [])
                        .map(p => p.text || '')
                        .join('')
                        .trim();

                    if (!out) {
                        onErr('빈 추천이 왔어요. 다시 시도해 주세요.');
                        return;
                    }

                    if (cand.finishReason === 'MAX_TOKENS') {
                        onErr('페르소나가 너무 길어서 중간에 잘렸어요. 키워드를 조금 줄이거나 다시 시도해 주세요.');
                        return;
                    }

                    const costInfo = recordCostUsage(model, data.usageMetadata, '페르소나 추천');
                    onDone(out, costInfo);
                } catch (err) {
                    console.error('[문장 부풀리기] 페르소나 추천 파싱 실패:', err, res.responseText);
                    onErr('추천 응답을 읽지 못했어요. 콘솔을 확인해 주세요.');
                }
            },
            onerror: function () {
                onErr('네트워크 오류예요. 연결을 확인해 주세요.');
            },
            ontimeout: function () {
                onErr('시간 초과예요. 다시 시도해 주세요.');
            },
            timeout: 60000,
        });
    }

    function callGemini(dialogue, action, onDone, onErr) {
        const apiKey = GM_getValue(K_APIKEY, '');
        const model = GM_getValue(K_MODEL, DEFAULT_MODELS[0].id);
        const lengthKey = GM_getValue(K_LENGTH, 'medium');
        const persona = getActivePersona();
        const style = getActiveStyle();
        const pov = GM_getValue(K_POV, 'first');
        const name = GM_getValue(K_NAME, '');
        const crackMemory = getCrackMemoryForPrompt();

        let context = [];

        if (GM_getValue(K_CTX_ON, false)) {
            const n = parseInt(GM_getValue(K_CTX_N, 6), 10) || 6;
            const sel = GM_getValue(K_CTX_SEL, '');

            try {
                context = collectChatContext(n, sel);
            } catch (_) {
                context = [];
            }
        }

        if (!apiKey) {
            onErr('API 키가 없어요. ⚙️ 설정에서 먼저 넣어주세요.');
            return;
        }

        if (!dialogue.trim() && !action.trim()) {
            onErr('대사나 행동 중 하나는 입력해 주세요.');
            return;
        }

        const { system, user } = buildPrompt(dialogue, action, lengthKey, persona, pov, name, style, context, crackMemory);

        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
            + encodeURIComponent(model)
            + ':generateContent?key='
            + encodeURIComponent(apiKey);

        const body = {
            system_instruction: {
                parts: [{ text: system }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [{ text: user }]
                }
            ],
            generationConfig: {
                maxOutputTokens: 8192
            },
        };

        GM_xmlhttpRequest({
            method: 'POST',
            url: endpoint,
            headers: {
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(body),
            onload: function (res) {
                if (res.status < 200 || res.status >= 300) {
                    let msg = 'API 에러 (' + res.status + ')';

                    try {
                        const e = JSON.parse(res.responseText);
                        if (e.error && e.error.message) msg += ': ' + e.error.message;
                    } catch (_) {}

                    console.error('[문장 부풀리기] API 에러 전체 응답:', res.responseText);
                    onErr(msg);
                    return;
                }

                try {
                    const data = JSON.parse(res.responseText);
                    const cand = data.candidates && data.candidates[0];

                    if (!cand || !cand.content) {
                        const reason =
                            (cand && cand.finishReason)
                            || (data.promptFeedback && data.promptFeedback.blockReason)
                            || '알 수 없음';

                        onErr('응답이 비어 있어요 (사유: ' + reason + '). 입력을 바꾸거나 다시 시도해 보세요.');
                        return;
                    }

                    const out = (cand.content.parts || [])
                        .map(p => p.text || '')
                        .join('')
                        .trim();

                    if (!out) {
                        const reason = cand.finishReason || '알 수 없음';

                        if (reason === 'MAX_TOKENS') {
                            onErr('생각하는 데 토큰을 다 써서 본문이 안 나왔어요. "짧게"로 바꾸거나 다시 시도해 주세요.');
                            return;
                        }

                        onErr('빈 응답이 왔어요 (사유: ' + reason + '). 다시 시도해 주세요.');
                        return;
                    }

                    const truncated = cand.finishReason === 'MAX_TOKENS';
                    const costInfo = recordCostUsage(model, data.usageMetadata, '문장 부풀리기');
                    onDone(out, truncated, costInfo);
                } catch (err) {
                    console.error('[문장 부풀리기] 파싱 실패:', err, res.responseText);
                    onErr('응답을 읽지 못했어요. 콘솔을 확인해 주세요.');
                }
            },
            onerror: function () {
                onErr('네트워크 오류예요. 연결을 확인해 주세요.');
            },
            ontimeout: function () {
                onErr('시간 초과예요. 다시 시도해 주세요.');
            },
            timeout: 60000,
        });
    }

    function findChatInput() {
        const inPanel = el => el.closest && el.closest('#se-panel');

        let cands = Array.from(document.querySelectorAll('textarea'))
            .filter(el => !inPanel(el) && isVisible(el));

        if (cands.length) {
            cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
            return cands[0];
        }

        cands = Array.from(document.querySelectorAll('[contenteditable="true"],[contenteditable=""]'))
            .filter(el => !inPanel(el) && isVisible(el));

        if (cands.length) {
            cands.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
            return cands[0];
        }

        return null;
    }

    function setNativeValue(el, value) {
        const proto =
            el.tagName === 'TEXTAREA'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;

        const desc = Object.getOwnPropertyDescriptor(proto, 'value');

        if (desc && desc.set) desc.set.call(el, value);
        else el.value = value;

        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function blurEverything() {
        try {
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }
        } catch (_) {}

        try {
            if (window.getSelection) window.getSelection().removeAllRanges();
        } catch (_) {}
    }

    function insertIntoChat(text) {
        const el = findChatInput();
        if (!el) return false;

        const tag = el.tagName;

        if (tag === 'TEXTAREA' || tag === 'INPUT') {
            setNativeValue(el, text);
            blurEverything();
        } else {
            let ok = false;

            try {
                el.focus();

                const sel = window.getSelection();
                const range = document.createRange();

                range.selectNodeContents(el);
                sel.removeAllRanges();
                sel.addRange(range);

                ok = document.execCommand('insertText', false, text);
            } catch (_) {
                ok = false;
            }

            if (!ok) {
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

            blurEverything();
        }

        return true;
    }

    const CSS = `
    #se-panel, #se-fab {
        position: fixed;
        z-index: 2147483600;
        font-family: 'Pretendard','Noto Sans KR',system-ui,sans-serif;
        box-sizing: border-box;
    }
    #se-panel *, #se-fab * {
        box-sizing: border-box;
    }
    #se-panel {
        width: 350px;
        max-width: calc(100vw - 24px);
        background: #1d1f27;
        color: #e9eaf0;
        border: 1px solid #33384a;
        border-radius: 16px;
        box-shadow: 0 12px 40px rgba(0,0,0,.45);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-size: 13px;
        max-height: calc(100vh - 24px);
        max-height: calc(100dvh - 24px);
    }
    #se-head {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        cursor: grab;
        user-select: none;
        touch-action: none;
        -webkit-user-select: none;
        background: linear-gradient(135deg,#2a2d3a,#23262f);
        border-bottom: 1px solid #33384a;
    }
    #se-head.dragging {
        cursor: grabbing;
    }
    #se-title {
        font-weight: 700;
        font-size: 13px;
        flex: 1;
        letter-spacing: -.2px;
    }
    #se-head button {
        background: transparent;
        border: none;
        color: #b9bcca;
        cursor: pointer;
        font-size: 15px;
        padding: 2px 5px;
        border-radius: 6px;
        line-height: 1;
    }
    #se-head button:hover {
        background: #3a3f52;
        color: #fff;
    }
    #se-body {
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 9px;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        flex: 1 1 auto;
        min-height: 0;
    }
    .se-field-label {
        font-size: 11px;
        font-weight: 700;
        color: #9aa0b4;
        margin: 0 0 -4px 2px;
        letter-spacing: -.2px;
    }
    .se-ta {
        width: 100%;
        min-height: 48px;
        max-height: 160px;
        resize: vertical;
        background: #14161c;
        color: #e9eaf0;
        border: 1px solid #33384a;
        border-radius: 10px;
        padding: 9px;
        font-size: 13px;
        line-height: 1.5;
        font-family: inherit;
    }
    .se-ta:focus {
        outline: none;
        border-color: #6c7bff;
    }
    #se-dialogue {
        border-left: 3px solid #5fd0c3;
    }
    #se-action {
        border-left: 3px solid #c8a6ff;
    }
    .se-segwrap {
        display: flex;
        gap: 6px;
    }
    .se-seg {
        display: flex;
        gap: 4px;
        background: #14161c;
        padding: 3px;
        border-radius: 10px;
        flex: 1;
    }
    .se-seg button {
        flex: 1;
        background: transparent;
        border: none;
        color: #9aa0b4;
        padding: 6px 0;
        border-radius: 7px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    }
    .se-seg button.active {
        background: #3a3f52;
        color: #fff;
    }
    #se-pov button.active {
        background: #4a3f6b;
        color: #e7defb;
    }
    #se-go {
        width: 100%;
        padding: 11px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        background: linear-gradient(135deg,#6c7bff,#8a5cff);
        color: #fff;
        font-size: 13px;
        font-weight: 700;
        letter-spacing: -.2px;
    }
    #se-go:hover {
        filter: brightness(1.08);
    }
    #se-go:disabled {
        opacity: .6;
        cursor: default;
    }
    #se-out {
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.65;
        background: #14161c;
        border: 1px solid #33384a;
        border-radius: 10px;
        padding: 11px;
        min-height: 40px;
        max-height: 45vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        font-size: 13px;
        display: none;
    }
    #se-out.show {
        display: block;
    }
    #se-out em {
        color: #c8bdff;
        font-style: italic;
    }
    #se-insert {
        width: 100%;
        padding: 10px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        background: linear-gradient(135deg,#3ecf8e,#2fb3c0);
        color: #07241c;
        font-size: 13px;
        font-weight: 800;
        display: none;
    }
    #se-insert.show {
        display: block;
    }
    #se-insert:hover {
        filter: brightness(1.06);
    }
    #se-outbtns {
        display: none;
        gap: 6px;
    }
    #se-outbtns.show {
        display: flex;
    }
    #se-outbtns button {
        flex: 1;
        padding: 8px;
        border: 1px solid #33384a;
        border-radius: 9px;
        background: #23262f;
        color: #e9eaf0;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
    }
    #se-outbtns button:hover {
        background: #2d3140;
    }
    #se-status {
        font-size: 12px;
        color: #9aa0b4;
        min-height: 16px;
    }
    #se-status.err {
        color: #ff8a8a;
    }

    #se-cost-top-wrap {
        border: 1px solid rgba(244, 114, 182, .34);
        border-radius: 13px;
        padding: 8px 10px;
        background: rgba(244, 114, 182, .085);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .se-cost-top-title {
        font-size: 12px;
        font-weight: 850;
        color: #ffd3ea;
    }
    #se-cost-top-status {
        white-space: pre-wrap;
        line-height: 1.45;
        font-size: 11px;
        color: #f5f7ff;
    }
    .se-section-note {
        color: #9aa0b4;
        font-size: 11px;
        line-height: 1.45;
        padding: 2px 2px 4px;
    }
    .se-section {
        border: 1px solid rgba(148, 163, 184, .22);
        border-radius: 12px;
        overflow: hidden;
        background: rgba(255, 255, 255, .035);
    }
    .se-section + .se-section {
        margin-top: 2px;
    }
    .se-section > summary {
        list-style: none;
        cursor: pointer;
        user-select: none;
        padding: 10px 11px;
        font-size: 13px;
        font-weight: 750;
        color: #f2f5ff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .se-section > summary::-webkit-details-marker {
        display: none;
    }
    .se-section > summary::after {
        content: '열기';
        font-size: 11px;
        font-weight: 650;
        color: #9aa0b4;
        border: 1px solid rgba(148, 163, 184, .28);
        border-radius: 999px;
        padding: 2px 7px;
        flex: 0 0 auto;
    }
    .se-section[open] > summary {
        border-bottom: 1px solid rgba(148, 163, 184, .18);
        background: rgba(255, 255, 255, .035);
    }
    .se-section[open] > summary::after {
        content: '닫기';
    }
    .se-section-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 9px;
    }

    #se-settings {
        display: none;
        flex-direction: column;
        gap: 9px;
        padding: 12px;
        border-top: 1px solid #33384a;
        background: #191b22;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        min-height: 0;
    }
    #se-settings.show {
        display: flex;
    }
    #se-settings label {
        font-size: 12px;
        color: #b9bcca;
        font-weight: 600;
    }
    #se-settings input,
    #se-settings select,
    #se-settings textarea {
        width: 100%;
        background: #14161c;
        color: #e9eaf0;
        border: 1px solid #33384a;
        border-radius: 9px;
        padding: 9px;
        font-size: 13px;
        font-family: inherit;
    }
    .se-style-ta {
        min-height: 50px !important;
        max-height: 160px;
        resize: vertical;
        line-height: 1.5;
    }
    #se-persona-hint {
        min-height: 44px !important;
        max-height: 100px;
        resize: vertical;
        line-height: 1.5;
        font-size: 12px;
    }
    #se-crack-memory-text {
        min-height: 90px !important;
        max-height: 180px;
        resize: vertical;
        line-height: 1.5;
        font-size: 12px;
    }
    .se-style-slot {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border: 1px solid #33384a;
        border-radius: 10px;
        background: #191b22;
    }
    .se-style-head {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    #se-settings .se-style-head input[type="checkbox"] {
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
        padding: 0;
        margin: 0;
        accent-color: #6c7bff;
        cursor: pointer;
    }
    #se-settings input.se-style-name {
        flex: 1 1 auto;
        padding: 6px 9px;
        font-size: 12px;
    }
    #se-settings input:focus,
    #se-settings select:focus,
    #se-settings textarea:focus {
        outline: none;
        border-color: #6c7bff;
    }
    #se-fetch,
    #se-ctx-test,
    #se-ctx-clear,
    #se-memory-fetch,
    #se-memory-clear,
    #se-persona-suggest,
    #se-cost-reset {
        padding: 8px;
        border: 1px solid #4a4f63;
        border-radius: 9px;
        cursor: pointer;
        background: #23262f;
        color: #cdd1e0;
        font-size: 12px;
        font-weight: 600;
    }
    #se-fetch:hover,
    #se-ctx-test:hover,
    #se-ctx-clear:hover,
    #se-memory-fetch:hover,
    #se-memory-clear:hover,
    #se-persona-suggest:hover,
    #se-cost-reset:hover {
        background: #2d3140;
    }
    #se-fetch:disabled {
        opacity: .6;
        cursor: default;
    }
    #se-fetch-status,
    #se-ctx-status,
    #se-memory-status,
    #se-sync-status,
    #se-persona-suggest-status,
    #se-cost-status {
        font-size: 11px;
        color: #9aa0b4;
        min-height: 14px;
    }
    #se-fetch-status.err,
    #se-memory-status.err,
    #se-sync-status.err,
    #se-persona-suggest-status.err,
    #se-cost-status.err {
        color: #ff8a8a;
    }
    #se-save {
        padding: 9px;
        border: none;
        border-radius: 9px;
        cursor: pointer;
        background: #6c7bff;
        color: #fff;
        font-weight: 700;
        font-size: 13px;
    }
    #se-hint {
        font-size: 11px;
        color: #777c8e;
        line-height: 1.5;
    }

    #se-cost-usdkrw {
        width: 110px !important;
        flex: 0 0 auto;
        text-align: right;
    }
    #se-cost-status {
        white-space: pre-wrap;
        max-height: 96px;
        overflow-y: auto;
        line-height: 1.5;
        font-size: 11px;
        color: #9aa0b4;
    }
    #se-hint {
        display: none;
    }
    @media (max-width: 640px) {
        #se-panel {
            width: calc(100vw - 12px);
            max-width: calc(100vw - 12px);
            max-height: calc(100dvh - 12px);
        }
        #se-body,
    
    #se-cost-top-wrap {
        border: 1px solid rgba(244, 114, 182, .34);
        border-radius: 13px;
        padding: 8px 10px;
        background: rgba(244, 114, 182, .085);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .se-cost-top-title {
        font-size: 12px;
        font-weight: 850;
        color: #ffd3ea;
    }
    #se-cost-top-status {
        white-space: pre-wrap;
        line-height: 1.45;
        font-size: 11px;
        color: #f5f7ff;
    }
    .se-section-note {
        color: #9aa0b4;
        font-size: 11px;
        line-height: 1.45;
        padding: 2px 2px 4px;
    }
    .se-section {
        border: 1px solid rgba(148, 163, 184, .22);
        border-radius: 12px;
        overflow: hidden;
        background: rgba(255, 255, 255, .035);
    }
    .se-section + .se-section {
        margin-top: 2px;
    }
    .se-section > summary {
        list-style: none;
        cursor: pointer;
        user-select: none;
        padding: 10px 11px;
        font-size: 13px;
        font-weight: 750;
        color: #f2f5ff;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }
    .se-section > summary::-webkit-details-marker {
        display: none;
    }
    .se-section > summary::after {
        content: '열기';
        font-size: 11px;
        font-weight: 650;
        color: #9aa0b4;
        border: 1px solid rgba(148, 163, 184, .28);
        border-radius: 999px;
        padding: 2px 7px;
        flex: 0 0 auto;
    }
    .se-section[open] > summary {
        border-bottom: 1px solid rgba(148, 163, 184, .18);
        background: rgba(255, 255, 255, .035);
    }
    .se-section[open] > summary::after {
        content: '닫기';
    }
    .se-section-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 9px;
    }

    #se-settings {
            padding: 8px;
            gap: 6px;
        }
        .se-section > summary {
            padding: 8px 9px;
            font-size: 12px;
        }
        .se-section-body {
            padding: 7px;
            gap: 6px;
        }
        #se-cost-top-wrap {
            padding: 7px 8px;
        }

        .se-style-slot {
            padding: 6px;
            gap: 4px;
        }
        .se-ta {
            min-height: 40px;
            max-height: 110px;
            padding: 7px;
            font-size: 12px;
        }
        .se-style-ta {
            min-height: 38px !important;
            max-height: 82px;
        }
        #se-crack-memory-text {
            min-height: 56px !important;
            max-height: 100px;
        }
        #se-sync-box {
            min-height: 40px;
            max-height: 68px;
        }
        #se-out {
            max-height: 32vh;
        }
        #se-settings label {
            font-size: 11px;
        }
    }

    #se-fab {
        right: 18px;
        bottom: 18px;
        bottom: calc(18px + env(safe-area-inset-bottom, 0px));
        width: 52px;
        height: 52px;
        border-radius: 50%;
        touch-action: none;
        background: linear-gradient(135deg,#6c7bff,#8a5cff);
        color: #fff;
        border: none;
        cursor: pointer;
        font-size: 22px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 8px 24px rgba(108,123,255,.5);
    }
    #se-fab.show {
        display: flex;
    }
    .se-ctx-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }
    #se-settings .se-ctx-row input[type="checkbox"] {
        width: 18px;
        height: 18px;
        flex: 0 0 auto;
        padding: 0;
        margin: 0;
        accent-color: #6c7bff;
        cursor: pointer;
    }
    #se-settings input.se-ctx-n {
        width: 64px;
        flex: 0 0 auto;
        text-align: center;
    }
    .se-ctx-label {
        font-size: 12px;
        color: #b9bcca;
    }
    #se-ctx-status,
    #se-memory-status {
        white-space: pre-wrap;
        max-height: 120px;
        overflow-y: auto;
        line-height: 1.5;
    }
    #se-sync-box {
        min-height: 56px;
        max-height: 120px;
        resize: vertical;
        line-height: 1.45;
        font-size: 12px;
    }
    .se-sync-btns,
    .se-memory-btns,
    .se-ctx-btns,
    .se-persona-suggest-btns,
    .se-cost-btns {
        display: flex;
        gap: 6px;
    }
    .se-sync-btns button,
    .se-memory-btns button,
    .se-ctx-btns button,
    .se-persona-suggest-btns button,
    .se-cost-btns button {
        flex: 1;
    }
    .se-sync-btns button {
        padding: 9px;
        border: 1px solid #4a4f63;
        border-radius: 9px;
        cursor: pointer;
        background: #23262f;
        color: #cdd1e0;
        font-size: 12px;
        font-weight: 700;
    }
    .se-sync-btns button:hover {
        background: #2d3140;
    }
    `;

    function injectStyle() {
        const s = document.createElement('style');
        s.textContent = CSS;
        document.head.appendChild(s);
    }

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
                <div id="se-cost-top-wrap">
                    <div class="se-cost-top-title">💸 실시간 API 요금</div>
                    <div id="se-cost-top-status">아직 계산된 사용량이 없어요.</div>
                </div>
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
                <div class="se-section-note">필요한 항목만 눌러서 열어 쓰세요. 요금은 위쪽에 항상 보여요.</div>

                <details class="se-section" open>
                    <summary>💸 API 비용 추정 / 사용내역</summary>
                    <div class="se-section-body">
                        <div class="se-ctx-row">
                            <input type="checkbox" id="se-cost-on">
                            <span class="se-ctx-label">상단 요금 표시 · 환율</span>
                            <input type="number" id="se-cost-usdkrw" min="1" step="1" value="1400">
                            <span class="se-ctx-label">원/USD</span>
                        </div>

                        <div class="se-cost-btns">
                            <button id="se-cost-reset">🧹 비용 누적 초기화</button>
                        </div>

                        <div id="se-cost-status"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>🎭 유저 페르소나 / 자동추천</summary>
                    <div class="se-section-body">
                        <textarea id="se-persona-hint" class="se-style-ta" placeholder="자동추천 키워드 예: 여자 검사, 무뚝뚝, 책임감 강함, 30대 초반"></textarea>

                        <div class="se-persona-suggest-btns">
                            <button id="se-persona-suggest">✨ 현재 설정으로 페르소나 추천</button>
                        </div>

                        <div id="se-persona-suggest-status"></div>

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
                    </div>
                </details>

                <details class="se-section">
                    <summary>✍️ 문체 규칙</summary>
                    <div class="se-section-body">
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
                    </div>
                </details>

                <details class="se-section">
                    <summary>🧠 크랙 요약 메모리</summary>
                    <div class="se-section-body">
                        <div class="se-ctx-row">
                            <input type="checkbox" id="se-memory-on">
                            <span class="se-ctx-label">프롬프트에 참고시키기</span>
                        </div>

                        <div class="se-ctx-row">
                            <input type="checkbox" id="se-memory-auto">
                            <span class="se-ctx-label">문학적으로 늘리기 누를 때, 현재 화면이 요약 메모리면 자동 새로고침</span>
                        </div>

                        <div class="se-memory-btns">
                            <button id="se-memory-fetch">📥 현재 화면에서 메모리 가져오기</button>
                            <button id="se-memory-clear">🗑 비우기</button>
                        </div>

                        <textarea id="se-crack-memory-text" placeholder="크랙의 요약 메모리 화면을 열고 '현재 화면에서 메모리 가져오기'를 누르면 여기에 저장돼요. 직접 붙여넣어도 돼요."></textarea>
                        <div id="se-memory-status"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>💬 최근 대화 맥락</summary>
                    <div class="se-section-body">
                        <div class="se-ctx-row">
                            <input type="checkbox" id="se-ctx-chk">
                            <span class="se-ctx-label">켜기 · 최근</span>
                            <input type="number" id="se-ctx-n" class="se-ctx-n" min="1" max="30" value="6">
                            <span class="se-ctx-label">개</span>
                        </div>

                        <input id="se-ctx-sel" type="text" placeholder="(고급) 메시지 CSS 선택자 — 추천: div[data-message-group-id]">

                        <div class="se-ctx-btns">
                            <button id="se-ctx-test">🔍 맥락 미리보기</button>
                            <button id="se-ctx-clear">🧹 이 채팅방 캐시 비우기</button>
                        </div>

                        <div id="se-ctx-status"></div>
                    </div>
                </details>

                <details class="se-section">
                    <summary>⚙️ 기본 설정 / API / 모델</summary>
                    <div class="se-section-body">
                        <label>🪪 캐릭터 이름 (3인칭일 때 사용, 선택)</label>
                        <input id="se-name" type="text" placeholder="예: 서지훈">

                        <label>🔑 Gemini API 키</label>
                        <input id="se-key" type="password" placeholder="AIza...">

                        <label>🤖 모델 (목록에서 선택)</label>
                        <select id="se-model"></select>
                        <button id="se-fetch">🔄 사용 가능한 모델 불러오기</button>
                        <div id="se-fetch-status"></div>
                    </div>
                </details>

                <button id="se-save">저장</button>

                <details class="se-section">
                    <summary>🔄 설정 동기화 / 안내</summary>
                    <div class="se-section-body">
                        <textarea id="se-sync-box" placeholder="내보내기를 누르면 코드가 생겨요. 다른 기기에서는 그 코드를 붙여넣고 가져오기를 누르면 돼요."></textarea>

                        <div class="se-sync-btns">
                            <button id="se-export">📤 내보내기</button>
                            <button id="se-import">📥 가져오기</button>
                        </div>

                        <div id="se-sync-status"></div>

                        <div id="se-hint">
                            최근 대화 맥락 캐시는 채팅방 주소별로 따로 저장돼요.
                            A 채팅방에서 저장된 맥락은 B 채팅방에 섞이지 않아요.
                            단, 크랙이 여러 채팅방을 같은 주소로 표시하면 완벽히 분리되지 않을 수 있어요.
                            캐시는 화면에 한 번이라도 표시된 채팅을 최대 300개까지 저장해요.
                            가져온 메모리와 최근 대화 맥락은 Gemini API로 같이 전송돼요. 개인정보/API 키/비밀번호는 넣지 마세요.
                        </div>
                    </div>
                </details>
            </div>
        `;

        document.body.appendChild(panel);

        const fab = document.createElement('button');
        fab.id = 'se-fab';
        fab.title = '문장 부풀리기 열기/닫기';
        fab.textContent = '✨';
        document.body.appendChild(fab);

        wireUp(panel, fab);
    }

    function wireUp(panel, fab) {
        const $ = sel => panel.querySelector(sel);

        const dialogue = $('#se-dialogue');
        const action = $('#se-action');
        const out = $('#se-out');
        const insertBtn = $('#se-insert');
        const outbtns = $('#se-outbtns');
        const status = $('#se-status');
        const goBtn = $('#se-go');
        const settings = $('#se-settings');
        const modelSel = $('#se-model');
        const nameInput = $('#se-name');
        const fetchBtn = $('#se-fetch');
        const fetchStat = $('#se-fetch-status');
        const costOnInput = $('#se-cost-on');
        const costUsdKrwInput = $('#se-cost-usdkrw');
        const costResetBtn = $('#se-cost-reset');
        const costStatus = $('#se-cost-status');
        const costTopStatus = $('#se-cost-top-status');

        const pos = GM_getValue(K_POS, null);
        if (pos && typeof pos.left === 'number') {
            panel.style.left = pos.left + 'px';
            panel.style.top = pos.top + 'px';
            panel.style.right = 'auto';
        } else {
            panel.style.right = '18px';
            panel.style.top = '90px';
        }

        if (GM_getValue(K_OPEN, true) === false) {
            panel.style.display = 'none';
        }

        fab.classList.add('show');

        const fpos = GM_getValue(K_FABPOS, null);
        if (fpos && typeof fpos.left === 'number') {
            fab.style.left = fpos.left + 'px';
            fab.style.top = fpos.top + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';
        }

        const savedPov = GM_getValue(K_POV, 'first');
        $('#se-pov').querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.dataset.pov === savedPov);

            b.addEventListener('click', () => {
                $('#se-pov').querySelectorAll('button').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                GM_setValue(K_POV, b.dataset.pov);
            });
        });

        const savedLen = GM_getValue(K_LENGTH, 'medium');
        $('#se-len').querySelectorAll('button').forEach(b => {
            b.classList.toggle('active', b.dataset.len === savedLen);

            b.addEventListener('click', () => {
                $('#se-len').querySelectorAll('button').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                GM_setValue(K_LENGTH, b.dataset.len);
            });
        });

        $('#se-key').value = GM_getValue(K_APIKEY, '');
        nameInput.value = GM_getValue(K_NAME, '');

        function applyPersonasToUI(arr) {
            for (let i = 0; i < PERSONA_SLOTS; i++) {
                const s = arr[i] || { on: false, name: '', text: '' };
                const chk = $('#se-persona-chk-' + i);
                const nm = $('#se-persona-name-' + i);
                const ta = $('#se-persona-' + i);

                if (chk) chk.checked = !!s.on;
                if (nm) nm.value = s.name || '';
                if (ta) ta.value = s.text || '';
            }
        }

        function collectPersonas() {
            const arr = [];

            for (let i = 0; i < PERSONA_SLOTS; i++) {
                const chk = $('#se-persona-chk-' + i);
                const nm = $('#se-persona-name-' + i);
                const ta = $('#se-persona-' + i);

                arr.push({
                    on: !!(chk && chk.checked),
                    name: (nm && nm.value.trim()) || ('페르소나 ' + (i + 1)),
                    text: (ta && ta.value) || ''
                });
            }

            return arr;
        }

        function savePersonas() {
            GM_setValue(K_PERSONAS, collectPersonas());
        }

        applyPersonasToUI(getPersonaSlots());

        const personaHint = $('#se-persona-hint');
        const personaSuggestBtn = $('#se-persona-suggest');
        const personaSuggestStatus = $('#se-persona-suggest-status');

        if (personaHint) personaHint.value = GM_getValue(K_PERSONA_HINT, '');

        function personaSuggestFlash(msg, isErr) {
            if (!personaSuggestStatus) return;
            personaSuggestStatus.textContent = msg;
            personaSuggestStatus.classList.toggle('err', !!isErr);
        }

        function putSuggestedPersona(text) {
            const arr = collectPersonas();
            let idx = arr.findIndex(s => s && s.on);
            if (idx < 0) idx = arr.findIndex(s => !s || !s.text || !s.text.trim());
            if (idx < 0) idx = 0;

            const ta = $('#se-persona-' + idx);
            const chk = $('#se-persona-chk-' + idx);
            const nm = $('#se-persona-name-' + idx);

            if (ta) ta.value = text;
            if (chk) chk.checked = true;
            if (nm && (!nm.value || /^페르소나\s*\d+$/.test(nm.value.trim()))) {
                nm.value = '자동추천 페르소나';
            }

            savePersonas();
        }

        if (personaHint) {
            personaHint.addEventListener('change', () => {
                GM_setValue(K_PERSONA_HINT, personaHint.value);
            });
        }

        if (personaSuggestBtn) {
            personaSuggestBtn.addEventListener('click', () => {
                const keywords = personaHint ? personaHint.value.trim() : '';
                GM_setValue(K_PERSONA_HINT, keywords);

                personaSuggestBtn.disabled = true;
                personaSuggestFlash('크랙 상세 설명/프롤로그와 최근 맥락을 읽고 추천 중…', false);

                callGeminiPersonaSuggest(
                    keywords,
                    (outText, costInfo) => {
                        putSuggestedPersona(outText);
                        refreshCostStatus(costInfo);
                        personaSuggestBtn.disabled = false;
                        personaSuggestFlash('페르소나를 자동으로 넣었어요 ✅ ' + (costInfo ? costInfo.message : '마음에 안 들면 키워드를 고쳐서 다시 눌러도 돼요.'));
                    },
                    err => {
                        personaSuggestBtn.disabled = false;
                        personaSuggestFlash(err, true);
                    }
                );
            });
        }


        for (let i = 0; i < PERSONA_SLOTS; i++) {
            const chk = $('#se-persona-chk-' + i);
            if (chk) chk.addEventListener('change', savePersonas);
        }

        function applyStylesToUI(arr) {
            for (let i = 0; i < STYLE_SLOTS; i++) {
                const s = arr[i] || { on: false, name: '', text: '' };
                const chk = $('#se-style-chk-' + i);
                const nm = $('#se-style-name-' + i);
                const ta = $('#se-style-' + i);

                if (chk) chk.checked = !!s.on;
                if (nm) nm.value = s.name || '';
                if (ta) ta.value = s.text || '';
            }
        }

        function collectStyles() {
            const arr = [];

            for (let i = 0; i < STYLE_SLOTS; i++) {
                const chk = $('#se-style-chk-' + i);
                const nm = $('#se-style-name-' + i);
                const ta = $('#se-style-' + i);

                arr.push({
                    on: !!(chk && chk.checked),
                    name: (nm && nm.value.trim()) || ('문체 ' + (i + 1)),
                    text: (ta && ta.value) || ''
                });
            }

            return arr;
        }

        function saveStyles() {
            GM_setValue(K_STYLES, collectStyles());
        }

        applyStylesToUI(getStyleSlots());

        for (let i = 0; i < STYLE_SLOTS; i++) {
            const chk = $('#se-style-chk-' + i);
            if (chk) chk.addEventListener('change', saveStyles);
        }

        const memoryOn = $('#se-memory-on');
        const memoryAuto = $('#se-memory-auto');
        const memoryText = $('#se-crack-memory-text');
        const memoryStatus = $('#se-memory-status');

        memoryOn.checked = GM_getValue(K_MEMORY_ON, false);
        memoryAuto.checked = GM_getValue(K_MEMORY_AUTO, true);
        memoryText.value = GM_getValue(K_MEMORY_TEXT, '');

        function memoryFlash(msg, isErr) {
            memoryStatus.textContent = msg;
            memoryStatus.classList.toggle('err', !!isErr);
        }

        function saveMemorySettings() {
            GM_setValue(K_MEMORY_ON, memoryOn.checked);
            GM_setValue(K_MEMORY_AUTO, memoryAuto.checked);
            GM_setValue(K_MEMORY_TEXT, memoryText.value);
        }

        memoryOn.addEventListener('change', saveMemorySettings);
        memoryAuto.addEventListener('change', saveMemorySettings);
        memoryText.addEventListener('change', saveMemorySettings);

        $('#se-memory-fetch').addEventListener('click', () => {
            let mem = '';

            try {
                mem = collectCrackMemoryFromPage();
            } catch (_) {
                mem = '';
            }

            if (!mem || !mem.trim()) {
                memoryFlash('가져올 메모리를 못 찾았어요. 크랙의 “요약 메모리” 화면을 열고 다시 눌러주세요. 현재 총 0개면 가져올 내용이 없어요.', true);
                return;
            }

            memoryText.value = mem.trim();
            saveMemorySettings();
            memoryFlash('현재 화면에서 요약 메모리를 가져왔어요 ✅');
        });

        $('#se-memory-clear').addEventListener('click', () => {
            memoryText.value = '';
            GM_setValue(K_MEMORY_TEXT, '');
            memoryFlash('요약 메모리 칸을 비웠어요.');
        });

        const ctxChk = $('#se-ctx-chk');
        const ctxN = $('#se-ctx-n');
        const ctxSel = $('#se-ctx-sel');
        const ctxStat = $('#se-ctx-status');

        ctxChk.checked = GM_getValue(K_CTX_ON, false);
        ctxN.value = GM_getValue(K_CTX_N, 6);
        ctxSel.value = GM_getValue(K_CTX_SEL, '');

        ctxChk.addEventListener('change', () => {
            GM_setValue(K_CTX_ON, ctxChk.checked);
        });

        $('#se-ctx-test').addEventListener('click', () => {
            const n = parseInt(ctxN.value, 10) || 6;
            let arr = [];

            GM_setValue(K_CTX_N, n);
            GM_setValue(K_CTX_SEL, ctxSel.value.trim());

            try {
                arr = collectChatContext(n, ctxSel.value);
            } catch (_) {
                arr = [];
            }

            const cacheCount = getCtxCache().length;
            const roomKey = getCurrentChatCacheKey().replace(K_CTX_CACHE_BASE + '::', '');

            if (!arr.length) {
                ctxStat.textContent =
                    '못 잡았어요 😅 채팅이 화면에 보이는지 확인하거나, 선택자를 비워 자동으로 두고 다시 해보세요.\n'
                    + '현재 채팅방 캐시: ' + cacheCount + '개\n'
                    + '캐시 기준: ' + roomKey;
                return;
            }

            ctxStat.textContent =
                arr.length + '개 참고 예정 / 현재 채팅방 캐시 ' + cacheCount + '개\n'
                + '캐시 기준: ' + roomKey + '\n'
                + arr.map((m, i) => (i + 1) + '. ' + (m.length > 80 ? m.slice(0, 80) + '…' : m)).join('\n');
        });

        $('#se-ctx-clear').addEventListener('click', () => {
            clearCtxCache();
            ctxStat.textContent = '현재 채팅방의 최근 대화 맥락 캐시를 비웠어요 🧹';
        });

        function populateModels(list, selected) {
            modelSel.innerHTML = '';

            list.forEach(m => {
                const o = document.createElement('option');
                o.value = m.id;
                o.textContent = m.label;
                modelSel.appendChild(o);
            });

            const want = selected || GM_getValue(K_MODEL, list[0] && list[0].id);

            if (want && list.some(m => m.id === want)) modelSel.value = want;
            else if (list[0]) modelSel.value = list[0].id;
        }

        let storedList = GM_getValue(K_MODELLIST, null);
        if (!Array.isArray(storedList) || !storedList.length) storedList = DEFAULT_MODELS;

        populateModels(storedList);


        function refreshCostStatus(lastInfo) {
            if (costStatus) costStatus.textContent = getCostSummaryText(lastInfo);
            if (costTopStatus) costTopStatus.textContent = getCostTopText(lastInfo);
        }

        if (costOnInput) costOnInput.checked = GM_getValue(K_COST_ON, true);
        if (costUsdKrwInput) costUsdKrwInput.value = GM_getValue(K_COST_USDKRW, 1400);

        if (costOnInput) {
            costOnInput.addEventListener('change', () => {
                GM_setValue(K_COST_ON, costOnInput.checked);
                refreshCostStatus();
            });
        }

        if (costUsdKrwInput) {
            costUsdKrwInput.addEventListener('change', () => {
                GM_setValue(K_COST_USDKRW, parseFloat(costUsdKrwInput.value) || 1400);
                refreshCostStatus();
            });
        }

        if (costResetBtn) {
            costResetBtn.addEventListener('click', () => {
                resetCostStats();
                refreshCostStatus();
            });
        }

        refreshCostStatus();


        function setupSettingsAccordion() {
            const sections = Array.from(panel.querySelectorAll('#se-settings .se-section'));
            const isMobile = () => window.matchMedia && window.matchMedia('(max-width: 640px)').matches;

            sections.forEach(section => {
                section.addEventListener('toggle', () => {
                    if (!section.open || !isMobile()) return;

                    sections.forEach(other => {
                        if (other !== section) other.open = false;
                    });
                });
            });
        }

        setupSettingsAccordion();

        fetchBtn.addEventListener('click', () => {
            GM_setValue(K_APIKEY, $('#se-key').value.trim());
            GM_setValue(K_PERSONA_HINT, personaHint ? personaHint.value.trim() : '');
            GM_setValue(K_COST_ON, costOnInput ? costOnInput.checked : true);
            GM_setValue(K_COST_USDKRW, costUsdKrwInput ? (parseFloat(costUsdKrwInput.value) || 1400) : 1400);

            fetchBtn.disabled = true;
            fetchStat.classList.remove('err');
            fetchStat.textContent = '불러오는 중…';

            fetchModels(
                models => {
                    GM_setValue(K_MODELLIST, models);
                    populateModels(models, modelSel.value);
                    fetchStat.textContent = models.length + '개 불러왔어요 ✅';
                    fetchBtn.disabled = false;
                },
                err => {
                    fetchStat.classList.add('err');
                    fetchStat.textContent = err;
                    fetchBtn.disabled = false;
                }
            );
        });

        $('#se-gear').addEventListener('click', () => {
            settings.classList.toggle('show');

            setTimeout(() => {
                if (wireUp._clamp) wireUp._clamp(false);
            }, 0);
        });

        $('#se-save').addEventListener('click', () => {
            GM_setValue(K_APIKEY, $('#se-key').value.trim());
            GM_setValue(K_PERSONA_HINT, personaHint ? personaHint.value.trim() : '');
            GM_setValue(K_COST_ON, costOnInput ? costOnInput.checked : true);
            GM_setValue(K_COST_USDKRW, costUsdKrwInput ? (parseFloat(costUsdKrwInput.value) || 1400) : 1400);
            savePersonas();
            saveStyles();
            saveMemorySettings();

            GM_setValue(K_NAME, nameInput.value.trim());
            GM_setValue(K_CTX_ON, ctxChk.checked);
            GM_setValue(K_CTX_N, parseInt(ctxN.value, 10) || 6);
            GM_setValue(K_CTX_SEL, ctxSel.value.trim());

            if (modelSel.value) GM_setValue(K_MODEL, modelSel.value);

            settings.classList.remove('show');
            flash('저장됐어요 ✅');
        });

        const SYNC_KEYS = [
            K_APIKEY,
            K_MODEL,
            K_PERSONA,
            K_PERSONAS,
            K_PERSONA_HINT,
            K_COST_ON,
            K_COST_USDKRW,
            K_COST_TOTAL_USD,
            K_COST_TOTAL_IN,
            K_COST_TOTAL_OUT,
            K_COST_REQ_COUNT,
            K_COST_LOG,
            K_STYLES,
            K_NAME,
            K_POV,
            K_LENGTH,
            K_CTX_ON,
            K_CTX_N,
            K_CTX_SEL,
            K_MEMORY_ON,
            K_MEMORY_AUTO,
            K_MEMORY_TEXT
        ];

        const syncBox = $('#se-sync-box');
        const syncStat = $('#se-sync-status');

        function syncFlash(msg, isErr) {
            syncStat.textContent = msg;
            syncStat.classList.toggle('err', !!isErr);
        }

        function b64encUtf8(s) {
            return btoa(unescape(encodeURIComponent(s)));
        }

        function b64decUtf8(b) {
            return decodeURIComponent(escape(atob(b)));
        }

        $('#se-export').addEventListener('click', () => {
            savePersonas();
            saveStyles();
            saveMemorySettings();

            const obj = {};

            SYNC_KEYS.forEach(k => {
                const v = GM_getValue(k, null);
                if (v !== null && v !== undefined) obj[k] = v;
            });

            const json = JSON.stringify({
                v: 1,
                app: 'crack-se',
                data: obj
            });

            let code;

            try {
                code = 'CSE1:' + b64encUtf8(json);
            } catch (_) {
                code = json;
            }

            syncBox.value = code;
            syncBox.focus();

            try {
                syncBox.select();
            } catch (_) {}

            copyToClipboard(
                code,
                () => syncFlash('내보냈어요! 코드가 복사됐으니 다른 기기에 붙여넣으세요 📋'),
                () => syncFlash('코드를 만들었어요. 위 칸을 길게 눌러 직접 복사해 주세요.')
            );
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

            let jsonStr = null;

            const m = raw.match(/CSE1:\s*([A-Za-z0-9+/_=\-\s]+)/);

            if (m) {
                let b = m[1].replace(/\s+/g, '');
                b = b.replace(/-/g, '+').replace(/_/g, '/');

                while (b.length % 4) b += '=';

                try {
                    const dec = b64decUtf8(b);
                    if (dec.includes('{')) jsonStr = dec;
                } catch (_) {}
            }

            if (!jsonStr) {
                const s = raw.indexOf('{');
                const e = raw.lastIndexOf('}');

                if (s >= 0 && e > s) jsonStr = raw.slice(s, e + 1);
            }

            if (!jsonStr) return null;

            try {
                return JSON.parse(jsonStr);
            } catch (_) {
                return null;
            }
        }

        $('#se-import').addEventListener('click', () => {
            const raw = (syncBox.value || '').trim();

            if (!raw) {
                syncFlash('가져올 코드를 먼저 붙여넣어 주세요.', true);
                return;
            }

            const parsed = parseSyncCode(raw);

            if (!parsed) {
                syncFlash('코드를 못 읽었어요 😢 코드 전체를 빠짐없이 붙여넣었는지 확인해 주세요.', true);
                return;
            }

            const data = parsed && parsed.data;

            if (!data || typeof data !== 'object') {
                syncFlash('이 코드엔 설정이 없어요 😢', true);
                return;
            }

            let cnt = 0;

            SYNC_KEYS.forEach(k => {
                if (Object.prototype.hasOwnProperty.call(data, k)) {
                    GM_setValue(k, data[k]);
                    cnt++;
                }
            });

            if (!cnt) {
                syncFlash('적용할 설정을 못 찾았어요.', true);
                return;
            }

            syncFlash(cnt + '개 설정을 가져왔어요. 잠시 후 새로고침해서 적용할게요… 🔄');

            setTimeout(() => location.reload(), 900);
        });

        $('#se-min').addEventListener('click', () => {
            panel.style.display = 'none';
            GM_setValue(K_OPEN, false);
        });

        let fabDrag = false;
        let fabMoved = false;
        let fabId = null;
        let fabOffX = 0;
        let fabOffY = 0;
        let fabSX = 0;
        let fabSY = 0;

        function clampFab(save) {
            const r = fab.getBoundingClientRect();

            let l = isNaN(parseFloat(fab.style.left)) ? r.left : parseFloat(fab.style.left);
            let t = isNaN(parseFloat(fab.style.top)) ? r.top : parseFloat(fab.style.top);

            l = Math.max(0, Math.min(l, window.innerWidth - fab.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - fab.offsetHeight));

            fab.style.left = l + 'px';
            fab.style.top = t + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';

            if (save) GM_setValue(K_FABPOS, { left: l, top: t });
        }

        fab.addEventListener('pointerdown', e => {
            fabDrag = true;
            fabMoved = false;
            fabId = e.pointerId;

            const r = fab.getBoundingClientRect();

            fabOffX = e.clientX - r.left;
            fabOffY = e.clientY - r.top;
            fabSX = e.clientX;
            fabSY = e.clientY;

            try {
                fab.setPointerCapture(e.pointerId);
            } catch (_) {}
        });

        fab.addEventListener('pointermove', e => {
            if (!fabDrag || e.pointerId !== fabId) return;

            if (Math.abs(e.clientX - fabSX) + Math.abs(e.clientY - fabSY) > 6) {
                fabMoved = true;
            }

            if (!fabMoved) return;

            let l = e.clientX - fabOffX;
            let t = e.clientY - fabOffY;

            l = Math.max(0, Math.min(l, window.innerWidth - fab.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - fab.offsetHeight));

            fab.style.left = l + 'px';
            fab.style.top = t + 'px';
            fab.style.right = 'auto';
            fab.style.bottom = 'auto';

            e.preventDefault();
        });

        function fabEnd(e) {
            if (!fabDrag) return;
            if (e && e.pointerId != null && e.pointerId !== fabId) return;

            fabDrag = false;
            fabId = null;

            if (fabMoved) {
                const r = fab.getBoundingClientRect();
                GM_setValue(K_FABPOS, { left: r.left, top: r.top });
                return;
            }

            const isOpen = panel.style.display !== 'none';

            if (isOpen) {
                panel.style.display = 'none';
                GM_setValue(K_OPEN, false);
            } else {
                panel.style.display = 'flex';
                GM_setValue(K_OPEN, true);

                setTimeout(() => {
                    if (wireUp._clamp) wireUp._clamp(false);
                }, 0);
            }
        }

        fab.addEventListener('pointerup', fabEnd);
        fab.addEventListener('pointercancel', fabEnd);

        window.addEventListener('resize', () => {
            clampFab(true);
        });

        let statusTimer = null;

        function flash(msg, isErr) {
            status.textContent = msg;
            status.classList.toggle('err', !!isErr);

            if (statusTimer) clearTimeout(statusTimer);

            if (!isErr && msg) {
                statusTimer = setTimeout(() => {
                    status.textContent = '';
                }, 2500);
            }
        }

        let lastResult = '';

        function renderResult(textRaw) {
            lastResult = textRaw;

            const esc = textRaw
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            out.innerHTML = esc.replace(/\*([^*]+)\*/g, '<em>$1</em>');

            out.classList.add('show');
            insertBtn.classList.add('show');
            outbtns.classList.add('show');

            setTimeout(() => {
                if (wireUp._clamp) wireUp._clamp(false);
            }, 0);
        }

        function run() {
            const d = dialogue.value;
            const a = action.value;

            if (!d.trim() && !a.trim()) {
                flash('대사나 행동 중 하나는 입력해 주세요.', true);
                return;
            }

            goBtn.disabled = true;

            out.classList.remove('show');
            insertBtn.classList.remove('show');
            outbtns.classList.remove('show');

            flash('늘리는 중… ✍️');

            callGemini(
                d,
                a,
                (result, truncated, costInfo) => {
                    renderResult(result);
                    refreshCostStatus(costInfo);

                    flash(
                        truncated
                            ? '한도에 걸려 끝이 잘렸어요. "짧게"로 바꾸거나 다시 뽑아보세요 ⚠️'
                            : (costInfo ? costInfo.message : ''),
                        !!truncated
                    );

                    goBtn.disabled = false;
                },
                err => {
                    flash(err, true);
                    goBtn.disabled = false;
                }
            );
        }

        goBtn.addEventListener('click', run);
        $('#se-retry').addEventListener('click', run);

        [dialogue, action].forEach(ta => {
            ta.addEventListener('keydown', e => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    run();
                }
            });
        });

        function copyToClipboard(txt, ok, fail) {
            (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject())
                .then(ok)
                .catch(() => {
                    const ta = document.createElement('textarea');
                    ta.value = txt;
                    document.body.appendChild(ta);
                    ta.select();

                    try {
                        document.execCommand('copy');
                        ok();
                    } catch (_) {
                        fail();
                    }

                    document.body.removeChild(ta);
                });
        }

        insertBtn.addEventListener('click', () => {
            if (!lastResult) return;

            if (insertIntoChat(lastResult)) {
                dialogue.value = '';
                action.value = '';

                blurEverything();

                panel.style.display = 'none';
                GM_setValue(K_OPEN, false);

                flash('채팅창에 넣었어요 💬 창을 닫았어요.');
            } else {
                copyToClipboard(
                    lastResult,
                    () => flash('채팅창을 못 찾아서 복사했어요. 붙여넣기 해주세요 📋', true),
                    () => flash('채팅창을 못 찾았어요 😢', true)
                );
            }
        });

        $('#se-copy').addEventListener('click', () => {
            copyToClipboard(
                lastResult,
                () => flash('복사 완료 📋'),
                () => flash('복사 실패 😢', true)
            );
        });

        function clampIntoView(savePos) {
            const w = panel.offsetWidth;
            const h = panel.offsetHeight;

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

        let dragging = false;
        let offX = 0;
        let offY = 0;
        let activeId = null;

        head.addEventListener('pointerdown', e => {
            if (e.target.tagName === 'BUTTON') return;

            dragging = true;
            activeId = e.pointerId;
            head.classList.add('dragging');

            const r = panel.getBoundingClientRect();

            offX = e.clientX - r.left;
            offY = e.clientY - r.top;

            panel.style.right = 'auto';

            try {
                head.setPointerCapture(e.pointerId);
            } catch (_) {}

            e.preventDefault();
        });

        head.addEventListener('pointermove', e => {
            if (!dragging || e.pointerId !== activeId) return;

            let l = e.clientX - offX;
            let t = e.clientY - offY;

            l = Math.max(0, Math.min(l, window.innerWidth - panel.offsetWidth));
            t = Math.max(0, Math.min(t, window.innerHeight - panel.offsetHeight));

            panel.style.left = l + 'px';
            panel.style.top = t + 'px';

            e.preventDefault();
        });

        function endDrag(e) {
            if (!dragging) return;
            if (e && e.pointerId != null && e.pointerId !== activeId) return;

            dragging = false;
            activeId = null;
            head.classList.remove('dragging');

            const r = panel.getBoundingClientRect();

            GM_setValue(K_POS, {
                left: r.left,
                top: r.top
            });
        }

        head.addEventListener('pointerup', endDrag);
        head.addEventListener('pointercancel', endDrag);

        window.addEventListener('resize', () => clampIntoView(true));

        window.addEventListener('orientationchange', () => {
            setTimeout(() => clampIntoView(true), 300);
        });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => clampIntoView(false));
        }

        setTimeout(() => clampIntoView(false), 0);
    }

    function startContextCacheObserver() {
        let timer = null;

        const scan = () => {
            if (timer) clearTimeout(timer);

            timer = setTimeout(() => {
                try {
                    const sel = GM_getValue(K_CTX_SEL, '');
                    const lines = collectChatContextFromDOM(80, sel);
                    rememberCtxLines(lines);
                } catch (_) {}
            }, 700);
        };

        const mo = new MutationObserver(scan);

        mo.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        scan();
    }

    function init() {
        if (document.getElementById('se-panel')) return;

        injectStyle();
        buildUI();
        startContextCacheObserver();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
