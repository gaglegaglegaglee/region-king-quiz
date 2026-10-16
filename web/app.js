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
    btn.addEventListener("click", function () {
      if (t.serverTopic) startGame(t.serverTopic);
      else showToast(cfg.notReadyText || "준비 중이에요.");
    });

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
  // 서버에서 자료 기준월을 받아 출처 줄 아래에 보여 준다. 실패하면 조용히 숨긴 채로 둔다.
  function showDataDate() {
    if (!cfg.apiBase || typeof fetch !== "function") return;
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : null;
    fetch(cfg.apiBase.replace(/\/+$/, "") + "/api/health", ctl ? { signal: ctl.signal } : {})
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var stats = j && j.ok && j.data && j.data.stats ? j.data.stats : [];
        var pop = null;
        stats.forEach(function (s) { if (s.key === "population") pop = s; });
        var m = pop && /^(\d{4})-(\d{2})/.exec(pop.latest_ref_date || "");
        if (!m) return;
        var label = m[1] + "년 " + Number(m[2]) + "월";
        var el = document.getElementById("data-date");
        el.textContent = (cfg.dataDateText || "자료 기준: {date}").replace("{date}", label);
        el.hidden = false;
      })
      .catch(function () { /* 서버에 연결하지 못해도 화면은 그대로 쓸 수 있다 */ })
      .then(function () { if (timer) clearTimeout(timer); });
  }

  /* ---------- 게임 화면 ---------- */
  var G = cfg.game || {};
  var T = cfg.texts || {};
  var $ = function (id) { return document.getElementById(id); };
  var st = null; // 지금 판의 상태 (화면은 이것만 읽어서 그린다)
  var timers = { limit: null, low: null, next: null };

  function clearTimers() {
    clearTimeout(timers.limit); clearTimeout(timers.low); clearTimeout(timers.next);
    timers.limit = timers.low = timers.next = null;
  }
  function apiUrl(path) { return String(cfg.apiBase || "").replace(/\/+$/, "") + path; }

  // 서버에 보내고 {ok, ...} 를 돌려준다. 실패하면 {ok:false, message}(한국어)
  function post(path, body) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var to = ctl ? setTimeout(function () { ctl.abort(); }, G.requestTimeoutMs || 10000) : null;
    return fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().then(function (j) { return j; }, function () { return { ok: false, message: T.serverError }; });
    }).catch(function () {
      return { ok: false, message: T.offline };
    }).then(function (j) {
      if (to) clearTimeout(to);
      if (!j || j.ok !== true) return { ok: false, message: (j && typeof j.message === "string" && j.message) || T.serverError };
      return j;
    });
  }

  function show(which) {
    $("home").hidden = which !== "home";
    $("game").hidden = which !== "game";
    window.scrollTo(0, 0);
  }

  function goHome() {
    clearTimers();
    st = null; // 늦게 도착한 응답은 버려진다
    show("home");
  }

  function setEnd(text, retryFn) {
    $("g-end-text").textContent = text;
    var rb = $("g-retry");
    rb.hidden = !retryFn;
    rb.onclick = retryFn || null;
    $("g-end").hidden = false;
  }

  function resetFill() {
    var f = $("g-fill");
    f.className = "timer-fill";
    f.style.transition = "none";
    f.style.width = "100%";
    void f.offsetWidth; // 위 값을 먼저 적용
  }

  function startGame(topic) {
    clearTimers();
    st = { topic: topic, gameId: null, q: null, streak: 0, locked: true, token: {} };
    $("g-streak-n").textContent = "0";
    $("g-num").textContent = "";
    $("g-question").textContent = T.loading;
    $("g-choices").textContent = "";
    $("g-verdict").textContent = "";
    $("g-verdict").className = "verdict";
    $("g-ref").textContent = "";
    $("g-end").hidden = true;
    resetFill();
    show("game");
    var me = st;
    post("/api/game/start", { topic: topic }).then(function (j) {
      if (st !== me) return;
      if (!j.ok) { $("g-question").textContent = ""; setEnd(j.message, function () { startGame(topic); }); return; }
      me.gameId = j.game_id;
      renderQuestion(j.question);
    });
  }

  function renderQuestion(q) {
    st.q = q;
    st.locked = false;
    st.picked = null;
    $("g-num").textContent = q.number + "번 문제";
    $("g-question").textContent = q.text;
    $("g-verdict").textContent = "";
    $("g-verdict").className = "verdict";
    $("g-ref").textContent = "";
    $("g-end").hidden = true;
    var box = $("g-choices");
    box.textContent = "";
    q.choices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn choice";
      b.setAttribute("data-code", c.code);
      var n = document.createElement("span"); n.className = "c-name"; n.textContent = c.name;
      var v = document.createElement("span"); v.className = "c-val";
      b.appendChild(n); b.appendChild(v);
      b.addEventListener("click", function () { pick(c.code); });
      box.appendChild(b);
    });
    // 15초 막대: 화면 시계로 줄어든다(판정은 서버)
    var sec = q.time_limit_sec || G.defaultTimeLimitSec || 15;
    resetFill();
    var f = $("g-fill");
    f.style.transition = "width " + sec + "s linear";
    f.style.width = "0%";
    var me = st, qid = q.question_id;
    timers.low = setTimeout(function () { f.classList.add("low"); }, Math.max(0, sec - 5) * 1000);
    timers.limit = setTimeout(function () {
      if (st !== me || me.locked || !me.q || me.q.question_id !== qid) return;
      timeUp();
    }, sec * 1000);
  }

  function freezeBar() {
    var f = $("g-fill");
    var w = f.getBoundingClientRect().width;
    var tw = $("g-timer").getBoundingClientRect().width;
    f.style.transition = "none";
    f.style.width = (tw ? Math.round(w / tw * 100) : 0) + "%";
  }

  function lockButtons() {
    var bs = $("g-choices").querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) bs[i].disabled = true;
  }

  function timeUp() {
    st.locked = true;
    clearTimers();
    lockButtons();
    $("g-fill").style.transition = "none";
    $("g-fill").style.width = "0%";
    $("g-verdict").textContent = T.timeout;
    $("g-verdict").className = "verdict bad";
    setEnd((T.endTitle || "{n}연승으로 끝났어요").replace("{n}", st.streak));
  }

  function pick(code) {
    if (!st || st.locked) return;
    st.locked = true;
    st.picked = code;
    clearTimers();
    freezeBar();
    lockButtons();
    var bs = $("g-choices").querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) if (bs[i].getAttribute("data-code") === code) bs[i].classList.add("pressed");
    sendAnswer();
  }

  function sendAnswer() {
    var me = st, qid = me.q.question_id, code = me.picked;
    post("/api/game/answer", { game_id: me.gameId, question_id: qid, choice_code: code }).then(function (j) {
      if (st !== me) return;
      if (!j.ok) { setEnd(j.message, function () { $("g-end").hidden = true; sendAnswer(); }); return; }
      showResult(j, code);
    });
  }

  function showResult(j, code) {
    var byCode = {};
    (j.values || []).forEach(function (v) { byCode[v.code] = v; });
    var bs = $("g-choices").querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], c = b.getAttribute("data-code");
      b.classList.remove("pressed");
      if (c === j.answer_code) b.classList.add("right");
      else if (c === code) b.classList.add("wrong");
      else b.classList.add("dim");
      if (byCode[c]) b.querySelector(".c-val").textContent = byCode[c].display;
    }
    var date = refLabel(j.ref_date);
    $("g-ref").textContent = (T.refLine || "").replace("{date}", date).replace("{source}", j.source || "");
    st.streak = typeof j.streak === "number" ? j.streak : st.streak;
    $("g-streak-n").textContent = String(st.streak);
    if (j.correct) {
      $("g-verdict").textContent = T.correct;
      $("g-verdict").className = "verdict good";
    } else {
      $("g-verdict").textContent = T.wrong;
      $("g-verdict").className = "verdict bad";
    }
    var me = st;
    if (j.correct && j.next_question) {
      timers.next = setTimeout(function () { if (st === me) renderQuestion(j.next_question); }, G.nextDelayMs || 1200);
    } else {
      setEnd((T.endTitle || "{n}연승으로 끝났어요").replace("{n}", st.streak));
    }
  }

  function refLabel(d) {
    var m = /^(\d{4})-(\d{2})/.exec(d || "");
    return m ? m[1] + "년 " + Number(m[2]) + "월" : String(d || "");
  }

  $("g-home").addEventListener("click", goHome);
  init();
  showDataDate();
})();
