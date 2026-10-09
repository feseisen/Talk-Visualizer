/*
 * analyst.js — 分析役（読み手）への共通の口
 *
 * 共通の口:
 *   const an = makeAnalyst(cfg);                  // cfg.kind で実装を選ぶ（下の表）
 *   const r  = await an.analyze(pack, prefix);    // → {step, events, note, raw, usage, think}
 *   // pack   状態の最小表現（format/pack.md の形。道具が作る）
 *   // prefix 固定の指示（prompts/analyst.md の全文。キャッシュに乗る接頭辞）
 *   // step   {t:[a,b]}        events  イベントの配列（schema.json の形）   note  {x}
 *   // raw    分析役が返した文字列そのもの（記録・調査用）
 *   // usage  {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}（取れた分だけ。無ければ null）
 *   // think  思考の要約（取れたときだけ文字列。無ければ null）
 *   返事の形（JSON として読めるか・step/events/note があるか・欄の値の入れ子が 32 段までか）だけをここで見る。
 *   読み方は rt.py と同じ（format/FORMAT.md「返事の読み方」。全体の ``` の囲みは 1 回だけ外し、前置き・後書きは読まない）。
 *   中身の正しさ（時刻・id・上限）は verify.js（rt.py）が落とす。
 *   誤りの文は 2 つ持つ: 分析役に返す機械向けの文（parseReply の error、投げた Error の message。項目名をそのまま使う）と、
 *   画面に出す日本語の文（parseReply の msg、投げた Error の screen。英字の項目名を出さない）。
 *
 * 返事 → 追記（記録の形）:
 *   const batch = toBatch(reply, window);     // window = {n, lines:[i,j], t:[a,b]}（道具が決めた窓。n は書くステップ番号）
 *   // rt.py の reply_to_batch と同じ直し方: step に n・lines を道具が埋め（t は返事の step.t）、think が空でない文字列なら
 *   // 載せ（上限の 2000 字で切る）、card の li が null なら欄ごと落とし（記録では「無い」と同じ）、
 *   // note は {x} が文字列のときだけ {e:'note', t: step.t[1], x} として末尾に置く。
 *   // 返事に無いものを補わない（step.t が無ければ無いまま → 検査器が落とす）。
 *
 * 実装（cfg.kind）:
 *   'anthropic'  L1。fetch で https://api.anthropic.com/v1/messages を直に叩く
 *   'openai'     L1。OpenAI 互換の <base>/chat/completions を直に叩く（Azure 等）
 *   'manual'     L3。プロンプトを1つの文字列にして人に渡し、貼られた返事を読む（cfg.ask を通す）
 *   'mock'       試験用。tests/fixtures/meeting10.jsonl のバッチを step 番号順に返す
 *
 * cfg の欄:
 *   kind       上の4つのどれか
 *   key        API の鍵（anthropic / openai）。設定の書き出しには含めない
 *   model      モデル名（anthropic の既定 'claude-opus-5-5'。openai は必須）
 *   base       openai: 'https://api.openai.com/v1' のような土台の URL（末尾の / は無くてよい）
 *   effort     anthropic: output_config.effort（'low'|'medium'|'high'|'xhigh'|'max'）。省略したとき、モデルが既定
 *              （DEFAULT_MODEL）なら 'medium' を送り、ほかのモデルなら送らない（effort を受けないモデルがあるため）
 *   think      anthropic: 'summarized' を指定したときだけ thinking:{type:'adaptive',display:'summarized'} を送る。
 *              既定は送らない（Opus 5.5 は思考を切れないので、思考の量は effort で決まる）
 *   maxTokens  返事の上限（既定 16000。思考も含めた上限なので、返事の JSON だけの長さより大きく取る）
 *   timeoutMs  1回の呼び出しの打ち切り（既定 120000）
 *   schema     format/schema.json の中身（構造化出力に渡す。file:// では fetch できないので組み立て時に埋め込む）
 *   ask        manual: (promptText) => Promise<string>。人にプロンプトを見せ、貼られた返事の文字列を返す
 *   script     mock: 判断ログのイベントの配列（meeting10.jsonl を読んだもの）
 *
 * 註（未検証・記憶）:
 *   - ブラウザから直に叩くには、Anthropic はヘッダ `anthropic-dangerous-direct-browser-access: true` が要る（記憶。
 *     無いと CORS で落ちる、と記憶している。実機で未検証）。鍵をページに置くことになるので、個人の鍵を会社の会議に使う道は
 *     設計として置かない（README に書く）
 *   - OpenAI 互換の response_format:{type:'json_schema', json_schema:{name, strict:true, schema}} は記憶で、未検証。
 *     Azure 等では base の形が違い、鍵のヘッダも `api-key` のことがある（cfg.keyHeader で変えられる）
 *   - 構造化出力は形だけを保証する。max_tokens で切れた返事（stop_reason:'max_tokens'）は JSON として読めないことがある
 *
 * 鍵の置き場:
 *   keys.load(name) / keys.save(name, key, remember) / keys.clear(name)
 *   既定は sessionStorage（タブを閉じると消える）。remember=true（「この PC に覚える」）のときだけ localStorage。
 *   どちらも読めない環境（file:// の制限など）では null を返し、ページは鍵の欄に貼り直させる。
 *
 * ブラウザでは globalThis.TSV_ANALYST、node では module.exports に同じものを出す。
 */
