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
    var image=document.createElement("img");
    image.src="assets/emoji/"+({mix:"dice",population:"people",age:"cake",map:"map",cars:"car"}[t.serverTopic]||"dice")+".svg";
    image.alt="";image.className="emoji-image";icon.appendChild(image);
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
    rec.textContent = window.RegionFeatures.bestLabel(t.serverTopic);

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
      window.RegionFeatures.openRanking("mix");
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
  var st = null;        // 지금 판의 상태 (화면은 이것만 읽어서 그린다)
  var lastTopic = null; // "다시 하기"용
  var timers = { limit: null, low: null, next: null };

  function fill(s, vars) {
    return String(s || "").replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }
  function clearTimers() {
    clearTimeout(timers.limit); clearTimeout(timers.low); clearTimeout(timers.next);
    timers.limit = timers.low = timers.next = null;
  }
  function apiUrl(path) { return String(cfg.apiBase || "").replace(/\/+$/, "") + path; }

  // 서버에 보낸다. 성공이면 {ok:true,...}, 실패면 {ok:false, message(한국어), status, kind}
  // kind: "net"(연결 안 됨) | "slow"(응답이 너무 늦음) | "server"(서버가 보낸 오류)
  function post(path, body) {
    var ctl = typeof AbortController === "function" ? new AbortController() : null;
    var slow = false;
    var to = ctl ? setTimeout(function () { slow = true; ctl.abort(); }, G.requestTimeoutMs || 10000) : null;
    return fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      return r.json().then(
        function (j) { return { j: j, status: r.status }; },
        function () { return { j: null, status: r.status }; });
    }, function () {
      return { fail: slow ? "slow" : "net" };
    }).then(function (x) {
      if (to) clearTimeout(to);
      if (x.fail === "slow") return { ok: false, kind: "slow", status: 0, message: T.slow };
      if (x.fail === "net") return { ok: false, kind: "net", status: 0, message: T.offline };
      var j = x.j;
      if (!j || j.ok !== true) {
        return { ok: false, kind: "server", status: x.status, message: (j && typeof j.message === "string" && j.message) || T.serverError };
      }
      return j;
    });
  }

  function show(which) {
    document.querySelectorAll(".screen").forEach(function(screen){screen.hidden=screen.id!==which;});
    window.scrollTo(0, 0);
  }

  function goHome() {
    clearTimers();
    st = null; // 늦게 도착한 응답은 버려진다
    show("home");
    window.RegionFeatures.refreshBests();
  }

  // 게임 화면 아래 안내 박스(오류용). retryFn 이 없으면 "다시 시도" 버튼이 숨는다.
  function setError(text, retryFn) {
    $("g-err-text").textContent = text;
    var rb = $("g-retry");
    rb.hidden = !retryFn;
    rb.onclick = retryFn || null;
    $("g-err").hidden = false;
    $("g-quit").hidden = true;
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
    lastTopic = topic;
    st = { topic: topic, gameId: null, q: null, streak: 0, locked: true };
    $("g-streak-n").textContent = "0";
    $("g-num").textContent = "";
    $("g-question").textContent = T.loading;
    $("g-choices").textContent = "";
    $("g-verdict").textContent = "";
    $("g-verdict").className = "verdict";
    $("g-ref").textContent = "";
    $("g-explanation").textContent = "";
    $("g-err").hidden = true;
    $("g-quit").hidden = false;
    resetFill();
    show("game");
    var me = st;
    post("/api/game/start", { topic: topic }).then(function (j) {
      if (st !== me) return;
      if (!j.ok) {
        $("g-question").textContent = "";
        // 하루 상한(503)은 다시 눌러도 소용없으니 다시 시도를 주지 않는다
        setError(j.message, j.status === 503 ? null : function () { startGame(topic); });
        return;
      }
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
    $("g-explanation").textContent = "";
    $("g-err").hidden = true;
    $("g-quit").hidden = false;
    var box = $("g-choices");
    box.textContent = "";
    window.RegionFeatures.renderGeo(q);
    box.classList.toggle("grid-choices",q.choices.length===4);
    q.choices.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn choice";
      b.setAttribute("data-code", c.code);
      var n = document.createElement("span"); n.className = "c-name"; n.textContent = c.name;
      var m = document.createElement("span"); m.className = "c-mark";
      var v = document.createElement("span"); v.className = "c-val";
      if(c.shape) b.appendChild(window.RegionFeatures.shape(c.shape));
      b.appendChild(n); b.appendChild(m); b.appendChild(v);
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
      finishEarly("timeout");
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

  // 시간 초과 또는 "그만하기": 서버에 끝내 달라고 알리고 해설을 받아 결과 화면으로
  function finishEarly(reason) {
    if (!st) return;
    if (!st.q || !st.gameId) { goHome(); return; } // 문제가 오기 전이면 그냥 홈으로
    st.locked = true;
    clearTimers();
    lockButtons();
    $("g-quit").hidden = true;
    $("g-fill").style.transition = "none";
    if (reason === "timeout") $("g-fill").style.width = "0%"; else freezeBar();
    var me = st;
    post("/api/game/answer", { game_id: me.gameId, question_id: me.q.question_id, timeout: true }).then(function (j) {
      if (st !== me) return;
      if (j.ok) {
        me.streak = typeof j.streak === "number" ? j.streak : me.streak;
        showResultScreen(reason, j);
      } else {
        // 해설을 받지 못해도 판은 끝난 것으로 본다
        showResultScreen(reason, null, j.status === 409 ? "lost" : "noexplain");
      }
    });
  }

  function pick(code) {
    if (!st || st.locked) return;
    st.locked = true;
    st.picked = code;
    clearTimers();
    freezeBar();
    lockButtons();
    $("g-quit").hidden = true;
    var bs = $("g-choices").querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) if (bs[i].getAttribute("data-code") === code) bs[i].classList.add("pressed");
    sendAnswer();
  }

  function sendAnswer() {
    var me = st, qid = me.q.question_id, code = me.picked;
    $("g-err").hidden = true;
    post("/api/game/answer", { game_id: me.gameId, question_id: qid, choice_code: code }).then(function (j) {
      if (st !== me) return;
      if (j.ok) { showAnswer(j, code); return; }
      if (j.status === 409) {
        // 이미 답한 문제: 서버는 답을 받았지만 응답이 오지 않았던 것. 판은 끝난 것으로 본다.
        showResultScreen("error", null, "lost");
        return;
      }
      // 연결 끊김·느린 응답·분당 상한(429)은 같은 답을 다시 보낼 수 있다. 하루 상한(503)은 불가.
      setError(j.message, j.status === 503 ? null : sendAnswer);
      if (j.status === 503) {
        // 홈으로 갈 길은 아래 박스의 홈 버튼이 맡는다
      }
    });
  }

  // 받침이 있으면 "이에요", 없으면 "예요"
  function josa(name) {
    var ch = String(name || "").slice(-1).charCodeAt(0);
    if (ch >= 0xAC00 && ch <= 0xD7A3) return (ch - 0xAC00) % 28 === 0 ? "예요" : "이에요";
    return "이에요";
  }
  function nameOf(values, code) {
    var n = "";
    (values || []).forEach(function (v) { if (v.code === code) n = v.name_full || v.name || ""; });
    return n;
  }

  function showAnswer(j, code) {
    var byCode = {};
    (j.values || []).forEach(function (v) { byCode[v.code] = v; });
    var bs = $("g-choices").querySelectorAll("button");
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i], c = b.getAttribute("data-code");
      b.classList.remove("pressed");
      var mark = b.querySelector(".c-mark");
      if (c === j.answer_code) { b.classList.add("right"); mark.textContent = T.markRight; }
      else if (c === code) { b.classList.add("wrong"); mark.textContent = T.markWrong; }
      else b.classList.add("dim");
      if (byCode[c]) b.querySelector(".c-val").textContent = byCode[c].display;
    }
    $("g-ref").textContent = fill(T.refLine, { date: refLabel(j.ref_date), source: j.source || "" });
    st.streak = typeof j.streak === "number" ? j.streak : st.streak;
    $("g-streak-n").textContent = String(st.streak);
    window.RegionFeatures.remember(st.topic,st.streak);
    $("g-explanation").textContent = j.explanation || "";
    var ans = nameOf(j.values, j.answer_code);
    var v = $("g-verdict");
    if (j.correct) {
      v.textContent = T.correct + (ans ? " " + fill(T.answerIs, { name: ans, josa: josa(ans) }) : "");
      v.className = "verdict good";
    } else {
      v.textContent = T.wrong + (ans ? " " + fill(T.answerIs, { name: ans, josa: josa(ans) }) : "");
      v.className = "verdict bad";
    }
    v.focus(); // 화면 읽기 프로그램이 결과를 읽도록
    var me = st;
    if (j.correct && j.next_question) {
      timers.next = setTimeout(function () { if (st === me) renderQuestion(j.next_question); }, G.nextDelayMs || 1200);
    } else {
      timers.next = setTimeout(function () {
        if (st === me) showResultScreen(j.correct ? "nomore" : "wrong", j);
      }, G.resultDelayMs || 1800);
    }
  }

  /* ---------- 결과 화면 ---------- */
  // reason: wrong | timeout | quit | nomore | error,  data: 서버 응답(없으면 null),  missing: "lost" | "noexplain" | undefined
  function showResultScreen(reason, data, missing) {
    clearTimers();
    var n = st ? st.streak : 0;
    var q = st && st.q ? st.q : null;
    var topic = st ? st.topic : lastTopic;
    lastTopic = topic;
    $("r-title").textContent = n > 0 ? fill(T.resultTitle, { n: n }) : T.resultZero;
    var why = T.reasons[reason] || "";
    if (missing === "lost") why = T.lostResult;
    $("r-reason").textContent = why;
    var ex = $("r-explain");
    ex.hidden = !data;
    $("r-noexplain").hidden = !!data;
    $("r-noexplain").textContent = missing === "lost" ? "" : T.noExplain;
    if (data) {
      $("r-q").textContent = q ? q.text : "";
      $("r-detail").textContent = data.explanation || "";
      var list = $("r-rows");
      list.textContent = "";
      (data.values || []).forEach(function (v) {
        var li = document.createElement("li");
        var right = v.code === data.answer_code;
        li.className = "r-row" + (right ? " right" : "");
        var nm = document.createElement("span"); nm.className = "r-name"; nm.textContent = v.name_full || v.name;
        var vl = document.createElement("span"); vl.className = "r-val"; vl.textContent = v.display;
        li.appendChild(nm);
        if (right) { var mk = document.createElement("span"); mk.className = "r-mark"; mk.textContent = T.markRight; li.appendChild(mk); }
        li.appendChild(vl);
        list.appendChild(li);
      });
      var ans = nameOf(data.values, data.answer_code);
      var fullAns = "";
      (data.values || []).forEach(function (v) { if (v.code === data.answer_code) fullAns = v.name_full || v.name; });
      $("r-answer").textContent = fullAns ? fill(T.answerLine, { name: fullAns }) : "";
      $("r-ref").textContent = fill(T.refLine, { date: refLabel(data.ref_date), source: data.source || "" });
    }
    window.RegionFeatures.onResult({topic:topic,streak:n,game_id:st&&st.gameId,confirmed:!!data});
    show("result");
    $("r-title").focus();
    st = null; // 판은 끝났다
  }

  function refLabel(d) {
    var m = /^(\d{4})-(\d{2})/.exec(d || "");
    return m ? m[1] + "년 " + Number(m[2]) + "월" : String(d || "");
  }

  $("g-home").addEventListener("click", goHome);
  $("g-quit").addEventListener("click", function () { finishEarly("quit"); });
  $("r-home").addEventListener("click", goHome);
  $("r-again").addEventListener("click", function () { if (lastTopic) startGame(lastTopic); else goHome(); });
  window.RegionFeatures.setup({show:show,home:goHome,post:post,apiUrl:apiUrl,cfg:cfg});
  init();
  showDataDate();
  if(location.hash==="#admin") window.RegionFeatures.openAdmin();
  window.addEventListener("hashchange",function(){if(location.hash==="#admin")window.RegionFeatures.openAdmin();else goHome();});
})();
