(function (global) {
  var NUM_RE = /^\s*(\d{1,3})\s*([.\-\u2013\u2014)])\s*(.+)$/;
  var SEP_RE = /^[\s_\-\u2014\u2013]{4,}$/;
  var NOTE_RE = /^[\u00bb\u00ab<>].{4,}/;

  function parseScripts(text) {
    var normalized = String(text).replace(/\r\n/g, '\n');
    var lines = normalized.split('\n').map(function (l) { return l.trim(); });

    var scripts = [];
    var idx = -1;
    var pendingNote = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line) {
        if (idx >= 0) scripts[idx].lines.push('');
        continue;
      }
      if (SEP_RE.test(line)) continue;
      if (NOTE_RE.test(line)) {
        pendingNote = pendingNote ? pendingNote + '\n' + line : line;
        continue;
      }

      var m = line.match(NUM_RE);
      var lastNum = idx >= 0 ? scripts[idx].num : -1;
      if (m && (idx === -1 || m[1] > lastNum)) {
        idx++;
        scripts.push({
          num: parseInt(m[1], 10),
          fullTitle: line,
          displayTitle: m[3].trim(),
          note: pendingNote,
          lines: []
        });
        pendingNote = null;
        continue;
      }

      if (idx === -1) {
        idx++;
        scripts.push({ num: null, fullTitle: line, displayTitle: line, note: pendingNote, lines: [] });
        pendingNote = null;
        continue;
      }

      scripts[idx].lines.push(line);
    }

    var parsed = scripts.map(postProcess).filter(function (s) {
      return (s.reading.join('\n\n').trim().length > 0) || (s.instructions.length > 0);
    });

    return parsed;
  }

  function buildParagraphs(lines) {
    var paras = [];
    var cur = [];
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) {
        if (cur.length) { paras.push(cur.join('\n')); cur = []; }
      } else {
        cur.push(t);
      }
    }
    if (cur.length) paras.push(cur.join('\n'));
    return paras;
  }

  function postProcess(script) {
    var title = script.fullTitle;
    var displayTitle = script.displayTitle || title;
    var lines = script.lines;

    var labelIdx = -1;
    var instIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (labelIdx === -1 && /^Roteiro\s*[:.]\s*/i.test(t)) labelIdx = i;
      if (instIdx === -1 && /^Instru\u00e7\u00f5es\s*[:.]?/i.test(t)) instIdx = i;
    }

    var instructions = [];
    var reading = [];
    var legendaMode = false;

    for (var j = 0; j < lines.length; j++) {
      var raw = lines[j];
      var tt = raw.trim();
      var isCredit = /^(Foto|Cr\u00e9dito|Cr\u00e9ditos|Creditos|Fonte)\s*:/i.test(tt);
      var isLegenda = /^Legenda do post/i.test(tt);

      if (labelIdx >= 0) {
        if (j < labelIdx) { instructions.push(raw); continue; }
        if (j === labelIdx) {
          var rm = tt.match(/^Roteiro\s*[:.]\s*(.+)$/i);
          if (rm && rm[1].trim()) reading.push(rm[1].trim());
          continue;
        }
        if (isLegenda) { legendaMode = true; instructions.push(raw); continue; }
        if (legendaMode || isCredit) { instructions.push(raw); continue; }
        reading.push(raw);
        continue;
      }

      if (instIdx >= 0 && j <= instIdx) { instructions.push(raw); continue; }
      if (isLegenda) { legendaMode = true; instructions.push(raw); continue; }
      if (legendaMode || isCredit) { instructions.push(raw); continue; }
      reading.push(raw);
    }

    if (script.note) {
      instructions.unshift(script.note + (instructions.length ? '\n' : ''));
    }

    instructions = buildParagraphs(instructions);
    reading = buildParagraphs(reading);

    var readingText = reading.join('\n\n').replace(/^[\s\n]+|[\s\n]+$/g, '');
    var words = readingText.split(/\s+/).filter(function (w) { return w.length > 0; }).length;

    return {
      num: script.num,
      title: title,
      displayTitle: displayTitle,
      instructions: instructions,
      reading: reading,
      words: words
    };
  }

  var api = { parseScripts: parseScripts };
  global.TelePrompT = { parseScripts: parseScripts };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);