(function () {
  'use strict';

  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const ANTHROPIC_VERSION = '2023-06-01';
  const DEFAULT_MODEL = 'claude-opus-5-5';
  // 思考を切れないモデル（既定の claude-opus-5-5）では、思考も max_tokens に数える。流さない（stream なしの）呼び出しの上限として 16000
  const DEFAULT_MAX_TOKENS = 16000;
  // 既定のモデルに送る考える量。API の既定も medium だが、既定が変わっても挙動が変わらないように明示する
  const DEFAULT_EFFORT = 'medium';
  const DEFAULT_TIMEOUT = 120000;
  const EVENT_KINDS = ['card', 'hold', 'close', 'fix', 'group', 'rename', 'top', 'echo', 'list'];

  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }

  // ---- 返事の形の検査（形だけ。中身は verify.js） ----

  const FENCE = '```';
  // 前後の空白として除く字（JS の String.prototype.trim と同じ集まりを、字で書き出したもの。rt.py の WS_CHARS と同じ）。
  // trim に任せず書き出すのは、ブラウザや Unicode の版で集まりが揺れないようにするため
  const WS_SET = '\t\n\u000b\u000c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  const WS_EDGE = new RegExp('^[' + WS_SET + ']+|[' + WS_SET + ']+$', 'g');
  function trimWs(s) { return String(s).replace(WS_EDGE, ''); }
  const PARSE_DEPTH_MAX = 500;  // 返事の文字の入れ子の上限（rt.py の PARSE_DEPTH_MAX と同じ。超えたら JSON として読む前に F02）
  const VALUE_DEPTH_MAX = 32;   // 欄の値の入れ子の上限（rules.json の limits."value.max_depth" と同じ。数・文字列は 0 段、[] と {} は 1 段＋中身）

  // 文字列から返事の JSON を取り出す。読めなければ {ok:false, error, msg}
  //   error  分析役に返す機械向けの文（次の呼び出しの違反文になる。項目名をそのまま使う）
  //   msg    画面に出す日本語の文（英字の項目名を出さない）
  // 読み方は rt.py と同じ（format/FORMAT.md「返事の読み方」）:
  //   前後の空白（WS_SET）を除いた全体が ``` で始まり ``` で終わるときだけ、その囲みを 1 回だけ外す（開きの直後の json も捨てる）。
  //   囲みが途中にあるだけなら外さない（文字列の値の中の ``` はただの字）。前置き・後書きの付いた返事は読まない。
  //   JSON として読む前に、文字列の外の [ と { の入れ子を数え、PARSE_DEPTH_MAX 段を超えていれば F02 で断る。
  function parseReply(text) {
    if (typeof text !== 'string') return bad('返事が文字列ではありません', '返事が文字になっていない');
    let s = trimWs(text);
    if (s.length >= 2 * FENCE.length && s.startsWith(FENCE) && s.endsWith(FENCE)) {
      s = s.slice(FENCE.length, s.length - FENCE.length);
      if (s.startsWith('json')) s = s.slice(4);
      s = trimWs(s);
    }
    if (!s) return bad('返事が空です', '返事が空');
    if (textDepth(s) > PARSE_DEPTH_MAX) {
      return bad('F02: 返事の文字の入れ子（文字列の外の [ と {）が ' + PARSE_DEPTH_MAX + ' 段を超えています（JSON として読む前に断ります）',
        '返事の入れ子が深すぎる（' + PARSE_DEPTH_MAX + ' 段まで）');
    }
    const obj = tryParse(s);
    if (obj === undefined) {
      return bad('返事を JSON として読めません（返事は 1 つの JSON オブジェクトだけにします。前置き・後書きは付けません）',
        '返事を読めなかった（機械向けの形になっていないか、前後に文が付いている）');
    }
    return shapeReply(obj);
  }

  function bad(error, msg) { return { ok: false, error: error, msg: msg }; }

  // 文字の入れ子の深さ（文字列の中の括弧は数えない。\ の後の字は飛ばす）。rt.py の text_depth と同じ数え方
  function textDepth(s) {
    let d = 0, mx = 0, inStr = false, esc = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (ch === 92) esc = true;
        else if (ch === 34) inStr = false;
      } else if (ch === 34) inStr = true;
      else if (ch === 91 || ch === 123) { d++; if (d > mx) mx = d; }
      else if (ch === 93 || ch === 125) d--;
    }
    return mx;
  }

  // 読めなければ undefined（入れ子が深すぎて読む道具が持たないときも落ちない）
  function tryParse(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }

  function isPlain(x) { return !!x && typeof x === 'object' && !Array.isArray(x); }

  // 値の入れ子の深さ（数・文字列は 0、[] と {} は 1 ＋ 中身の最大）。再帰しない。limit を超えたら、そこで打ち切って返す
  function valueDepth(v, limit) {
    let mx = 0;
    const stack = [[v, 0]];
    while (stack.length) {
      const top = stack.pop();
      const x = top[0];
      if (!x || typeof x !== 'object') continue;
      const d = top[1] + 1;
      if (d > mx) { mx = d; if (mx > limit) return mx; }
      const kids = Array.isArray(x) ? x : Object.keys(x).map(function (k) { return x[k]; });
      for (let i = 0; i < kids.length; i++) stack.push([kids[i], d]);
    }
    return mx;
  }

  // 違反文に出す種類の字面。文字列か数のときだけ字面にする（それ以外の値は字面にしない。字面にする道具が落ちないように）
  function kindText(v) {
    if (typeof v === 'string') return JSON.stringify(Array.from(v).length > 40 ? Array.from(v).slice(0, 39).join('') + '…' : v);
    if (typeof v === 'number') return String(v);
    return v === undefined ? '（欄が無い）' : '（文字でない値）';
  }

  // JSON オブジェクトが返事の形か（step.t / events[] / note.x）。整えて返す。形が違えば {ok:false, error, msg}（上と同じ）
  //   events の欄が無ければ []（何も書くことの無い窓）として読む。欄があって配列でなければ（null も）読めない返事。
  //   events の中に note があれば読めない返事（所感は events の外の note に 1 つだけ書く）。
  //   欄の値の入れ子が 32 段を超えていれば F02 で読めない返事にする（写しを作る前に断る。写す道具が落ちないように）。
  function shapeReply(obj) {
    if (!isPlain(obj)) return bad('返事がオブジェクトではありません', '返事が機械向けの形になっていない（ひとまとまりになっていない）');
    // 一番外の e の欄は返事に無い欄（schema.json）。rt.py は e のあるオブジェクトを JSONL の 1 行として読み、step で
    // 始まらないので断る。ページも同じく読めない返事にする（受理と拒否を揃える。ほかの知らない欄は捨てて通す）
    if (Object.prototype.hasOwnProperty.call(obj, 'e')) {
      return bad('返事の一番外に e の欄があります（返事は step・events・note のオブジェクトで、e は events の中の判断にだけ書きます）',
        '返事の形が違う（判断の種類の欄が、判断の並びの外にある）');
    }
    const step = obj.step;
    if (!isPlain(step)) {
      return bad(step === undefined ? '返事に step がありません（{"t":[始まり, 終わり]} のオブジェクトで書きます）' : '返事の step がオブジェクトではありません',
        '返事に、窓の始まりと終わりが無い');
    }
    if (!Array.isArray(step.t) || step.t.length !== 2) return bad('返事の step.t が [始まり, 終わり] ではありません', '返事に、窓の始まりと終わりが無い');
    if (valueDepth(step.t, VALUE_DEPTH_MAX) > VALUE_DEPTH_MAX) {
      return bad('F02: 返事の step.t の値の入れ子が ' + VALUE_DEPTH_MAX + ' 段を超えています', '返事の値の入れ子が深すぎる（' + VALUE_DEPTH_MAX + ' 段まで）');
    }
    const events = ('events' in obj) ? obj.events : [];
    if (!Array.isArray(events)) return bad('返事の events が配列ではありません（書くことが無い窓は [] にします）', '返事に、判断の並びが無い');
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const no = i + 1;
      if (!isPlain(e)) return bad('events の ' + no + ' 件目がオブジェクトではありません', '返事の ' + no + ' 件目の判断が、ひとまとまりになっていない');
      if (e.e === 'note') {
        return bad('events の ' + no + ' 件目が note です（所感は events の外の note に 1 つだけ書きます）', '返事の ' + no + ' 件目に所感が入っている（所感は判断の並びの外に 1 つだけ書く）');
      }
      if (EVENT_KINDS.indexOf(e.e) < 0) {
        return bad('events の ' + no + ' 件目の種類（e）が分かりません: ' + kindText(e.e), '返事の ' + no + ' 件目の判断の種類が分からない');
      }
      const keys = Object.keys(e);
      for (let k = 0; k < keys.length; k++) {
        if (valueDepth(e[keys[k]], VALUE_DEPTH_MAX) > VALUE_DEPTH_MAX) {
          return bad('F02: events の ' + no + ' 件目（' + e.e + '）の欄 ' + kindText(keys[k]) + ' の値の入れ子が ' + VALUE_DEPTH_MAX + ' 段を超えています',
            '返事の ' + no + ' 件目の値の入れ子が深すぎる（' + VALUE_DEPTH_MAX + ' 段まで）');
        }
      }
    }
    const note = obj.note;
    if (!isPlain(note) || typeof note.x !== 'string') {
      return bad('返事の note.x が文字列ではありません（所感は {"x":"…"} で 1 つだけ書きます）', '返事に、所感が無い');
    }
    return { ok: true, step: { t: step.t.slice() }, events: clone(events), note: { x: note.x } };
  }

  // ---- 返事 → 追記（rt.py の reply_to_batch と同じ） ----

  const THINK_MAX = 2000;
  function clip(s, n) { const a = Array.from(String(s)); return a.length > n ? a.slice(0, n).join('') : a.join(''); }

  // reply: {step:{t}, events:[], note:{x}, think?}。window: {n, lines, t}（道具が決めた窓）
  function toBatch(reply, window) {
    reply = reply || {};
    const w = window || {};
    const stp = (reply.step && typeof reply.step === 'object') ? reply.step : {};
    const step = { e: 'step', n: w.n, lines: Array.isArray(w.lines) ? w.lines.slice() : w.lines, t: Array.isArray(stp.t) ? stp.t.slice() : (stp.t === undefined ? null : clone(stp.t)) };
    if (typeof reply.think === 'string' && reply.think) step.think = clip(reply.think, THINK_MAX);
    const events = (Array.isArray(reply.events) ? reply.events : []).map(function (e) {
      const c = clone(e);
      // 返事の形（schema.json）では li が必須なので null で来る。記録では「無い」と同じなので欄ごと落とす
      if (c && typeof c === 'object' && c.e === 'card' && c.li === null) delete c.li;
      return c;
    });
    const batch = [step].concat(events);
    const note = reply.note;
    if (note && typeof note === 'object' && typeof note.x === 'string') {
      batch.push({ e: 'note', t: Array.isArray(step.t) && step.t.length === 2 ? step.t[1] : null, x: note.x });
    }
    return batch;
  }

  // ---- 構造化出力に渡すスキーマ ----

  // schema.json はそのまま渡さず、$schema と $id（文書の札）を外す。
  // 構造化出力が受けるのは型・enum・const・anyOf・$ref・additionalProperties:false まで（claude-api スキルの一覧）。
  // 字数や件数の制約は schema.json にもともと無い（検査器が落とす）
  function prepareSchema(schema) {
    if (!schema || typeof schema !== 'object') throw new Error('cfg.schema（format/schema.json の中身）がありません');
    const s = clone(schema);
    delete s.$schema;
    delete s.$id;
    return s;
  }

  // ---- L3: 手動の輪 ----

  // 指示＋状態の最小表現を1つの文字列に。Claude でも ChatGPT でも同じ契約
  function makePrompt(prefix, pack) {
    return String(prefix).replace(/\s+$/, '') +
      '\n\n---\n\n## 状態の最小表現（この窓）\n\n' +
      '次の JSON を読み、第5章の形の JSON を1個だけ返してください。説明文・前置き・コードフェンスは付けないでください。\n\n' +
      JSON.stringify(pack) + '\n';
  }

  // ---- usage の取り出し ----

  function usageAnthropic(u) {
    if (!u || typeof u !== 'object') return null;
    return {
      input_tokens: num(u.input_tokens),
      output_tokens: num(u.output_tokens),
      cache_read_input_tokens: num(u.cache_read_input_tokens),
      cache_creation_input_tokens: num(u.cache_creation_input_tokens)
    };
  }

  function usageOpenAI(u) {
    if (!u || typeof u !== 'object') return null;
    const d = u.prompt_tokens_details || {};
    return {
      input_tokens: num(u.prompt_tokens),
      output_tokens: num(u.completion_tokens),
      cache_read_input_tokens: num(d.cached_tokens),
      cache_creation_input_tokens: null
    };
  }

  function num(v) { return typeof v === 'number' ? v : (v == null ? null : Number(v)); }

  // ---- fetch（打ち切りつき。失敗の種類を分ける） ----

  // → {status, body, text, error}。error は 'network'（届かない・CORS で落ちた）/ 'timeout' / null
  async function post(url, headers, body, timeoutMs) {
    if (typeof fetch !== 'function') throw new Error('この環境に fetch がありません');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(function () { ctl.abort(); }, timeoutMs || DEFAULT_TIMEOUT) : null;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
    } catch (e) {
      if (timer) clearTimeout(timer);
      const aborted = e && (e.name === 'AbortError');
      return { status: 0, body: null, text: '', error: aborted ? 'timeout' : 'network', detail: String(e && e.message || e) };
    }
    if (timer) clearTimeout(timer);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { json = null; }
    return { status: res.status, body: json, text: text, error: null };
  }

  // 誤りの文は 2 つ持つ。message は送り先が返した誤りの文（error.message）やブラウザの文をそのまま含む機械向けの文、
  // screen は画面に出す日本語の文（英字の項目名や送り先の文を含めない）。
  // 返事の本文そのものは console にだけ出す（会社のプロキシの遮断ページのような HTML が返ってきても、画面にその文を流し込まない）
  function httpError(r, who) {
    if (r.error === 'timeout') return screened(new Error(who + ' への呼び出しが時間切れになりました'), '分析役の呼び出しが時間切れになった');
    if (r.error === 'network') return screened(new Error(who + ' に届きませんでした（ネットワークか CORS）: ' + r.detail), '分析役に届かなかった（ネットワークか、ブラウザが外への送信を止めた）');
    const msg = r.body && r.body.error && (r.body.error.message || r.body.error.type);
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn(who + ' の返事（状態 ' + r.status + '）の本文:', r.text);
    }
    if (r.status === 401 || r.status === 403) return screened(new Error(who + ' が認証を拒みました（' + r.status + '）' + (msg ? ': ' + msg : '')), '分析役の送り先が鍵を受け付けなかった（状態 ' + r.status + '）');
    if (r.status === 429) return screened(new Error(who + ' が混んでいます（429）。少し待ってもう一度' + (msg ? ': ' + msg : '')), '分析役の送り先が混んでいる（状態 429）。少し待ってもう一度');
    if (r.body == null) return screened(new Error(who + ' が ' + r.status + ' を返し、返事が機械向けの形ではない（会社の網が遮っている可能性）'), '分析役の送り先が状態 ' + r.status + ' を返し、返事が機械向けの形ではない（会社の網が遮っている可能性）');
    return screened(new Error(who + ' が ' + r.status + ' を返しました' + (msg ? ': ' + msg : '')), '分析役の送り先が状態 ' + r.status + ' を返した');
  }

  function screened(err, screen) { err.screen = screen; return err; }

  // ---- L1: Anthropic ----

  function anthropicHeaders(cfg) {
    return {
      'content-type': 'application/json',
      'x-api-key': String(cfg.key || ''),
      'anthropic-version': ANTHROPIC_VERSION,
      // ブラウザから直に叩くために要る（記憶・未検証）
      'anthropic-dangerous-direct-browser-access': 'true'
    };
  }

  function anthropicBody(cfg, prefix, userText, opts) {
    const body = {
      model: cfg.model || DEFAULT_MODEL,
      max_tokens: (opts && opts.maxTokens) || cfg.maxTokens || DEFAULT_MAX_TOKENS,
      system: [{ type: 'text', text: String(prefix), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userText }]
    };
    const oc = {};
    const effort = cfg.effort || (body.model === DEFAULT_MODEL ? DEFAULT_EFFORT : null);
    if (effort) oc.effort = effort;
    if (opts && opts.schema) oc.format = { type: 'json_schema', schema: opts.schema };
    if (Object.keys(oc).length) body.output_config = oc;
    if (cfg.think === 'summarized') body.thinking = { type: 'adaptive', display: 'summarized' };
    return body;
  }

  function anthropicText(body) {
    const blocks = (body && Array.isArray(body.content)) ? body.content : [];
    let text = '', think = null;
    blocks.forEach(function (b) {
      if (!b) return;
      if (b.type === 'text' && typeof b.text === 'string') text += b.text;
      if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking) think = (think || '') + b.thinking;
    });
    return { text: text, think: think };
  }

  async function analyzeAnthropic(cfg, pack, prefix) {
    if (!cfg.key) throw new Error('鍵がありません');
    const schema = prepareSchema(cfg.schema);
    const body = anthropicBody(cfg, prefix, JSON.stringify(pack), { schema: schema });
    const r = await post(ANTHROPIC_URL, anthropicHeaders(cfg), body, cfg.timeoutMs);
    if (r.error || r.status !== 200) throw httpError(r, 'Anthropic の API');
    const usage = usageAnthropic(r.body && r.body.usage);
    const stop = r.body && r.body.stop_reason;
    if (stop === 'refusal') throw withUsage(screened(new Error('分析役が返事を断りました（stop_reason: refusal）'), '分析役が返事を断った'), usage, r.text);
    const got = anthropicText(r.body);
    const p = parseReply(got.text);
    if (!p.ok) {
      const cut = stop === 'max_tokens';
      throw withUsage(screened(new Error((cut ? '返事が長さの上限で切れました。' : '') + p.error), (cut ? '返事が長さの上限で切れた。' : '') + p.msg), usage, got.text);
    }
    return { step: p.step, events: p.events, note: p.note, raw: got.text, usage: usage, think: got.think };
  }

  function withUsage(err, usage, raw) { err.usage = usage; err.raw = raw; return err; }

  // ---- L1: OpenAI 互換 ----

  function openaiHeaders(cfg) {
    const h = { 'content-type': 'application/json' };
    const name = cfg.keyHeader || 'Authorization';
    h[name] = name.toLowerCase() === 'authorization' ? 'Bearer ' + String(cfg.key || '') : String(cfg.key || '');
    return h;
  }

  function openaiUrl(cfg) {
    const base = String(cfg.base || 'https://api.openai.com/v1').replace(/\/+$/, '');
    return base + '/chat/completions';
  }

  function openaiBody(cfg, prefix, userText, opts) {
    const body = {
      model: cfg.model,
      messages: [{ role: 'system', content: String(prefix) }, { role: 'user', content: userText }]
    };
    if (opts && opts.schema) {
      body.response_format = { type: 'json_schema', json_schema: { name: 'analyst_reply', strict: true, schema: opts.schema } };
    }
    if (opts && opts.maxTokens) body.max_completion_tokens = opts.maxTokens;
    else if (cfg.maxTokens) body.max_completion_tokens = cfg.maxTokens;
    return body;
  }

  function openaiText(body) {
    const ch = body && Array.isArray(body.choices) && body.choices[0];
    const m = ch && ch.message;
    if (!m) return { text: '', finish: null, refusal: null };
    return { text: typeof m.content === 'string' ? m.content : '', finish: ch.finish_reason || null, refusal: m.refusal || null };
  }

  async function analyzeOpenAI(cfg, pack, prefix) {
    if (!cfg.key) throw new Error('鍵がありません');
    if (!cfg.model) throw new Error('モデル名がありません');
    const schema = prepareSchema(cfg.schema);
    const body = openaiBody(cfg, prefix, JSON.stringify(pack), { schema: schema });
    const r = await post(openaiUrl(cfg), openaiHeaders(cfg), body, cfg.timeoutMs);
    if (r.error || r.status !== 200) throw httpError(r, 'OpenAI 互換の API');
    const usage = usageOpenAI(r.body && r.body.usage);
    const got = openaiText(r.body);
    if (got.refusal) throw withUsage(screened(new Error('分析役が返事を断りました: ' + got.refusal), '分析役が返事を断った'), usage, got.text);
    const p = parseReply(got.text);
    if (!p.ok) {
      const cut = got.finish === 'length';
      throw withUsage(screened(new Error((cut ? '返事が長さの上限で切れました。' : '') + p.error), (cut ? '返事が長さの上限で切れた。' : '') + p.msg), usage, got.text);
    }
    return { step: p.step, events: p.events, note: p.note, raw: got.text, usage: usage, think: null };
  }

  // ---- L3: 手動 ----

  async function analyzeManual(cfg, pack, prefix) {
    if (typeof cfg.ask !== 'function') throw new Error('手動の輪には cfg.ask（プロンプトを渡して返事の文字列を返す関数）が要ります');
    const prompt = makePrompt(prefix, pack);
    const text = await cfg.ask(prompt);
    const p = parseReply(text);
    if (!p.ok) throw withUsage(screened(new Error(p.error), p.msg), null, text);
    return { step: p.step, events: p.events, note: p.note, raw: String(text), usage: null, think: null };
  }

  // ---- mock（試験用） ----

  // 判断ログ（イベントの配列）を step 番号 → 返事 に直す。
  // tests/README.md「mock 分析役の台本」のとおり: n・lines・at を落として step:{t} に、fix/rename の was と hold.kind を落とし、
  // li の無いカードは li:null に、note は {x} に。
  // kind:"gap" の保留だけのステップ（検証に3回落ちた窓）は、台本では「わざと壊れた返事」を返す
  function scriptFromLog(events) {
    const steps = Object.create(null);
    let cur = null;
    (events || []).forEach(function (e) {
      if (!e || typeof e !== 'object') return;
      if (e.e === 'step') { cur = { n: e.n, t: e.t.slice(), events: [], note: null, gap: false }; steps[e.n] = cur; return; }
      if (e.e === 'open' || e.e === 'end' || e.e === 'pause') { cur = null; return; }
      if (!cur) return;
      if (e.e === 'note') { cur.note = { x: e.x }; return; }
      if (e.e === 'hold' && e.kind === 'gap') { cur.gap = true; return; }
      const c = clone(e);
      if (c.e === 'fix' || c.e === 'rename') delete c.was;
      if (c.e === 'hold') delete c.kind;
      if (c.e === 'card' && !('li' in c)) c.li = null;
      cur.events.push(c);
    });
    return steps;
  }

  // 検証に落ちる返事（gap の窓の台本）。t が窓の先（P09）で、ti が 51 字（F04）
  function brokenReply(t, nextIds) {
    const ti = Array(52).join('あ'); // 51 字
    return {
      step: { t: t.slice() },
      events: [{ e: 'card', id: (nextIds && nextIds.card) || 'C1', t: t[1] + 10, d: 1, role: 'claim', who: null, src: [], li: null, ti: ti, b: '' }],
      note: { x: '（試験用の壊れた返事）' }
    };
  }

  function makeMock(cfg) {
    const steps = scriptFromLog(cfg.script);
    return async function (pack) {
      const n = pack && pack.now && pack.now.n;
      const s = steps[n];
      if (!s) return { step: null, events: [], note: null, raw: '', usage: null, think: null, ended: true };
      const t = (pack.new && pack.new.t) ? pack.new.t : s.t;
      let reply;
      if (s.gap) reply = brokenReply(t, pack.next_ids);
      else reply = { step: { t: t.slice() }, events: clone(s.events), note: s.note || { x: '' } };
      const raw = JSON.stringify(reply);
      return { step: reply.step, events: reply.events, note: reply.note, raw: raw, usage: null, think: null };
    };
  }

  // ---- 共通の口 ----

  function makeAnalyst(cfg) {
    cfg = cfg || {};
    let fn;
    switch (cfg.kind) {
      case 'anthropic': fn = function (pack, prefix) { return analyzeAnthropic(cfg, pack, prefix); }; break;
      case 'openai': fn = function (pack, prefix) { return analyzeOpenAI(cfg, pack, prefix); }; break;
      case 'manual': fn = function (pack, prefix) { return analyzeManual(cfg, pack, prefix); }; break;
      case 'mock': fn = makeMock(cfg); break;
      default: throw new Error('分析役の種類（cfg.kind）が分かりません: ' + JSON.stringify(cfg.kind));
    }
    return { kind: cfg.kind, analyze: fn, label: LABEL[cfg.kind] };
  }

  const LABEL = { anthropic: 'API（Anthropic）', openai: 'API（OpenAI 互換）', manual: '手動（遅い）', mock: '試験用の台本' };

  function analyze(pack, prefix, cfg) { return makeAnalyst(cfg).analyze(pack, prefix); }

  // ---- 接続テスト ----

  // 小さな呼び出しで、到達・認証・usage を返す。prefix を渡すと接頭辞ごと送り、キャッシュに乗るかを見られる。
  // opts.repeat が true なら同じ呼び出しを2回して、2回目の cache_read_input_tokens を cache_read に出す（1回目は書き込みになる）。
  // → {ok, reached, authed, status, usage, cache_read, model, error}
  //   reached  API に届いた（HTTP の返事があった）
  //   authed   鍵が通った（200）
  async function testConnection(cfg, prefix, opts) {
    cfg = cfg || {};
    opts = opts || {};
    const out = { ok: false, reached: false, authed: false, status: 0, usage: null, cache_read: null, model: cfg.model || null, error: null };
    if (cfg.kind !== 'anthropic' && cfg.kind !== 'openai') { out.error = '接続テストは API の分析役にだけ使えます'; return out; }
    if (!cfg.key) { out.error = '鍵がありません'; return out; }
    const sys = prefix ? String(prefix) : '返事は短くしてください。';
    const ask = '「了解」とだけ答えてください。';
    const one = async function () {
      if (cfg.kind === 'anthropic') {
        // 思考も上限に数えるので、短い答えでも余裕を持たせる。考える量を送るモデルなら low にする
        const body = anthropicBody(cfg, sys, ask, { maxTokens: 1024 });
        if (body.output_config && body.output_config.effort) body.output_config = { effort: 'low' };
        const r = await post(ANTHROPIC_URL, anthropicHeaders(cfg), body, cfg.timeoutMs);
        return { r: r, usage: usageAnthropic(r.body && r.body.usage), model: r.body && r.body.model };
      }
      const body = openaiBody(cfg, sys, ask, { maxTokens: 64 });
      const r = await post(openaiUrl(cfg), openaiHeaders(cfg), body, cfg.timeoutMs);
      return { r: r, usage: usageOpenAI(r.body && r.body.usage), model: r.body && r.body.model };
    };
    let got;
    try { got = await one(); } catch (e) { out.error = String(e && e.message || e); return out; }
    out.status = got.r.status;
    // 接続テストの結果は画面（API の設定の欄）に出すので、誤りは画面向けの文で返す
    if (got.r.error) { out.error = httpError(got.r, 'API').screen; return out; }
    out.reached = true;
    if (got.r.status !== 200) { out.error = httpError(got.r, 'API').screen; return out; }
    out.authed = true;
    out.usage = got.usage;
    if (got.model) out.model = got.model;
    if (opts.repeat) {
      try {
        const again = await one();
        if (!again.r.error && again.r.status === 200 && again.usage) out.cache_read = again.usage.cache_read_input_tokens;
      } catch (e) { /* 2回目の失敗は結果に影響させない */ }
    } else if (got.usage) {
      out.cache_read = got.usage.cache_read_input_tokens;
    }
    out.ok = true;
    return out;
  }

  // ---- 鍵の置き場 ----

  const KEY_PREFIX = 'tsv.key.';

  function storage(name) {
    try {
      const s = globalThis[name];
      if (!s) return null;
      const probe = KEY_PREFIX + 'probe';
      s.setItem(probe, '1'); s.removeItem(probe);
      return s;
    } catch (e) { return null; }
  }

  const keys = {
    // sessionStorage → localStorage の順に探す。無ければ null
    load: function (name) {
      const k = KEY_PREFIX + name;
      const ss = storage('sessionStorage');
      try { if (ss && ss.getItem(k)) return ss.getItem(k); } catch (e) { /* 読めない */ }
      const ls = storage('localStorage');
      try { if (ls && ls.getItem(k)) return ls.getItem(k); } catch (e) { /* 読めない */ }
      return null;
    },
    // remember=false: sessionStorage だけ（localStorage に残っていたら消す）。remember=true: localStorage にも
    save: function (name, key, remember) {
      const k = KEY_PREFIX + name;
      const ss = storage('sessionStorage'), ls = storage('localStorage');
      let where = [];
      try { if (ss) { ss.setItem(k, key); where.push('session'); } } catch (e) { /* 書けない */ }
      try {
        if (ls) {
          if (remember) { ls.setItem(k, key); where.push('local'); }
          else ls.removeItem(k);
        }
      } catch (e) { /* 書けない */ }
      return where;
    },
    clear: function (name) {
      const k = KEY_PREFIX + name;
      const ss = storage('sessionStorage'), ls = storage('localStorage');
      try { if (ss) ss.removeItem(k); } catch (e) { /* 消せない */ }
      try { if (ls) ls.removeItem(k); } catch (e) { /* 消せない */ }
    },
    // localStorage に覚えてあるか
    remembered: function (name) {
      const ls = storage('localStorage');
      try { return !!(ls && ls.getItem(KEY_PREFIX + name)); } catch (e) { return false; }
    }
  };

  // 設定の書き出し。鍵（key）と関数（ask）と台本（script）とスキーマ（schema）は含めない
  function exportSettings(cfg) {
    const out = Object.create(null); // 読み込んだ設定の鍵をそのまま使うので、素の表にする
    Object.keys(cfg || {}).forEach(function (k) {
      if (k === 'key' || k === 'ask' || k === 'script' || k === 'schema') return;
      if (typeof cfg[k] === 'function') return;
      out[k] = cfg[k];
    });
    return JSON.stringify(out, null, 1);
  }

  const api = {
    makeAnalyst: makeAnalyst, analyze: analyze, testConnection: testConnection,
    makePrompt: makePrompt, parseReply: parseReply, shapeReply: shapeReply, toBatch: toBatch, prepareSchema: prepareSchema,
    scriptFromLog: scriptFromLog, keys: keys, exportSettings: exportSettings,
    ANTHROPIC_URL: ANTHROPIC_URL, ANTHROPIC_VERSION: ANTHROPIC_VERSION, DEFAULT_MODEL: DEFAULT_MODEL,
    _internal: { anthropicBody: anthropicBody, openaiBody: openaiBody, openaiUrl: openaiUrl, anthropicHeaders: anthropicHeaders, openaiHeaders: openaiHeaders, usageAnthropic: usageAnthropic, usageOpenAI: usageOpenAI }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_ANALYST = api;
})();
