/* 지역왕 화면 동작 — 설정은 config.js(window.JIYEOK_CONFIG)에서 읽습니다. */
(function () {
  "use strict";
  var cfg = window.JIYEOK_CONFIG || {};
  var topics = cfg.topics || [];
  var toastTimer = null;

  function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.textContent = ""; }, 2500);
  }

  function makeTopic(t) {
    var box = document.createElement("div");
    box.className = "topic" + (t.main ? " main" : "");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn topic-btn";
    btn.setAttribute("data-topic", t.id);
    btn.setAttribute("aria-label", t.name + " 주제로 시작하기");
    var icon = document.createElement("span");
    icon.className = "icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = t.icon;
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = t.name;
    btn.appendChild(icon);
    btn.appendChild(name);
    btn.addEventListener("click", function () { showToast(cfg.notReadyText || "준비 중이에요."); });

    var rec = document.createElement("p");
    rec.className = "record";
    rec.setAttribute("data-record", t.id);
    rec.textContent = cfg.noRecordText || "기록 없음";

    box.appendChild(btn);
    box.appendChild(rec);
    return box;
  }

  function init() {
    if (cfg.tagline) document.getElementById("tagline").textContent = cfg.tagline;
    if (cfg.sourceText) document.getElementById("source").textContent = cfg.sourceText;
    var wrap = document.getElementById("topics");
    topics.forEach(function (t) { wrap.appendChild(makeTopic(t)); });
    document.getElementById("rank-btn").addEventListener("click", function () {
      showToast(cfg.notReadyText || "준비 중이에요.");
    });
  }
  init();
})();
