/*
 * record.js — 記録。判断ログ（<会議名>.jsonl）と素材ログ（<会議名>.src.jsonl）の 2 本。どちらも追記専用
 *
 *   - メモリの配列に積み、同時に IndexedDB（データベース kiku）へ 1 行ずつ追記する
 *   - 「書き出す」で jsonl ／ src.jsonl を a[download] で落とす
 *   - File System Access が使えれば、本物のファイルにも追記する（使えなければ黙って IndexedDB だけ）
 *   - 「記録を消す」で、この会議名の行を IndexedDB から消す
 *
 * 一度書いた行には手を入れない。直すときは fix イベントを足して表す（format/FORMAT.md）。
 * ここには検査が無い。追記の前に verify.js を通すのは呼ぶ側（app.js）の責任
 */
(function () {
  'use strict';

  const DB_NAME = 'kiku';
  const DB_VER = 1;

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!globalThis.indexedDB) { reject(new Error('ブラウザ内の保存が無い')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function () {
        const db = req.result;
        ['log', 'src'].forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            const os = db.createObjectStore(name, { autoIncrement: true });
            os.createIndex('name', 'name', { unique: false });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('ブラウザ内の保存を開けない')); };
    });
  }

  function makeRecord(name) {
    const rec = { name: name, log: [], src: [] };
    let dbp = null;
    let chain = Promise.resolve();     // IndexedDB への書き込みを順番どおりにする
    const handles = { log: null, src: null };
    const fsChain = { log: Promise.resolve(), src: Promise.resolve() };
    const status = { idb: '未確認', fs: { log: '無し', src: '無し' }, lastError: null };

    function db() {
      if (!dbp) dbp = openDb().then(function (d) { status.idb = '使える'; return d; }, function (e) { status.idb = '使えない（' + (e && e.message || e) + '）'; throw e; });
      return dbp;
    }

    // 既存の記録を読む（同じ会議名の行を鍵の順に）。無ければ空
    function load() {
      return db().then(function (d) {
        return Promise.all(['log', 'src'].map(function (store) {
          return new Promise(function (resolve) {
            const out = [];
            let tx;
            try { tx = d.transaction(store, 'readonly'); } catch (e) { resolve(out); return; }
            const idx = tx.objectStore(store).index('name');
            const cur = idx.openCursor(IDBKeyRange.only(name));
            cur.onsuccess = function () {
              const c = cur.result;
              if (c) { out.push(c.value.ev); c.continue(); } else resolve(out);
            };
            cur.onerror = function () { resolve(out); };
          });
        }));
      }).then(function (r) {
        rec.log = r[0]; rec.src = r[1];
        return { log: rec.log.length, src: rec.src.length };
      }, function () { return { log: 0, src: 0, idb: false }; });
    }

    function persist(store, evs) {
      chain = chain.then(function () {
        return db().then(function (d) {
          return new Promise(function (resolve) {
            let tx;
            try { tx = d.transaction(store, 'readwrite'); } catch (e) { status.lastError = e; resolve(); return; }
            const os = tx.objectStore(store);
            evs.forEach(function (ev) { os.add({ name: name, ev: ev }); });
            tx.oncomplete = function () { resolve(); };
            tx.onerror = function () { status.lastError = tx.error; resolve(); };
            tx.onabort = function () { status.lastError = tx.error; resolve(); };
          });
        }, function () { /* IndexedDB が無いときはメモリだけ */ });
      });
      return chain;
    }

    // File System Access への追記（使えるときだけ。失敗しても記録そのものは止めない）
    function fsAppend(kind, text) {
      const h = handles[kind];
      if (!h) return Promise.resolve();
      fsChain[kind] = fsChain[kind].then(function () {
        return h.getFile().then(function (f) {
          return h.createWritable({ keepExistingData: true }).then(function (w) {
            return w.seek(f.size).then(function () { return w.write(text); }).then(function () { return w.close(); });
          });
        });
      }).catch(function (e) { status.fs[kind] = '書けなかった（' + (e && e.message || e) + '）'; });
      return fsChain[kind];
    }

    function lines(evs) { return evs.map(function (e) { return JSON.stringify(e); }).join('\n') + '\n'; }

    function appendLog(batch) {
      const evs = batch.map(function (e) { return JSON.parse(JSON.stringify(e)); });
      evs.forEach(function (e) { rec.log.push(e); });
      persist('log', evs);
      fsAppend('log', lines(evs));
      return evs;
    }
    function appendSrc(line) {
      const ev = JSON.parse(JSON.stringify(line));
      rec.src.push(ev);
      persist('src', [ev]);
      fsAppend('src', lines([ev]));
      return ev;
    }

    function download(fname, text) {
      const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    }
    // 書き出す。保存の画面（showSaveFilePicker）が使えればそれで名前を付けて保存し、無ければ a[download] で落とす
    // （file:// から a[download] で落とすと、名前が「download」になる環境がある。Chromium の headless で観測。実機は未確認）。
    // 返す値: 'picker'（選んだ保存先に保存した）／'cancelled'（保存先を選ばなかった）／'download'（保存の画面が無いので
    // a[download] で落とした）／'fallback'（保存の画面を開けなかった・保存できなかったので a[download] で落とした。
    // Chromium は押してから約 5 秒を過ぎると 2 つ目の保存の画面を開かせない（SecurityError）。1 つ目の画面で迷うと 2 つ目がこれになる）
    function exportVia(fname, text) {
      if (typeof globalThis.showSaveFilePicker === 'function') {
        return globalThis.showSaveFilePicker({ suggestedName: fname }).then(function (h) {
          return h.createWritable().then(function (w) { return w.write(text).then(function () { return w.close(); }); }).then(function () { return 'picker'; });
        }).catch(function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          download(fname, text); return 'fallback';
        });
      }
      download(fname, text);
      return Promise.resolve('download');
    }
    function exportLog() { return exportVia(name + '.jsonl', lines(rec.log)); }
    function exportSrc() { return exportVia(name + '.src.jsonl', lines(rec.src)); }

    // 本物のファイルに追記する（File System Access）。いまある分を先に書き、以後は追記
    function bindFile(kind) {
      if (typeof globalThis.showSaveFilePicker !== 'function') { status.fs[kind] = 'この環境では使えない'; return Promise.resolve(false); }
      const suggested = kind === 'log' ? name + '.jsonl' : name + '.src.jsonl';
      return globalThis.showSaveFilePicker({ suggestedName: suggested }).then(function (h) {
        handles[kind] = h;
        return h.createWritable().then(function (w) {
          return w.write(lines(kind === 'log' ? rec.log : rec.src)).then(function () { return w.close(); });
        }).then(function () { status.fs[kind] = '書いている（' + (h.name || suggested) + '）'; return true; });
      }).catch(function (e) { status.fs[kind] = '結び付けなかった（' + (e && e.message || e) + '）'; return false; });
    }

    // この会議名の行を IndexedDB から消し、メモリも空にする
    function clear() {
      rec.log = []; rec.src = [];
      chain = chain.then(function () {
        return db().then(function (d) {
          return Promise.all(['log', 'src'].map(function (store) {
            return new Promise(function (resolve) {
              let tx;
              try { tx = d.transaction(store, 'readwrite'); } catch (e) { resolve(); return; }
              const idx = tx.objectStore(store).index('name');
              const cur = idx.openCursor(IDBKeyRange.only(name));
              cur.onsuccess = function () { const c = cur.result; if (c) { c.delete(); c.continue(); } };
              tx.oncomplete = function () { resolve(); };
              tx.onerror = function () { resolve(); };
            });
          }));
        }, function () {});
      });
      return chain;
    }

    return {
      name: name,
      get log() { return rec.log; },
      get src() { return rec.src; },
      load: load,
      appendLog: appendLog,
      appendSrc: appendSrc,
      exportLog: exportLog,
      exportSrc: exportSrc,
      bindFile: bindFile,
      clear: clear,
      flush: function () { return chain; },
      status: status
    };
  }

  // 保存されている会議名の一覧（画面で選ぶため）
  function listNames() {
    return openDb().then(function (d) {
      return new Promise(function (resolve) {
        const names = Object.create(null); // 鍵は会議の名前（人が打つ）。素の表にする
        let tx;
        try { tx = d.transaction('log', 'readonly'); } catch (e) { resolve([]); return; }
        const cur = tx.objectStore('log').openCursor();
        cur.onsuccess = function () { const c = cur.result; if (c) { names[c.value.name] = true; c.continue(); } else resolve(Object.keys(names).sort()); };
        cur.onerror = function () { resolve([]); };
      });
    }, function () { return []; });
  }

  const api = { makeRecord: makeRecord, listNames: listNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.TSV_RECORD = api;
})();
