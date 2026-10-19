/*
 * analyst.js — 分析役（読み手）を呼ぶ共通の入口
 *
 * 共通の入口:
 *   const an = makeAnalyst(cfg);                  // cfg.kind で実装を選ぶ（下の表）
 *   const r  = await an.analyze(pack, prefix);    // → {step, events, note, raw, usage, think}
 *   // pack   状態の最小表現（format/pack.md の形。ツールが作る）
 *   // prefix 固定の指示（prompts/analyst.md の全文。キャッシュに載る接頭辞）
 *   // step   {t:[a,b]}        events  イベントの配列（schema.json の形）   note  {x}
 *   // raw    分析役が返した文字列そのもの（記録・調査用）
 *   // usage  {input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}（取れた分だけ。無ければ null）
 *   // think  思考の要約（取れたときだけ文字列。無ければ null）
 *   返事の形（JSON として読めるか・step/events/note があるか・欄の値の入れ子が 32 段までか）だけをここで見る。
 *   読み方は rt.py と同じ（format/FORMAT.md「返事の読み方」。全体の ``` の囲みは 1 回だけ外し、前置き・後書きは読まない）。
 *   中身の正しさ（時刻・id・上限）は verify.js（rt.py）が落とす。
 *   エラーの文は 2 つ持つ: 分析役に返す機械向けの文（parseReply の error、投げた Error の message。項目名をそのまま使う）と、
 *   画面に出す日本語の文（parseReply の msg、投げた Error の screen。英字の項目名を出さない）。
 *   投げた Error に fatal:true が付いていれば、もう一度呼んでも同じに落ちるエラー（この画面に Claude を呼び出す機能が無い・閲覧者が許していない）。
 *   app 側は 3 回の再試行をせずに止めてよい。付いていなければ再試行できる。
 *
 * 返事 → 追記（記録の形）:
 *   const batch = toBatch(reply, window);     // window = {n, lines:[i,j], t:[a,b]}（ツールが決めた窓。n は書くステップ番号）
 *   // rt.py の reply_to_batch と同じ直し方: step に n・lines をツールが埋め（t は返事の step.t）、think が空でない文字列なら
 *   // 載せ（上限の 2000 字で切る）、card の li が null なら欄ごと落とし（記録では「無い」と同じ）、
 *   // note は {x} が文字列のときだけ {e:'note', t: step.t[1], x} として末尾に置く。
 *   // 返事に無いものを補わない（step.t が無ければ無いまま → 検査器が落とす）。
 *
 * 実装（cfg.kind）:
 *   'anthropic'  L1。fetch で https://api.anthropic.com/v1/messages を直に叩く
 *   'openai'     L1。OpenAI 互換の <base>/chat/completions を直に叩く（Azure 等）
 *   'manual'     L3。プロンプトを1つの文字列にして人に渡し、貼られた返事を読む（cfg.ask を通す）
 *   'claude'     この画面を開いている Claude に問う（claude.ai のアーティファクトの中だけ。API キーは要らず、閲覧者の使用量を使う）。
 *                呼び出し方は 2 つあり、最初の analyze で 1 回だけ決めて覚える:
 *                  (1) claude.use が関数 → sample = await claude.use('sample')。null なら、この画面では問えない（fatal）
 *                  (2) use が無く claude.complete が関数 → 古い形（チャットで作るアーティファクト）。complete(prompt) → 文字列
 *                  (3) どちらも無い → この画面には Claude を呼び出す機能が無い（アーティファクトの外で開いている。fatal）
 *                問いは makePrompt（「手動でチャットに貼る」と同じ 1 つの文字列）。返事は parseReply で読む（囲みは 1 回だけ外す）。
 *                返事の形・エラーの種類は、束ねた型定義（artifact-capabilities の sample.d.ts）に合わせてある:
 *                  sample(prompt, {modelTier, cache:false, signal}) → {text, truncated, modelTierApplied}
 *                  失敗は {code, message, text?} の素のオブジェクトで来る（Error ではない）。code で分ける（message では分けない）
 *                sample は閲覧者の同意を最初の呼び出しで求める（呼び出しは閲覧者が決めるまで待つ。こちらからタイムアウトにしない）
 *   'mock'       テスト用。tests/fixtures/meeting10.jsonl のバッチを step 番号順に返す
 *
 * cfg の欄:
 *   kind       上の5つのどれか
 *   claude     claude: Claude を呼び出す機能を持つオブジェクト（テストではモックを渡す）。省略すると globalThis.claude
 *   tier       claude: 'quick' | 'default' | 'complex'（既定 'default'。知らない値も 'default'）
 *   key        API キー（anthropic / openai）。設定の書き出しには含めない
 *   model      モデル名（anthropic の既定 'claude-opus-5-5'。openai は必須）
 *   base       openai: 'https://api.openai.com/v1' のような土台の URL（末尾の / は無くてよい）
 *   effort     anthropic: output_config.effort（'low'|'medium'|'high'|'xhigh'|'max'）。省略したとき、モデルが既定
 *              （DEFAULT_MODEL）なら 'medium' を送り、ほかのモデルなら送らない（effort を受けないモデルがあるため）
 *              claude: 'low'|'medium'|'high' のときだけ sample に渡す（それ以外の値は渡さない。sample は 3 つしか受けない）
 *   think      anthropic: 'summarized' を指定したときだけ thinking:{type:'adaptive',display:'summarized'} を送る。
 *              既定は送らない（Opus 5.5 は思考を切れないので、思考の量は effort で決まる）
 *   maxTokens  返事の上限（既定 16000。思考も含めた上限なので、返事の JSON だけの長さより大きく取る）
 *   timeoutMs  1回の呼び出しの打ち切り（anthropic / openai の既定 120000）。
 *              claude の sample には、指定したときだけ効く（signal を切る）。既定は置かない——型定義が「タイムアウトを自分で作るな。
 *              仕組みの側が長すぎる呼び出しを終える。ページ側の時計は、閲覧者が同意の画面を読む時間も数えてしまう」と言い、
 *              既定の段では長い指示文で書き始めるまでに 2 分近くかかることがある（1 回の問いは約 5 分で仕組みが打ち切る）。
 *              120 秒で切ると、考えている最中に切って同じ窓を 3 回払い直したうえ空振りになる。
 *              古い形の complete には signal が無いので、指定が無ければ 120000 で待つのをやめる（永久に待たないため）
 *   schema     format/schema.json の中身（構造化出力に渡す。file:// では fetch できないので組み立て時に埋め込む）
 *   ask        manual: (promptText) => Promise<string>。人にプロンプトを見せ、貼られた返事の文字列を返す
 *   script     mock: 判断ログのイベントの配列（meeting10.jsonl を読んだもの）
 *
 * 註（未検証・記憶）:
 *   - ブラウザから直に叩くには、Anthropic はヘッダー `anthropic-dangerous-direct-browser-access: true` が要る（記憶。
 *     無いと CORS で落ちる、と記憶している。実機で未検証）。API キーをページに置くことになるので、個人の API キーを会社の会議に使う道は
 *     設計として置かない（README に書く）
 *   - OpenAI 互換の response_format:{type:'json_schema', json_schema:{name, strict:true, schema}} は記憶で、未検証。
 *     Azure 等では base の形が違い、API キーのヘッダーも `api-key` のことがある（cfg.keyHeader で変えられる）
 *   - 構造化出力は形だけを保証する。max_tokens で切れた返事（stop_reason:'max_tokens'）は JSON として読めないことがある
 *
 * API キーの置き場:
 *   keys.load(name) / keys.save(name, key, remember) / keys.clear(name)
 *   既定は sessionStorage（タブを閉じると消える）。remember=true（「この PC に保存する」）のときだけ localStorage。
 *   どちらも読めない環境（file:// の制限など）では null を返し、ページは API キーの欄に貼り直させる。
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
  // trim に任せず書き出すのは、ブラウザや Unicode のバージョンで集まりが揺れないようにするため
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
    if (typeof text !== 'string') return bad('返事が文字列ではありません', '返事がテキストになっていない');
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
        '返事を読めなかった（決まった形式になっていないか、前後に余計な文が付いている）');
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

  // 読めなければ undefined（入れ子が深すぎてJSON を読む処理が持たないときも落ちない）
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

  // 違反文に出す種類の字面。文字列か数のときだけ字面にする（それ以外の値は字面にしない。字面にする処理が落ちないように）
  function kindText(v) {
    if (typeof v === 'string') return JSON.stringify(Array.from(v).length > 40 ? Array.from(v).slice(0, 39).join('') + '…' : v);
    if (typeof v === 'number') return String(v);
    return v === undefined ? '（欄が無い）' : '（文字列でない値）';
  }

  // JSON オブジェクトが返事の形か（step.t / events[] / note.x）。整えて返す。形が違えば {ok:false, error, msg}（上と同じ）
  //   events の欄が無ければ []（何も書くことの無い窓）として読む。欄があって配列でなければ（null も）読めない返事。
  //   events の中に note があれば読めない返事（所感は events の外の note に 1 つだけ書く）。
  //   欄の値の入れ子が 32 段を超えていれば F02 で読めない返事にする（コピーを作る前に断る。コピーする処理が落ちないように）。
  function shapeReply(obj) {
    if (!isPlain(obj)) return bad('返事がオブジェクトではありません', '返事が決まった形式になっていない');
    // 一番外の e の欄は返事に無い欄（schema.json）。rt.py は e のあるオブジェクトを JSONL の 1 行として読み、step で
    // 始まらないので断る。ページも同じく読めない返事にする（受理と拒否を揃える。ほかの知らない欄は捨てて通す）
    if (Object.prototype.hasOwnProperty.call(obj, 'e')) {
      return bad('返事の一番外に e の欄があります（返事は step・events・note のオブジェクトで、e は events の中の判断にだけ書きます）',
        '返事の形が違う（判断の種類の欄が、判断の並びの外にある）');
    }
    const step = obj.step;
    if (!isPlain(step)) {
      return bad(step === undefined ? '返事に step がありません（{"t":[始まり, 終わり]} のオブジェクトで書きます）' : '返事の step がオブジェクトではありません',
        '返事に、区切りの始まりと終わりが無い');
    }
    if (!Array.isArray(step.t) || step.t.length !== 2) return bad('返事の step.t が [始まり, 終わり] ではありません', '返事に、区切りの始まりと終わりが無い');
    if (valueDepth(step.t, VALUE_DEPTH_MAX) > VALUE_DEPTH_MAX) {
      return bad('F02: 返事の step.t の値の入れ子が ' + VALUE_DEPTH_MAX + ' 段を超えています', '返事の値の入れ子が深すぎる（' + VALUE_DEPTH_MAX + ' 段まで）');
    }
    const events = ('events' in obj) ? obj.events : [];
    if (!Array.isArray(events)) return bad('返事の events が配列ではありません（書くことが無い窓は [] にします）', '返事に、判断の並びが無い');
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const no = i + 1;
      if (!isPlain(e)) return bad('events の ' + no + ' 件目がオブジェクトではありません', '返事の ' + no + ' 件目の判断が、決まった形式になっていない');
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

  // reply: {step:{t}, events:[], note:{x}, think?}。window: {n, lines, t}（ツールが決めた窓）
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

  // schema.json はそのまま渡さず、$schema と $id（文書の識別子）を外す。
  // 構造化出力が受けるのは型・enum・const・anyOf・$ref・additionalProperties:false まで（claude-api スキルの一覧）。
  // 字数や件数の制約は schema.json にもともと無い（検査器が落とす）
  function prepareSchema(schema) {
    if (!schema || typeof schema !== 'object') throw new Error('cfg.schema（format/schema.json の中身）がありません');
    const s = clone(schema);
    delete s.$schema;
    delete s.$id;
    return s;
  }

  // ---- L3: 手動でチャットに貼る ----

  // 指示＋状態の最小表現を1つの文字列に。Claude でも ChatGPT でも同じ仕様
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

  // エラーの文は 2 つ持つ。message は送り先が返したエラーの文（error.message）やブラウザの文をそのまま含む機械向けの文、
  // screen は画面に出す日本語の文（英字の項目名や送り先の文を含めない）。
  // 返事の本文そのものは console にだけ出す（会社のプロキシの遮断ページのような HTML が返ってきても、画面にその文を流し込まない）
  function httpError(r, who) {
    if (r.error === 'timeout') return screened(new Error(who + ' への呼び出しがタイムアウトしました'), '整理する AI の呼び出しがタイムアウトした');
    if (r.error === 'network') return screened(new Error(who + ' に届きませんでした（ネットワークか CORS）: ' + r.detail), '整理する AI に届かなかった（ネットワークか、ブラウザが外への送信を止めた）');
    const msg = r.body && r.body.error && (r.body.error.message || r.body.error.type);
    if (typeof console !== 'undefined' && console && typeof console.warn === 'function') {
      console.warn(who + ' の返事（ステータス ' + r.status + '）の本文:', r.text);
    }
    if (r.status === 401 || r.status === 403) return screened(new Error(who + ' が認証を拒みました（' + r.status + '）' + (msg ? ': ' + msg : '')), '整理する AI の送り先が API キーを受け付けなかった（ステータス ' + r.status + '）');
    if (r.status === 429) return screened(new Error(who + ' からリクエストが多すぎると断られました（429。利用の上限に達した可能性）。少し待ってから、もう一度試してください' + (msg ? ': ' + msg : '')), '整理する AI の送り先から、リクエストが多すぎると断られた（ステータス 429。利用の上限に達した可能性）。少し待ってから、もう一度試す');
    if (r.body == null) return screened(new Error(who + ' が ' + r.status + ' を返し、応答が API の形式ではない（会社のネットワークが遮断している可能性）'), '整理する AI の送り先がステータス ' + r.status + ' を返し、返事が API の形式ではない（会社のネットワークが遮断している可能性）');
    return screened(new Error(who + ' が ' + r.status + ' を返しました' + (msg ? ': ' + msg : '')), '整理する AI の送り先がステータス ' + r.status + ' を返した');
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
    if (!cfg.key) throw new Error('API キーがありません');
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
    if (!cfg.key) throw new Error('API キーがありません');
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
    if (typeof cfg.ask !== 'function') throw new Error('「手動でチャットに貼る」には cfg.ask（プロンプトを渡して返事の文字列を返す関数）が要ります');
    const prompt = makePrompt(prefix, pack);
    const text = await cfg.ask(prompt);
    const p = parseReply(text);
    if (!p.ok) throw withUsage(screened(new Error(p.error), p.msg), null, text);
    return { step: p.step, events: p.events, note: p.note, raw: String(text), usage: null, think: null };
  }

  // ---- この画面を開いている Claude（アーティファクトの中） ----

  const CLAUDE_WHO = 'この画面の Claude';
  const TIERS = ['quick', 'default', 'complex'];
  const SAMPLE_EFFORTS = ['low', 'medium', 'high'];
  // もう一度呼んでも同じに落ちるエラーの種類（sample.d.ts「Hide the feature for this view — permanent」のグループ）。
  // 依頼では not_granted だけを致命としていたが、型定義が同じグループに置く 4 つも同じ扱いにする（3 回呼び直しても同じ答えしか来ない）
  const FATAL_CODES = {
    not_granted: ['閲覧者がこの画面で Claude を使うことを許可していません（not_granted）', 'この画面から分析役を呼び出すことが許可されていない'],
    sampling_disabled: ['この利用者（または組織）では Claude を呼び出せません（sampling_disabled）', 'アカウントか組織の設定で、この画面から分析役を呼び出せないようになっている'],
    not_declared: ['この画面は Claude を呼び出す機能を宣言していません（not_declared）', 'この画面には分析役を呼び出す権限が無い（作り直しが必要）'],
    capability_disabled: ['この画面では Claude を呼び出す機能が止められています（capability_disabled）', 'この画面では分析役を呼び出す機能が止められている'],
    capability_removed: ['この表示環境には Claude を呼び出す機能がありません（capability_removed）', 'この表示環境には分析役を呼び出す機能が無い（古い表示環境）']
  };

  function fatalError(message, screen) { const e = screened(new Error(message), screen); e.fatal = true; return e; }

  // 呼び出し方を決める（1 回だけ呼ぶ）。→ {sample} か {complete}。無ければ fatal の Error を投げる
  async function claudeMouth(cfg) {
    const c = (cfg && cfg.claude) || globalThis.claude;
    if (c && typeof c.use === 'function') {
      let s = null, why = '';
      // use は null を返す約束（例外を投げない）だが、投げても同じ「無い」として扱う
      try { s = await c.use('sample'); } catch (e) { s = null; why = ': ' + String(e && e.message || e); }
      if (typeof s !== 'function') throw fatalError('この画面では Claude を呼び出せない（sample の機能が無い）' + why, 'この画面からは分析役を呼び出せない（呼び出す権限が与えられていない）');
      return { sample: s };
    }
    if (c && typeof c.complete === 'function') return { complete: function (p) { return c.complete(p); } };
    throw fatalError('この画面には Claude を呼び出す機能が無い（アーティファクトの外）', 'この画面には分析役を呼び出す機能が無い（アーティファクトの外で開いている）');
  }

  // sample が投げる {code, message, text?}（素のオブジェクト。Error のこともある）を、この経路の Error に直す。
  // timedOut は、こちらの打ち切りで signal を切った後に来た cancelled をタイムアウトとして読むため
  function claudeError(e, timedOut) {
    const code = e && typeof e.code === 'string' ? e.code : null;
    const detail = e && typeof e.message === 'string' && e.message ? ': ' + e.message : '';
    let err;
    if (!code) err = screened(new Error(CLAUDE_WHO + ' の呼び出しに失敗しました' + detail), '分析役の呼び出しに失敗した');
    else if (FATAL_CODES[code]) err = fatalError(FATAL_CODES[code][0] + detail, FATAL_CODES[code][1]);
    else if (code === 'cancelled') {
      err = timedOut ? screened(new Error(CLAUDE_WHO + ' への呼び出しがタイムアウトしました'), '分析役の呼び出しがタイムアウトした')
        : screened(new Error(CLAUDE_WHO + ' への呼び出しが中止されました' + detail), '分析役の呼び出しが中止された');
    }
    else if (code === 'rate_limited') err = screened(new Error(CLAUDE_WHO + ' が混んでいるか、閲覧者の使用量の上限に達しました（rate_limited）。少し待ってから、もう一度試してください' + detail), '分析役が混んでいるか、使用量の上限に達した。少し待ってから、もう一度試す');
    else if (code === 'refused') err = screened(new Error('分析役が返事を断りました（refused）' + detail), '分析役が返事を断った');
    else if (code === 'empty_completion') err = screened(new Error('分析役が何も書きませんでした（empty_completion）' + detail), '分析役が何も書かなかった');
    else if (code === 'prompt_too_large') err = screened(new Error('送る内容（プロンプト）が大きすぎます（prompt_too_large。256 KiB まで）' + detail), '送る内容が大きすぎる（「設定と記録」の「区切りの長さ」を短くする）');
    else if (code === 'session_expired') err = screened(new Error('閲覧者のサインインが切れています（session_expired）' + detail), 'サインインが切れている（サインインし直してから、もう一度試す）');
    else err = screened(new Error(CLAUDE_WHO + ' がエラーを返しました（' + code + '）' + detail), '分析役がエラーを返した');
    err.code = code;
    if (e && typeof e.text === 'string') err.raw = e.text;
    return err;
  }

  // こちらで打ち切るまでの時間（ms）。null なら打ち切らない（仕組みの側に任せる）
  //   sample:   cfg.timeoutMs が正の数のときだけ。既定は null（型定義「タイムアウトを自分で作るな」。閲覧者が同意の画面を読む間も
  //             呼び出しは待つし、既定の段では書き始めるまで 2 分近くかかることがある。1 回の問いは約 5 分で仕組みが打ち切る）
  //   complete: cfg.timeoutMs か DEFAULT_TIMEOUT（古い形には signal が無く、仕組みの打ち切りも分からないので、待つのをやめる）
  function claudeTimeoutMs(cfg, mouth) {
    const given = cfg && typeof cfg.timeoutMs === 'number' && isFinite(cfg.timeoutMs) && cfg.timeoutMs > 0 ? cfg.timeoutMs : null;
    if (mouth && mouth.sample) return given;
    return given || DEFAULT_TIMEOUT;
  }

  // 決めた呼び出し方で 1 つの文字列を投げて、返事の文字列を受け取る。→ {text, truncated, tier}
  //   打ち切り: claudeTimeoutMs のとおり。切るときは sample の signal を切り、どちらの呼び出し方でも待つのをやめる
  //   （signal を見ない呼び出し方でも、こちらはタイムアウトで返る）
  async function claudeAsk(mouth, cfg, prompt, opts) {
    opts = opts || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const limit = claudeTimeoutMs(cfg, mouth);
    let timer = null, timedOut = false;
    const gate = limit == null ? null : new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        timedOut = true;
        if (ctl) ctl.abort();
        reject({ code: 'cancelled', message: 'timeout' });
      }, limit);
    });
    let run;
    if (mouth.sample) {
      const o = { modelTier: TIERS.indexOf(opts.tier || cfg.tier) >= 0 ? (opts.tier || cfg.tier) : 'default', cache: false };
      if (ctl) o.signal = ctl.signal;
      if (SAMPLE_EFFORTS.indexOf(cfg.effort) >= 0) o.effort = cfg.effort;
      // sample は同期には投げない約束だが、投げても同じ失敗として扱う
      run = Promise.resolve().then(function () { return mouth.sample(prompt, o); });
    } else {
      run = Promise.resolve().then(function () { return mouth.complete(prompt); });
    }
    let r;
    try { r = await (gate ? Promise.race([run, gate]) : run); }
    catch (e) { if (timer) clearTimeout(timer); throw claudeError(e, timedOut); }
    if (timer) clearTimeout(timer);
    if (mouth.sample) {
      if (!r || typeof r.text !== 'string') throw screened(new Error(CLAUDE_WHO + ' の返事が {text, truncated} の形ではありません'), '分析役の返事が、決まった形式で来なかった');
      return { text: r.text, truncated: r.truncated === true, tier: typeof r.modelTierApplied === 'string' ? r.modelTierApplied : null };
    }
    if (typeof r !== 'string') throw screened(new Error(CLAUDE_WHO + '（古い形）の返事が文字列ではありません'), '分析役の返事がテキストになっていない');
    return { text: r, truncated: false, tier: null };
  }

  async function analyzeClaude(mouth, cfg, pack, prefix) {
    const m = await mouth();   // 1 回目で決めて覚える。決められなければ fatal の Error（2 回目も同じ Error）
    const prompt = makePrompt(prefix, pack);
    const got = await claudeAsk(m, cfg, prompt);
    if (got.truncated) throw withUsage(screened(new Error('返事が途中で切れました（長さか時間の上限。truncated）'), '返事が途中で切れた（長さか時間の上限）'), null, got.text);
    const p = parseReply(got.text);
    if (!p.ok) throw withUsage(screened(new Error(p.error), p.msg), null, got.text);
    return { step: p.step, events: p.events, note: p.note, raw: got.text, usage: null, think: null, tier: got.tier };
  }

  // 1 回だけ呼んで結果（成功も失敗も）を覚える
  function once(fn) { let p = null; return function () { if (!p) p = fn(); return p; }; }

  // ---- mock（テスト用） ----

  // 判断ログ（イベントの配列）を step 番号 → 返事 に直す。
  // tests/README.md「内蔵のダミー（テスト用）」のとおり: n・lines・at を落として step:{t} に、fix/rename の was と hold.kind を落とし、
  // li の無いカードは li:null に、note は {x} に。
  // kind:"gap" の保留だけのステップ（検証に3回落ちた窓）は、内蔵のダミーは「わざと壊れた返事」を返す
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

  // 検証に落ちる返事（gap の窓に返すダミーの返事）。t が窓の先（P09）で、ti が 51 字（F04）
  function brokenReply(t, nextIds) {
    const ti = Array(52).join('あ'); // 51 字
    return {
      step: { t: t.slice() },
      events: [{ e: 'card', id: (nextIds && nextIds.card) || 'C1', t: t[1] + 10, d: 1, role: 'claim', who: null, src: [], li: null, ti: ti, b: '' }],
      note: { x: '（テスト用の壊れた返事）' }
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

  // ---- 共通の入口 ----

  function makeAnalyst(cfg) {
    cfg = cfg || {};
    let fn;
    switch (cfg.kind) {
      case 'anthropic': fn = function (pack, prefix) { return analyzeAnthropic(cfg, pack, prefix); }; break;
      case 'openai': fn = function (pack, prefix) { return analyzeOpenAI(cfg, pack, prefix); }; break;
      case 'manual': fn = function (pack, prefix) { return analyzeManual(cfg, pack, prefix); }; break;
      case 'claude': {
        const mouth = once(function () { return claudeMouth(cfg); });
        fn = function (pack, prefix) { return analyzeClaude(mouth, cfg, pack, prefix); };
        break;
      }
      case 'mock': fn = makeMock(cfg); break;
      default: throw new Error('分析役の種類（cfg.kind）が分かりません: ' + JSON.stringify(cfg.kind));
    }
    return { kind: cfg.kind, analyze: fn, label: LABEL[cfg.kind] };
  }

  const LABEL = { anthropic: 'API（Anthropic）', openai: 'API（OpenAI 互換）', manual: '手動でチャットに貼る（遅い）', claude: 'この画面の Claude（アーティファクトの中）', mock: '内蔵のダミー（テスト用）' };

  function analyze(pack, prefix, cfg) { return makeAnalyst(cfg).analyze(pack, prefix); }

  // ---- 接続テスト ----

  // 小さな呼び出しで、到達・認証・usage を返す。prefix を渡すと接頭辞ごと送り、キャッシュに載るかを見られる。
  // opts.repeat が true なら同じ呼び出しを2回して、2回目の cache_read_input_tokens を cache_read に出す（1回目は書き込みになる）。
  // → {ok, reached, authed, status, usage, cache_read, model, error}
  //   reached  API に届いた（HTTP の応答があった）
  //   authed   API キーが通った（200）
  // kind 'claude' のとき: 呼び出し方を決めて（reached）、短い問いを sample（tier quick）か complete に投げ、返事が来れば ok（authed は
  //   閲覧者が許したことを示すフラグ）。status・usage・cache_read は無い（0・null のまま）。model には答えたモデルの区分（modelTierApplied）を入れる。
  //   prefix は送らない（アーティファクトの中の Claude はキャッシュを持たないので、接頭辞ごと送って見るものが無い）
  async function testConnection(cfg, prefix, opts) {
    cfg = cfg || {};
    opts = opts || {};
    const out = { ok: false, reached: false, authed: false, status: 0, usage: null, cache_read: null, model: cfg.model || null, error: null };
    if (cfg.kind === 'claude') {
      try {
        const m = await claudeMouth(cfg);
        out.reached = true;
        const got = await claudeAsk(m, cfg, '「了解」とだけ答えてください。', { tier: 'quick' });
        out.authed = true;
        if (got.tier) out.model = got.tier;
        out.ok = true;
      } catch (e) { out.error = (e && e.screen) || String(e && e.message || e); }
      return out;
    }
    if (cfg.kind !== 'anthropic' && cfg.kind !== 'openai') { out.error = '「接続を試す」は、「整理する AI」が API のときだけ使えます'; return out; }
    if (!cfg.key) { out.error = 'API キーがありません'; return out; }
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
    // 接続テストの結果は画面（API の設定の欄）に出すので、エラーは画面向けの文で返す
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

  // ---- API キーの置き場 ----

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
    // localStorage に保存してあるか
    remembered: function (name) {
      const ls = storage('localStorage');
      try { return !!(ls && ls.getItem(KEY_PREFIX + name)); } catch (e) { return false; }
    }
  };

  // 設定の書き出し。API キー（key）と関数（ask）とダミーの返事（script）とスキーマ（schema）とClaude を呼び出す機能のオブジェクト（claude）は含めない
  function exportSettings(cfg) {
    const out = Object.create(null); // 読み込んだ設定のキーをそのまま使うので、素の表にする
    Object.keys(cfg || {}).forEach(function (k) {
      if (k === 'key' || k === 'ask' || k === 'script' || k === 'schema' || k === 'claude') return;
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
    _internal: { anthropicBody: anthropicBody, openaiBody: openaiBody, openaiUrl: openaiUrl, anthropicHeaders: anthropicHeaders, openaiHeaders: openaiHeaders, usageAnthropic: usageAnthropic, usageOpenAI: usageOpenAI, claudeError: claudeError, claudeMouth: claudeMouth, claudeTimeoutMs: claudeTimeoutMs }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_ANALYST = api;
})();
