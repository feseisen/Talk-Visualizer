/*
 * background.js — 拡張「橋」の裏方（service worker）。入れた・新しい版に置き換えたその時に、すでに開いている claude.ai のタブへ
 * 送り手（intake.js と bridge.js）を差し込む。
 *
 * なぜ要るか: Chrome は、入れる前から開いていたタブには manifest の content script を入れない。これが無いと、拡張を入れた後に
 *   kiku のタブを読み込み直すまで、枠は拡張を見つけられない（利用者の手が 1 つ増える）。
 * どうなるか: 開いている https://claude.ai/* のタブの最上位の枠（frameId 0）にだけ差し込む。枠（アーティファクトの iframe）には
 *   入れない（manifest の all_frames: false と同じ）。新しい版を差し込むと、古い版の送り手はタブに残ったまま動き続けるので、
 *   bridge.js の頭で古い送り手を退かせる（kiku-bridge-retire の知らせ）。
 * 要る権限: scripting と host_permissions の https://claude.ai/*（tabs.query の url の絞り込みは、host の権限が無いと 0 件になる）。
 *   Chrome の断り書きは、content script だけの 0.1.0 と同じ 1 つ（英語の Chromium 141 の management.getPermissionWarningsByManifest で
 *   "Read and change your data on claude.ai"。日本語の文言は確かめていない）。tabs の権限は要らない（足すと "Read your browsing history"
 *   が増える。同じ道具で実測）。ZIP を落として入れる道では確かめの画面が出ないので、断り書きは入れるときには見えない。
 * 確かめたこと: Chromium 141 で、入れたときと置き換えたときに、開いていたタブへ差し込まれ、読み込み直さずに枠が拡張を見つけた
 *   （tests/e2e/e2e_bridge_install.js）。本物の Chrome（Windows）では、まだ動かしていない。
 * この拡張は通信しない。ここも、タブに差し込むだけ。
 */
'use strict';

const FILES = ['intake.js', 'bridge.js'];
const MATCH = 'https://claude.ai/*';

function injectAll() {
  chrome.tabs.query({ url: MATCH }, function (tabs) {
    if (chrome.runtime.lastError || !Array.isArray(tabs)) return;
    tabs.forEach(function (tab) {
      // 捨てられたタブ（discarded）や読み込み中のタブには入らないことがある。入らなかったタブは、次に読み込んだときに manifest で入る
      if (tab.discarded) return;
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: FILES }).catch(function () { /* 入れられないタブは飛ばす */ });
    });
  });
}

// reason: install（入れた）・update（新しい版に置き換えた・読み込み直した）・chrome_update（Chrome が更新された）。
// chrome_update のときは、タブの送り手は動いたままなので差し込まない（差し込んでも、新しい送り手が古いものを退かせて置き換わるだけ）
chrome.runtime.onInstalled.addListener(function (details) {
  if (details && (details.reason === 'install' || details.reason === 'update')) injectAll();
});
