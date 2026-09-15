/* Sala de examen — motor de práctica para certificaciones.
   Estático: no necesita servidor de aplicación, solo servir los archivos por HTTP. */
(function () {
  "use strict";

  var LETTERS = ["A", "B", "C", "D", "E"];
  var KEY = "examtrainer.v2";
  var app = document.getElementById("app");

  /* ---------------- almacenamiento ---------------- */
  var DB = { exams: {} };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) DB = JSON.parse(raw) || DB;
    if (!DB.exams) DB.exams = {};
  } catch (e) {}

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) {}
  }
  function prog(id) {
    if (!DB.exams[id]) DB.exams[id] = { stats: {}, wrong: {}, flags: {}, history: [] };
    var p = DB.exams[id];
    p.stats = p.stats || {}; p.wrong = p.wrong || {}; p.flags = p.flags || {}; p.history = p.history || [];
    return p;
  }
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then(function (ok) { if (!ok) navigator.storage.persist(); }).catch(function () {});
  }

  /* ---------------- utilidades ---------------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function pct(ok, n) { return n ? Math.round((ok / n) * 100) : null; }
  var NB = "\u00A0";  // espacio duro antes del signo %
  function pc(n) { return n + NB + "%"; }
  function barClass(p, pass) { return p === null ? "" : p >= pass ? "" : p >= pass - 15 ? "mid" : "low"; }
  function fmtTime(s) {
    var m = Math.floor(s / 60), r = s % 60;
    return m + " min " + (r < 10 ? "0" : "") + r + " s";
  }
  function fetchJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.json();
    });
  }
  function largestRemainder(weights, total) {
    var raw = weights.map(function (w) { return (w / 100) * total; });
    var out = raw.map(Math.floor);
    var used = out.reduce(function (a, b) { return a + b; }, 0);
    var rest = raw.map(function (v, i) { return { i: i, r: v - out[i] }; }).sort(function (a, b) { return b.r - a.r; });
    for (var k = 0; used < total; k++, used++) out[rest[k % rest.length].i]++;
    return out;
  }

  /* ---------------- estado de sesión ---------------- */
  var manifest = null, cache = {}, S = null, LAST = null, tick = null;

  function loadExam(id) {
    if (cache[id]) return Promise.resolve(cache[id]);
    var row = (manifest.exams || []).filter(function (e) { return e.id === id; })[0];
    if (!row) return Promise.reject(new Error("Examen desconocido: " + id));
    return fetchJSON(row.file).then(function (data) {
      data.meta = row;
      data.secMap = {};
      (data.sections || []).forEach(function (s) { data.secMap[s.id] = s; });
      cache[id] = data;
      return data;
    });
  }

  /* ---------------- router ---------------- */
  function route() {
    var h = location.hash.replace(/^#\/?/, "");
    var parts = h.split("/").filter(Boolean);
    if (!parts.length) return viewHome();
    if (parts[0] === "e" && parts[1]) {
      var id = decodeURIComponent(parts[1]);
      var sub = parts[2] || "";
      return loadExam(id).then(function (ex) {
        if (sub === "run") return S && S.examId === id ? viewRun() : (location.hash = "#/e/" + id);
        if (sub === "result") return LAST && LAST.examId === id ? viewResult() : (location.hash = "#/e/" + id);
        if (sub === "list") return viewBrowse(ex);
        return viewExam(ex);
      }).catch(fail);
    }
    viewHome();
  }
  function fail(err) {
    app.innerHTML = '<div class="wrap"><h1>No se ha podido cargar</h1><p class="muted" style="margin-top:10px">' +
      esc(err.message) + '</p><p class="small muted" style="margin-top:14px">Si has abierto el archivo con doble clic, ábrelo a través de un servidor web (GitHub Pages, tu dominio o <span class="mono">python3 -m http.server</span>): el navegador bloquea la lectura de los archivos de datos en <span class="mono">file://</span>.</p><p style="margin-top:18px"><a class="btn" href="#/">Volver al inicio</a></p></div>';
  }
  function go(hash) { location.hash = hash; }
  function scrollTop() { window.scrollTo(0, 0); }

  /* ---------------- vista: portada ---------------- */
  function viewHome() {
    stopTimer();
    var list = manifest.exams || [];

    var rows = list.map(function (e) {
      var p = prog(e.id);
      var seen = Object.keys(p.stats).length;
      var acc = accuracy(p, null);
      var best = p.history.length ? Math.max.apply(null, p.history.map(function (h) { return h.pct; })) : null;
      return '<a class="exam-row" href="#/e/' + esc(e.id) + '">' +
        '<div class="er-main">' +
          '<span class="eyebrow">' + esc(e.vendor) + ' · ' + esc(e.code) + '</span>' +
          '<div class="name">' + esc(e.name) + '</div>' +
          '<p class="blurb">' + esc(e.blurb) + '</p>' +
        '</div>' +
        '<div class="er-facts">' +
          fact(e.questions, "preguntas") +
          fact(pc(e.pass), "para aprobar") +
          fact(e.minutes + " min", e.scored + " preguntas") +
          fact(acc.pct === null ? "—" : pc(acc.pct), best !== null ? "acierto · mejor " + pc(best) : "tu acierto") +
        '</div>' +
        '<span class="er-go">Abrir →</span>' +
        (seen ? '<div class="er-bar"><div class="mini"><i class="' + barClass(acc.pct, e.pass) +
          '" style="width:' + (acc.pct || 0) + '%"></i></div>' +
          '<span class="small muted">' + seen + ' de ' + e.questions + ' preguntas trabajadas' +
          (p.history.length ? ' · ' + p.history.length + (p.history.length === 1 ? ' sesión' : ' sesiones') : '') + '</span></div>' : '') +
        '</a>';
    }).join("");

    var totalQ = list.reduce(function (a, e) { return a + e.questions; }, 0);

    app.innerHTML = '<div class="wrap">' +
      '<header class="hero">' +
        '<div>' +
          '<p class="eyebrow">Práctica de certificaciones</p>' +
          '<h1 style="margin-top:6px">Sala de examen</h1>' +
        '</div>' +
        '<p class="hero-lede">Bancos de preguntas reales con explicación en cada respuesta, simulacros cronometrados con el formato oficial de cada certificación y un diagnóstico de puntos flacos al terminar.</p>' +
      '</header>' +
      '<div class="section">' +
        '<div class="section-head"><h2>Exámenes</h2>' +
        '<span class="eyebrow">' + list.length + (list.length === 1 ? ' disponible' : ' disponibles') + ' · ' + totalQ + ' preguntas</span></div>' +
        '<div class="exam-list">' + rows + '</div>' +
      '</div>' +
      footerHtml() +
    '</div>';

    bindFooter();
    scrollTop();
  }

  function fact(value, label) {
    return '<div><b>' + value + '</b><span>' + label + '</span></div>';
  }

  function footerHtml(about) {
    return '<footer class="foot">' +
      '<div class="foot-grid">' +
        '<div class="foot-col">' +
          '<p class="eyebrow">Sobre esta web</p>' +
          '<p>' + (about || "Cada pregunta trae su respuesta correcta y una explicación breve. Los simulacros copian el formato oficial de cada certificación.") + '</p>' +
        '</div>' +
        '<div class="foot-col">' +
          '<p class="eyebrow">Tu progreso</p>' +
          '<p>Se guarda en este navegador y no sale de tu dispositivo. Para seguir en otro, expórtalo y pégalo allí.</p>' +
          '<p><button class="linkbtn" id="expBtn">Exportar</button> · <button class="linkbtn" id="impBtn">Importar</button></p>' +
        '</div>' +
        '<div class="foot-col">' +
          '<p class="eyebrow">Atajos</p>' +
          '<p><b>1</b> <b>2</b> <b>3</b> responden, <b>←</b> <b>→</b> mueven, <b>Enter</b> avanza.</p>' +
          '<p>En el móvil, añádela a la pantalla de inicio: funciona sin conexión.</p>' +
        '</div>' +
      '</div>' +
      '<div id="ioPanel" hidden></div>' +
      '<div class="foot-base"><span>Sala de examen</span><span>Material de estudio, sin relación con los fabricantes de las certificaciones.</span></div>' +
    '</footer>';
  }

  function bindFooter() {
    var e = document.getElementById("expBtn"), i = document.getElementById("impBtn");
    if (e) e.onclick = function () { togglePanel("exp"); };
    if (i) i.onclick = function () { togglePanel("imp"); };
  }

  var openPanel = null;
  function togglePanel(which) {
    var panel = document.getElementById("ioPanel");
    if (openPanel === which) { panel.hidden = true; panel.innerHTML = ""; openPanel = null; return; }
    openPanel = which;
    panel.hidden = false;
    if (which === "exp") exportPanel(panel); else importPanel(panel);
  }

  function exportPanel(panel) {
    var json = JSON.stringify(DB);
    panel.innerHTML = '<div class="io"><p>Copia este texto (o descarga el archivo) y guárdalo. Para restaurarlo, pulsa Importar en el otro dispositivo y pégalo.</p>' +
      '<textarea class="search io-text" id="expText" rows="3" readonly></textarea>' +
      '<div class="row"><button class="btn sec" id="copyBtn">Copiar</button><button class="btn quiet" id="dlBtn">Descargar archivo</button></div></div>';
    document.getElementById("expText").value = json;
    document.getElementById("copyBtn").onclick = function () {
      var ta = document.getElementById("expText");
      ta.select();
      var done = false;
      if (navigator.clipboard) { navigator.clipboard.writeText(json).then(function () {}).catch(function () {}); done = true; }
      if (!done) { try { document.execCommand("copy"); } catch (e) {} }
      this.textContent = "Copiado";
    };
    document.getElementById("dlBtn").onclick = function () {
      try {
        var blob = new Blob([json], { type: "application/json" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "progreso-examenes.json";
        document.body.appendChild(a); a.click(); a.remove();
      } catch (e) { this.textContent = "No se puede descargar aquí — copia el texto"; }
    };
  }

  function importPanel(panel) {
    panel.innerHTML = '<div class="io"><p>Pega aquí el texto que exportaste en el otro dispositivo. Los intentos se suman a los que ya tengas, no se pierde nada.</p>' +
      '<textarea class="search io-text" id="impText" rows="3" placeholder="{&quot;exams&quot;:…}"></textarea>' +
      '<div class="row"><button class="btn" id="doImp">Importar</button><span id="impMsg"></span></div></div>';
    document.getElementById("doImp").onclick = function () {
      var msg = document.getElementById("impMsg");
      try {
        var obj = JSON.parse(document.getElementById("impText").value);
        if (!obj || typeof obj !== "object" || !obj.exams) throw new Error("formato");
        Object.keys(obj.exams).forEach(function (id) {
          var incoming = obj.exams[id], cur = prog(id);
          Object.keys(incoming.stats || {}).forEach(function (q) {
            var a = cur.stats[q] || { n: 0, ok: 0 }, b = incoming.stats[q];
            cur.stats[q] = { n: a.n + (b.n || 0), ok: a.ok + (b.ok || 0) };
          });
          Object.keys(incoming.wrong || {}).forEach(function (q) { cur.wrong[q] = 1; });
          Object.keys(incoming.flags || {}).forEach(function (q) { cur.flags[q] = 1; });
          cur.history = (cur.history || []).concat(incoming.history || []).sort(function (a, b) { return a.t - b.t; }).slice(-40);
        });
        save();
        msg.textContent = "Importado. Actualizando…";
        setTimeout(function () { openPanel = null; viewHome(); }, 600);
      } catch (e) {
        msg.textContent = "Ese texto no es un progreso válido.";
      }
    };
  }

  /* ---------------- estadística ---------------- */
  function accuracy(p, list) {
    var n = 0, ok = 0;
    var ids = list ? list.map(function (q) { return q.id; }) : Object.keys(p.stats);
    ids.forEach(function (id) {
      var s = p.stats[id];
      if (s) { n += s.n; ok += s.ok; }
    });
    return { n: n, ok: ok, pct: pct(ok, n) };
  }

  /* ---------------- vista: examen ---------------- */
  function viewExam(ex) {
    stopTimer();
    var p = prog(ex.id), f = ex.format;
    var acc = accuracy(p, null);
    var wrongIds = Object.keys(p.wrong);
    var mastered = ex.questions.filter(function (q) {
      var s = p.stats[q.id]; return s && s.ok >= 1 && !p.wrong[q.id];
    }).length;

    var secRows = ex.sections.map(function (s) {
      var list = ex.questions.filter(function (q) { return q.sec === s.id; });
      var a = accuracy(p, list);
      return '<button class="rowitem" data-sec="' + esc(s.id) + '">' +
        '<span><span class="label">' + esc(s.name) + '</span>' +
        '<span class="sub">' + pc(s.weight) + ' del examen · ' + list.length + ' preguntas en el banco</span></span>' +
        '<span class="bar"><i class="' + barClass(a.pct, f.pass) + '" style="width:' + (a.pct || 0) + '%"></i></span>' +
        '<span class="go">' + (a.pct === null ? "Practicar" : pc(a.pct)) + '</span></button>';
    }).join("");

    var hist = p.history.slice(-5).reverse().map(function (h) {
      var d = new Date(h.t);
      return '<div class="rowitem"><span><span class="label">' + (h.mode === "exam" ? "Simulacro" : "Práctica") + ' · ' + h.total + ' preguntas</span>' +
        '<span class="sub">' + d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ' · ' + fmtTime(h.secs) + '</span></span>' +
        '<span class="bar"><i class="' + barClass(h.pct, f.pass) + '" style="width:' + h.pct + '%"></i></span>' +
        '<span class="chip ' + (h.pct >= f.pass ? "ok" : "no") + '">' + h.pct + ' %</span></div>';
    }).join("");

    app.innerHTML = '<div class="wrap">' +
      '<p><a class="ghost" href="#/">← Todos los exámenes</a></p>' +
      '<div style="margin-top:16px">' +
        '<p class="eyebrow">' + esc(ex.vendor) + ' · ' + esc(ex.code) + ' · ' + esc(ex.release) + '</p>' +
        '<h1 style="margin-top:6px">' + esc(ex.name) + '</h1>' +
        '<p class="muted" style="margin-top:10px;max-width:58ch">Examen oficial: ' + f.scored + ' preguntas puntuadas (más hasta ' + f.unscored + ' sin puntuar), ' + f.minutes + ' minutos y ' + f.pass + ' % para aprobar. ' + f.choices + ' opciones por pregunta, una correcta.</p>' +
      '</div>' +
      '<div class="strip section">' +
        '<div><div class="k mono">' + ex.questions.length + '</div><div class="l">En el banco</div></div>' +
        '<div><div class="k mono">' + (acc.pct === null ? "—" : pc(acc.pct)) + '</div><div class="l">Tu acierto</div></div>' +
        '<div><div class="k mono">' + mastered + '</div><div class="l">Sin fallos</div></div>' +
      '</div>' +
      '<div class="cols section">' +
        '<div class="col-main">' +
          '<div class="section-head"><h2>Empezar</h2></div><div class="modes">' +
            mode("exam", "Simulacro · " + f.minutes + " min", "Examen completo", f.scored + " preguntas repartidas según el peso oficial de cada área. Cronómetro, sin feedback hasta el final.") +
            mode("practice", "Práctica", "Banco completo", ex.questions.length + " preguntas en orden aleatorio, con feedback y explicación tras cada respuesta.") +
            mode("short", "Práctica · 20", "Sesión corta", "20 preguntas al azar para un repaso rápido.") +
            mode("wrong", "Práctica", "Solo mis fallos", wrongIds.length ? "Repite las " + wrongIds.length + " preguntas que has fallado alguna vez." : "Aún no hay fallos registrados. Aparecerán aquí en cuanto ocurra.", !wrongIds.length) +
          '</div>' +
          '<p style="margin-top:12px"><a class="ghost" href="#/e/' + esc(ex.id) + '/list">Ver todas las preguntas y respuestas →</a></p>' +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="section-head"><h2>Áreas del examen</h2></div>' +
          '<p class="eyebrow" style="margin:-6px 0 10px">Peso oficial · tu acierto</p>' +
          '<div class="rows">' + secRows + '</div>' +
          (hist ? '<div class="section-head" style="margin-top:26px"><h2>Últimas sesiones</h2></div><div class="rows">' + hist + '</div>' : "") +
        '</aside>' +
      '</div>' +
      footerHtml(esc(ex.notes) + " El formato del examen, los pesos por área y el " + f.pass + " % de corte son los oficiales de " + esc(ex.vendor) + ".") +
    '</div>';

    bindFooter();

    Array.prototype.forEach.call(app.querySelectorAll("[data-mode]"), function (b) {
      b.onclick = function () { startMode(ex, b.getAttribute("data-mode")); };
    });
    Array.prototype.forEach.call(app.querySelectorAll("[data-sec]"), function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-sec");
        start(ex, { mode: "practice", pool: ex.questions.filter(function (q) { return q.sec === id; }), label: ex.secMap[id].name });
      };
    });
    scrollTop();
  }

  function mode(key, meta, title, desc, disabled) {
    return '<button class="mode" data-mode="' + key + '"' + (disabled ? " disabled" : "") + '>' +
      '<span class="meta">' + esc(meta) + '</span><span class="t">' + esc(title) + '</span>' +
      '<span class="d">' + esc(desc) + '</span></button>';
  }

  function startMode(ex, kind) {
    var p = prog(ex.id);
    if (kind === "exam") return start(ex, { mode: "exam", pool: weightedSet(ex), label: "simulacro", timed: true });
    if (kind === "practice") return start(ex, { mode: "practice", pool: ex.questions.slice(), label: "banco completo" });
    if (kind === "short") return start(ex, { mode: "practice", pool: shuffle(ex.questions.slice()).slice(0, 20), label: "sesión corta" });
    if (kind === "wrong") {
      var pool = ex.questions.filter(function (q) { return p.wrong[q.id]; });
      if (pool.length) start(ex, { mode: "practice", pool: pool, label: "mis fallos" });
    }
  }

  function weightedSet(ex) {
    var secs = ex.sections, total = ex.format.scored;
    var want = largestRemainder(secs.map(function (s) { return s.weight; }), total);
    var picked = [], leftovers = [];
    secs.forEach(function (s, i) {
      var pool = shuffle(ex.questions.filter(function (q) { return q.sec === s.id; }));
      picked = picked.concat(pool.slice(0, want[i]));
      leftovers = leftovers.concat(pool.slice(want[i]));
    });
    shuffle(leftovers);
    while (picked.length < total && leftovers.length) picked.push(leftovers.pop());
    return shuffle(picked).slice(0, total);
  }

  /* ---------------- sesión ---------------- */
  function start(ex, cfg) {
    var pool = shuffle(cfg.pool.slice());
    S = {
      examId: ex.id, ex: ex, mode: cfg.mode, label: cfg.label, list: pool, i: 0, answers: {},
      started: Date.now(), deadline: cfg.timed ? Date.now() + ex.format.minutes * 60000 : null
    };
    go("#/e/" + ex.id + "/run");
    if (location.hash === "#/e/" + ex.id + "/run") viewRun();
  }

  function stopTimer() { if (tick) { clearInterval(tick); tick = null; } }

  function viewRun() {
    var ex = S.ex;
    app.innerHTML = '<div class="wrap has-bar">' +
      '<div class="run">' +
        '<aside class="run-side">' +
          '<div class="side-top">' +
            '<button class="ghost" id="exitBtn">← Salir</button>' +
            '<span class="mono" id="counter"></span>' +
            '<span class="timer mono" id="timer"></span>' +
          '</div>' +
          '<div class="progress"><i id="fill" style="width:0%"></i></div>' +
          '<div class="side-desk">' +
            '<p class="eyebrow" style="margin-top:16px">Preguntas</p>' +
            '<div class="qmap" id="qmap"></div>' +
            '<div class="side-actions">' +
              '<button class="btn" id="nextBtn2">Siguiente</button>' +
              '<button class="btn quiet" id="flagBtn2">Marcar</button>' +
            '</div>' +
          '</div>' +
        '</aside>' +
        '<div class="run-main">' +
          '<div class="qcard">' +
            '<div class="qmeta"><span class="chip theme" id="qSec"></span><span class="chip" id="qTopic"></span></div>' +
            '<p class="stem" id="stem"></p>' +
            '<div class="opts" id="opts"></div>' +
            '<div class="feedback" id="feedback" hidden><div class="verdict" id="verdict"></div><p id="explain"></p><p class="note" id="note" hidden></p></div>' +
          '</div>' +
          '<div class="actionbar"><div class="inner">' +
            '<button class="btn quiet" id="flagBtn">Marcar</button>' +
            '<button class="btn" id="nextBtn">Siguiente</button>' +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>';

    document.getElementById("exitBtn").onclick = function () {
      if (!window.confirm("¿Salir de la sesión? Tu acierto por pregunta se guarda, pero la sesión no.")) return;
      stopTimer(); S = null; go("#/e/" + ex.id);
    };
    document.getElementById("nextBtn").onclick = next;
    document.getElementById("nextBtn2").onclick = next;
    function toggleFlag() {
      var p = prog(ex.id), q = S.list[S.i];
      if (p.flags[q.id]) delete p.flags[q.id]; else p.flags[q.id] = 1;
      save(); paintFlag();
    }
    document.getElementById("flagBtn").onclick = toggleFlag;
    document.getElementById("flagBtn2").onclick = toggleFlag;
    stopTimer();
    tick = setInterval(updateTimer, 1000);
    renderQuestion();
    updateTimer();
    scrollTop();
  }

  function updateTimer() {
    var el = document.getElementById("timer");
    if (!S || !el) return;
    if (S.deadline) {
      var left = Math.max(0, S.deadline - Date.now());
      var m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      el.textContent = m + ":" + (s < 10 ? "0" : "") + s;
      el.classList.toggle("low", left < 5 * 60000);
      if (left === 0) finish();
    } else {
      var e = Math.floor((Date.now() - S.started) / 1000);
      el.textContent = Math.floor(e / 60) + ":" + (e % 60 < 10 ? "0" : "") + (e % 60);
    }
  }

  function paintFlag() {
    var flagged = prog(S.examId).flags[S.list[S.i].id];
    ["flagBtn", "flagBtn2"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.textContent = flagged ? "★ Marcada" : "Marcar";
    });
    var cell = document.querySelector('.qmap button[data-i="' + S.i + '"]');
    if (cell) cell.classList.toggle("flag", !!flagged);
  }

  function renderMap() {
    var host = document.getElementById("qmap");
    if (!host) return;
    var p = prog(S.examId);
    host.textContent = "";
    S.list.forEach(function (q, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cell" + (idx === S.i ? " now" : "") + (S.answers[q.id] !== undefined ? " done" : "") + (p.flags[q.id] ? " flag" : "");
      b.textContent = idx + 1;
      b.setAttribute("data-i", idx);
      b.setAttribute("aria-label", "Pregunta " + (idx + 1));
      b.onclick = function () { goTo(idx); };
      host.appendChild(b);
    });
  }

  function goTo(i) {
    if (!S || i === S.i) return;
    S.i = i;
    renderQuestion();
  }

  function renderQuestion() {
    var q = S.list[S.i], ex = S.ex, p = prog(ex.id);
    document.getElementById("counter").textContent = (S.i + 1) + " / " + S.list.length;
    document.getElementById("fill").style.width = (S.i / S.list.length * 100) + "%";
    document.getElementById("qSec").textContent = (ex.secMap[q.sec] || {}).name || q.sec;
    document.getElementById("qTopic").textContent = q.t;
    document.getElementById("stem").textContent = q.q;
    document.getElementById("feedback").hidden = true;
    document.getElementById("note").hidden = true;
    renderMap();
    paintFlag();

    var opts = document.getElementById("opts");
    opts.textContent = "";
    q.o.forEach(function (text, idx) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "opt";
      var k = document.createElement("span"); k.className = "key"; k.textContent = LETTERS[idx];
      var s = document.createElement("span"); s.textContent = text;
      b.appendChild(k); b.appendChild(s);
      b.onclick = function () { choose(idx); };
      opts.appendChild(b);
    });

    var chosen = S.answers[q.id];
    if (chosen !== undefined) paint(q, chosen);
    setNext(S.i === S.list.length - 1 ? "Terminar" : "Siguiente", S.mode === "practice" && chosen === undefined);
  }

  function setNext(text, disabled) {
    ["nextBtn", "nextBtn2"].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b) return;
      if (text !== null) b.textContent = text;
      b.disabled = !!disabled;
    });
  }

  function paint(q, chosen) {
    var nodes = document.getElementById("opts").children;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.disabled = S.mode === "practice";
      n.classList.remove("sel", "right", "wrong");
      if (S.mode === "practice") {
        if (i === q.a) n.classList.add("right");
        else if (i === chosen) n.classList.add("wrong");
      } else if (i === chosen) n.classList.add("sel");
    }
    if (S.mode === "practice") {
      var ok = chosen === q.a, fb = document.getElementById("feedback");
      fb.hidden = false;
      fb.className = "feedback " + (ok ? "ok" : "no");
      document.getElementById("verdict").textContent = ok ? "Correcto" : "Incorrecto — la buena es " + LETTERS[q.a];
      document.getElementById("explain").textContent = q.e;
      if (q.note) {
        var nt = document.getElementById("note");
        nt.hidden = false; nt.textContent = "Nota: " + q.note;
      }
    }
  }

  function choose(idx) {
    var q = S.list[S.i], p = prog(S.examId);
    if (S.mode === "practice" && S.answers[q.id] !== undefined) return;
    S.answers[q.id] = idx;
    var ok = idx === q.a;
    var rec = p.stats[q.id] || { n: 0, ok: 0 };
    rec.n++; if (ok) rec.ok++;
    p.stats[q.id] = rec;
    if (ok) delete p.wrong[q.id]; else p.wrong[q.id] = 1;
    save();
    paint(q, idx);
    var cell = document.querySelector('.qmap button[data-i="' + S.i + '"]');
    if (cell) cell.classList.add("done");
    setNext(null, false);
    if (S.mode === "exam") setTimeout(next, 130);
  }

  function next() {
    if (!S) return;
    if (S.i === S.list.length - 1) return finish();
    S.i++; renderQuestion(); scrollTop();
  }

  document.addEventListener("keydown", function (e) {
    if (!S || location.hash.indexOf("/run") === -1) return;
    if (e.key >= "1" && e.key <= "5") {
      var i = +e.key - 1;
      if (i < S.list[S.i].o.length) choose(i);
    }
    if (e.key === "Enter" || e.key === "ArrowRight") {
      var nb = document.getElementById("nextBtn");
      if (nb && !nb.disabled) next();
    }
    if (e.key === "ArrowLeft" && S.i > 0) goTo(S.i - 1);
  });

  /* ---------------- resultados ---------------- */
  function finish() {
    stopTimer();
    var ex = S.ex, p = prog(ex.id), f = ex.format;
    var right = 0;
    var bySec = {}, byTopic = {};
    S.list.forEach(function (q) {
      var ok = S.answers[q.id] === q.a;
      if (ok) right++;
      var s = bySec[q.sec] = bySec[q.sec] || { n: 0, ok: 0 };
      s.n++; if (ok) s.ok++;
      var t = byTopic[q.t] = byTopic[q.t] || { n: 0, ok: 0 };
      t.n++; if (ok) t.ok++;
    });
    var total = S.list.length;
    var score = Math.round(right / total * 100);
    var secs = Math.floor((Date.now() - S.started) / 1000);

    p.history.push({ t: Date.now(), mode: S.mode, pct: score, right: right, total: total, secs: secs });
    p.history = p.history.slice(-40);
    save();

    LAST = {
      examId: ex.id, ex: ex, mode: S.mode, label: S.label, list: S.list, answers: S.answers,
      right: right, total: total, score: score, secs: secs, bySec: bySec, byTopic: byTopic
    };
    S = null;
    go("#/e/" + ex.id + "/result");
    if (location.hash.indexOf("/result") !== -1) viewResult();
  }

  function viewResult() {
    var R = LAST, ex = R.ex, f = ex.format, passed = R.score >= f.pass;

    var secRows = ex.sections.map(function (s) {
      var d = R.bySec[s.id];
      if (!d) return "";
      var p2 = pct(d.ok, d.n);
      return { s: s, d: d, pct: p2, impact: s.weight * (1 - d.ok / d.n) };
    }).filter(Boolean).sort(function (a, b) { return b.impact - a.impact; });

    var rowsHtml = secRows.map(function (r) {
      return '<div class="rowitem"><span><span class="label">' + esc(r.s.name) + '</span>' +
        '<span class="sub">' + pc(r.s.weight) + ' del examen · ' + r.d.n + ' preguntas en esta sesión</span></span>' +
        '<span class="bar"><i class="' + barClass(r.pct, f.pass) + '" style="width:' + r.pct + '%"></i></span>' +
        '<span class="n">' + r.d.ok + '/' + r.d.n + '</span></div>';
    }).join("");

    var weakSecs = secRows.filter(function (r) { return r.pct < f.pass; });
    var weakTopics = Object.keys(R.byTopic).map(function (k) {
      var d = R.byTopic[k];
      return { name: k, n: d.n, ok: d.ok, pct: pct(d.ok, d.n) };
    }).filter(function (t) { return t.n >= 2 && t.pct < f.pass; }).sort(function (a, b) { return a.pct - b.pct; }).slice(0, 4);

    var diag;
    if (!weakSecs.length) {
      diag = '<div class="weak" style="border-left-color:var(--good);background:var(--good-soft)">Ninguna área baja del ' + f.pass + ' % en esta sesión. Repite el simulacro con otras preguntas para confirmar que el resultado se sostiene.</div>';
    } else {
      var lead = weakSecs[0];
      diag = '<div class="weak">Tu punto más caro ahora mismo es <b>' + esc(lead.s.name) + '</b>: ' + pc(lead.pct) + ' de acierto sobre un área que vale el ' + pc(lead.s.weight) + ' del examen.' +
        (weakSecs.length > 1 ? ' Después vienen ' + weakSecs.slice(1, 3).map(function (r) { return '<b>' + esc(r.s.name) + '</b> (' + pc(r.pct) + ')'; }).join(" y ") + '.' : '') +
        (weakTopics.length ? '<br><br>Por temas concretos: ' + weakTopics.map(function (t) { return esc(t.name) + ' (' + t.ok + '/' + t.n + ')'; }).join(", ") + '.' : '') +
        '<br><br>El orden está calculado por impacto: acierto bajo multiplicado por el peso oficial del área, que es lo que más puntos te cuesta en el examen real.</div>';
    }

    var missing = f.scored - R.total;
    var note = R.mode === "exam"
      ? 'Simulacro con el reparto oficial por áreas. En el examen real apruebas con ' + f.pass + ' % sobre ' + f.scored + ' preguntas puntuadas, es decir ' + Math.ceil(f.scored * f.pass / 100) + ' aciertos.'
      : 'Sesión de práctica de ' + R.total + ' preguntas' + (missing > 0 ? ', no un examen completo' : '') + '. El listón del ' + f.pass + ' % es el del examen real.';

    var review = R.list.map(function (q, i) {
      var a = R.answers[q.id], ok = a === q.a;
      return '<details class="rev ' + (ok ? "ok" : "no") + '"><summary><span class="idx">' + (i + 1) + '</span>' + esc(q.q) + '</summary>' +
        '<div class="body">' +
          '<div class="ans">Tu respuesta: <b>' + (a === undefined ? "sin contestar" : LETTERS[a] + ". " + esc(q.o[a])) + '</b></div>' +
          '<div class="ans">Correcta: <b>' + LETTERS[q.a] + ". " + esc(q.o[q.a]) + '</b></div>' +
          '<div>' + esc(q.e) + '</div>' +
          (q.note ? '<div class="ans">Nota: ' + esc(q.note) + '</div>' : "") +
        '</div></details>';
    }).join("");

    var wrongCount = R.total - R.right;

    app.innerHTML = '<div class="wrap has-bar">' +
      '<p class="eyebrow">' + (R.mode === "exam" ? "Simulacro" : "Práctica · " + esc(R.label || "")) + ' · ' + R.total + ' preguntas</p>' +
      '<h1 style="margin-top:6px">' + (passed ? "Aprobado" : "Aún no llegas") + '</h1>' +
      '<div class="score section">' +
        '<div><div class="big mono">' + R.score + '<span class="unit">%</span></div>' +
        '<div class="verdict-pill ' + (passed ? "pass" : "fail") + '">' + (passed ? "Por encima del " + pc(f.pass) : "Corte: " + pc(f.pass)) + '</div></div>' +
        '<div class="facts-right"><div><span class="mono">' + R.right + '</span> correctas</div>' +
        '<div><span class="mono">' + wrongCount + '</span> falladas</div>' +
        '<div><span class="mono">' + fmtTime(R.secs) + '</span></div></div>' +
      '</div>' +
      '<p class="small muted" style="margin-top:10px;max-width:62ch">' + note + '</p>' +
      '<div class="cols section">' +
        '<div class="col-main">' +
          '<div class="section-head"><h2>Puntos flacos</h2><span class="eyebrow">Por impacto</span></div>' + diag +
        '</div>' +
        '<aside class="col-side">' +
          '<div class="section-head"><h2>Desglose por área</h2></div><div class="rows">' + rowsHtml + '</div>' +
        '</aside>' +
      '</div>' +
      '<div class="section"><div class="section-head"><h2>Revisión</h2><span class="eyebrow">Toca para abrir</span></div><div class="review grid2">' + review + '</div></div>' +
      '<div class="actionbar"><div class="inner">' +
        '<a class="btn quiet" href="#/e/' + esc(ex.id) + '">Volver</a>' +
        (wrongCount ? '<button class="btn" id="redoBtn">Repasar los ' + wrongCount + ' fallos</button>' : '<a class="btn" href="#/e/' + esc(ex.id) + '">Nueva sesión</a>') +
      '</div></div>' +
    '</div>';

    var redo = document.getElementById("redoBtn");
    if (redo) redo.onclick = function () {
      var pool = R.list.filter(function (q) { return R.answers[q.id] !== q.a; });
      start(ex, { mode: "practice", pool: pool, label: "repaso de fallos" });
    };
    scrollTop();
  }

  /* ---------------- vista: todas las preguntas ---------------- */
  function viewBrowse(ex) {
    stopTimer();
    var p = prog(ex.id);
    app.innerHTML = '<div class="wrap">' +
      '<p><a class="ghost" href="#/e/' + esc(ex.id) + '">← ' + esc(ex.name) + '</a></p>' +
      '<h1 style="margin-top:16px">Todas las preguntas</h1>' +
      '<p class="muted" style="margin-top:8px">' + ex.questions.length + ' preguntas con su respuesta correcta y la explicación. Útil para leer del tirón sin contestar.</p>' +
      '<div class="filters section">' +
        '<input class="search" id="q" type="search" placeholder="Buscar en el enunciado o en las opciones…">' +
        '<select class="search" id="secSel" style="flex:0 1 220px"><option value="">Todas las áreas</option>' +
        ex.sections.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join("") +
        '</select>' +
        '<label class="row small muted" style="gap:6px"><input type="checkbox" id="onlyWrong"> solo mis fallos</label>' +
      '</div>' +
      '<p class="small muted" id="count" style="margin-top:12px"></p>' +
      '<div class="review grid2 section" id="list"></div>' +
    '</div>';

    function draw() {
      var term = document.getElementById("q").value.trim().toLowerCase();
      var sec = document.getElementById("secSel").value;
      var onlyWrong = document.getElementById("onlyWrong").checked;
      var list = ex.questions.filter(function (qq) {
        if (sec && qq.sec !== sec) return false;
        if (onlyWrong && !p.wrong[qq.id]) return false;
        if (!term) return true;
        return (qq.q + " " + qq.o.join(" ") + " " + qq.e).toLowerCase().indexOf(term) !== -1;
      });
      document.getElementById("count").textContent = list.length + " de " + ex.questions.length + " preguntas";
      document.getElementById("list").innerHTML = list.map(function (qq) {
        var st = p.stats[qq.id];
        return '<details class="rev' + (p.wrong[qq.id] ? " no" : st ? " ok" : "") + '"><summary><span class="idx">' + qq.id + '</span>' + esc(qq.q) + '</summary>' +
          '<div class="body">' +
            qq.o.map(function (o, i) {
              return '<div class="ans"' + (i === qq.a ? ' style="color:var(--good)"' : '') + '><b>' + LETTERS[i] + '.</b> ' + esc(o) + (i === qq.a ? " ✓" : "") + '</div>';
            }).join("") +
            '<div style="margin-top:4px">' + esc(qq.e) + '</div>' +
            (qq.note ? '<div class="ans">Nota: ' + esc(qq.note) + '</div>' : "") +
            '<div class="row" style="margin-top:6px"><span class="chip theme">' + esc((ex.secMap[qq.sec] || {}).name || qq.sec) + '</span><span class="chip">' + esc(qq.t) + '</span>' +
            (st ? '<span class="chip ' + (p.wrong[qq.id] ? "no" : "ok") + '">' + st.ok + '/' + st.n + ' aciertos</span>' : "") + '</div>' +
          '</div></details>';
      }).join("") || '<p class="muted small">Sin resultados.</p>';
    }
    document.getElementById("q").oninput = draw;
    document.getElementById("secSel").onchange = draw;
    document.getElementById("onlyWrong").onchange = draw;
    draw();
    scrollTop();
  }

  /* ---------------- arranque ---------------- */
  window.addEventListener("hashchange", route);
  fetchJSON("data/exams.json").then(function (m) {
    manifest = m;
    route();
  }).catch(fail);

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }
})();
