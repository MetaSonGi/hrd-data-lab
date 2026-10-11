/* HRD 데이터랩 — 한국산업인력공단 MCP 서버 브라우저 직결 탐색기 */
(function () {
  'use strict';

  const MCP_BASE = 'https://hrd-mcp-proxy.vercel.app/api/proxy?area=';
  const AREAS = {
    qual:     { icon: '🏆', name: '국가기술자격', sub: 'Q-Net 종목·일정·합격률' },
    overseas: { icon: '🌍', name: '해외취업',   sub: '월드잡플러스 채용공고' },
    ncs:      { icon: '📋', name: 'NCS',        sub: '직무능력표준 15,000건' },
    dual:     { icon: '🏭', name: '일학습병행', sub: '과정평가형·일학습병행' },
    master:   { icon: '🥇', name: '숙련기술',   sub: '대한민국명장·기능경기' },
    eps:      { icon: '🛂', name: 'EPS',        sub: '외국인고용·EPS-TOPIK' },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);

  /* ---------- MCP 클라이언트 ---------- */
  function parseSSE(text) {
    const lines = text.split('\n').filter((l) => l.startsWith('data:'));
    const joined = lines.map((l) => l.slice(5).trim()).join('\n');
    try { return JSON.parse(joined); } catch (e) {
      for (const l of lines) { try { return JSON.parse(l.slice(5).trim()); } catch (_) {} }
      throw new Error('서버 응답을 해석하지 못했습니다.');
    }
  }

  async function mcp(area, method, params, retries = 3) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(`${MCP_BASE}${area}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() + i, method, params }),
        });
        const text = await res.text();
        if (!text || text.length < 10) throw new Error('빈 응답');
        const data = parseSSE(text);
        if (data.error) throw new Error(data.error.message || '서버 오류');
        return data.result;
      } catch (e) {
        lastErr = e;
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
      }
    }
    throw lastErr;
  }

  const callTool = (area, name, args) =>
    mcp(area, 'tools/call', { name, arguments: args || {} });

  function toolText(result) {
    const parts = (result.content || []).filter((c) => c.type === 'text').map((c) => c.text);
    return parts.join('\n\n') || '(결과 없음)';
  }

  /* ---------- 미니 마크다운 렌더러 (표·제목·목록·링크·굵게) ---------- */
  function md(src) {
    const lines = String(src).split('\n');
    let html = '', i = 0, inList = false;
    const inline = (t) => esc(t)
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    while (i < lines.length) {
      const line = lines[i];
      // 표
      if (/^\|.+\|$/.test(line.trim()) && i + 1 < lines.length && /^\|[\s:\-|]+\|$/.test(lines[i + 1].trim())) {
        closeList();
        const heads = line.trim().slice(1, -1).split('|').map((c) => c.trim());
        html += '<table><thead><tr>' + heads.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr></thead><tbody>';
        i += 2;
        while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
          const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
          html += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
          i++;
        }
        html += '</tbody></table>';
        continue;
      }
      const hm = line.match(/^(#{1,4})\s+(.*)/);
      if (hm) { closeList(); html += `<h${hm[1].length + 2}>${inline(hm[2])}</h${hm[1].length + 2}>`; i++; continue; }
      if (/^\s*---+\s*$/.test(line)) { closeList(); html += '<hr>'; i++; continue; }
      const lm = line.match(/^\s*[-*]\s+(.*)/);
      if (lm) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(lm[1])}</li>`; i++; continue; }
      closeList();
      if (line.trim()) html += `<p>${inline(line)}</p>`;
      i++;
    }
    closeList();
    return html;
  }

  /* ---------- 탭 ---------- */
  const tabsEl = $('tabs');
  Object.entries(AREAS).forEach(([key, a], idx) => {
    const b = document.createElement('button');
    b.className = 'tab' + (idx === 0 ? ' active' : '');
    b.innerHTML = `${a.icon} ${a.name}<small>${a.sub}</small>`;
    b.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
      document.querySelectorAll('.area').forEach((s) => s.classList.toggle('active', s.id === 'area-' + key));
      loadTools(key);
    });
    tabsEl.appendChild(b);
  });

  /* ---------- 도구 목록 → 폼 자동 생성 ---------- */
  const loadedAreas = new Set();
  async function loadTools(area) {
    if (loadedAreas.has(area)) return;
    loadedAreas.add(area);
    const box = $('tools-' + area);
    box.innerHTML = '<p class="loading">도구 목록 불러오는 중…</p>';
    try {
      const res = await mcp(area, 'tools/list', {});
      box.innerHTML = '';
      res.tools.forEach((t) => box.appendChild(toolCard(area, t)));
    } catch (e) {
      box.innerHTML = `<p class="loading err">도구 목록을 불러오지 못했습니다: ${esc(e.message)} <button class="btn small" onclick="location.reload()">다시 시도</button></p>`;
      loadedAreas.delete(area);
    }
  }

  function toolCard(area, tool) {
    const card = document.createElement('div');
    card.className = 'tool';
    const schema = tool.inputSchema || {};
    const props = schema.properties || {};
    const required = new Set(schema.required || []);
    const fields = Object.entries(props).map(([name, p]) => {
      const req = required.has(name) ? '<span class="req">*</span>' : '';
      const label = `${esc(p.title || name)}${req}`;
      const hint = p.description ? esc(p.description) : '';
      let input;
      if (p.enum) {
        input = `<select data-p="${esc(name)}"><option value="">(선택 안 함)</option>` +
          p.enum.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + '</select>';
      } else if (p.type === 'boolean') {
        input = `<select data-p="${esc(name)}"><option value="">(선택 안 함)</option><option value="true">예</option><option value="false">아니오</option></select>`;
      } else if (p.type === 'integer' || p.type === 'number') {
        input = `<input type="number" data-p="${esc(name)}" placeholder="${hint}" />`;
      } else {
        input = `<input type="text" data-p="${esc(name)}" placeholder="${hint}" />`;
      }
      return `<label class="f">${label}${input}</label>`;
    }).join('');

    card.innerHTML = `
      <div class="tool-head"><h3>${esc(tool.title || tool.name)}</h3></div>
      <p class="tool-desc">${esc(tool.description || '')}</p>
      <div class="tool-form">${fields}<button class="btn primary run">▶ 실행</button></div>
      <div class="result" style="display:none"></div>`;
    const runBtn = card.querySelector('.run');
    const resultBox = card.querySelector('.result');
    runBtn.addEventListener('click', async () => {
      const args = {};
      let ok = true;
      card.querySelectorAll('[data-p]').forEach((el) => {
        const k = el.dataset.p;
        let v = el.value.trim();
        if (!v) {
          if (required.has(k)) { ok = false; el.style.borderColor = 'var(--err)'; }
          return;
        }
        el.style.borderColor = '';
        const prop = props[k] || {};
        if (prop.type === 'boolean') v = (v === 'true');
        else if (prop.type === 'integer') v = parseInt(v, 10);
        else if (prop.type === 'number') v = parseFloat(v);
        args[k] = v;
      });
      if (!ok) { alert('필수 입력(*)을 채워주세요.'); return; }
      runBtn.disabled = true;
      resultBox.style.display = 'block';
      resultBox.innerHTML = '<p class="loading">조회 중…</p>';
      try {
        const res = await callTool(area, tool.name, args);
        if (res.isError) resultBox.innerHTML = `<p class="err">${md(toolText(res))}</p>`;
        else resultBox.innerHTML = md(toolText(res));
      } catch (e) {
        resultBox.innerHTML = `<p class="err">조회 실패: ${esc(e.message)}</p>`;
      }
      runBtn.disabled = false;
    });
    return card;
  }

  /* ---------- 자격증 대시보드 ---------- */
  $('dashRun').addEventListener('click', async () => {
    const q = $('dashQuery').value.trim();
    if (!q) { alert('자격증 이름을 입력하세요.'); return; }
    const box = $('dashResult');
    const btn = $('dashRun');
    btn.disabled = true;
    const jobs = [
      ['📅 시험일정', callTool('qual', 'get_exam_schedule', { qualificationName: q })],
      ['📋 종목 상세정보', callTool('qual', 'get_qualification_info', { qualificationName: q })],
      ['💰 응시수수료', callTool('qual', 'get_exam_fee', { qualificationName: q })],
      ['📊 합격률·통계', callTool('qual', 'get_pass_rate', { qualificationName: q })],
    ];
    box.innerHTML = jobs.map(([t]) => `<div class="dash-sec"><h3>${t}</h3><p class="loading">조회 중…</p></div>`).join('');
    const secs = box.querySelectorAll('.dash-sec');
    await Promise.all(jobs.map(async ([, promise], i) => {
      try {
        const res = await promise;
        secs[i].innerHTML = `<h3>${jobs[i][0]}</h3>` + (res.isError ? `<p class="err">${esc(toolText(res))}</p>` : md(toolText(res)));
      } catch (e) {
        secs[i].innerHTML = `<h3>${jobs[i][0]}</h3><p class="err">조회 실패: ${esc(e.message)}</p>`;
      }
    }));
    btn.disabled = false;
  });
  $('dashQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('dashRun').click(); });

  /* ---------- 푸터 ---------- */
  $('copyAddr').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('https://openapi.hrdkorea.or.kr/mcp');
      $('copyAddr').textContent = '✅ 복사됨';
      setTimeout(() => { $('copyAddr').textContent = '📋 주소 복사'; }, 1500);
    } catch (e) { alert('복사 실패. 주소를 직접 복사하세요.'); }
  });

  /* ---------- 시작 ---------- */
  (async () => {
    try {
      await mcp('qual', 'tools/list', {});
      const pill = $('serverStatus');
      pill.className = 'status-pill ok';
      pill.textContent = '🟢 MCP 서버 연결됨';
    } catch (e) {
      const pill = $('serverStatus');
      pill.className = 'status-pill err';
      pill.textContent = '🔴 서버 연결 실패';
    }
    loadTools('qual');
  })();
})();
