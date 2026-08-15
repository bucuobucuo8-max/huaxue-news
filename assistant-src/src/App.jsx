import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useEffect, useRef } from 'react';
import { marked } from 'marked';

const QUICK = ['有哪些和催化剂相关的？', '适合入门的有哪些？', '帮我找标题里带 AI 的'];
const TOOL_LABEL = { searchItems: '搜索站内条目', getItemById: '查询条目详情', readUrl: '读取网页' };
const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound';

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 渲染助手 Markdown 输出(加粗/标题/列表/换行等),先转义原始 HTML 防注入
function renderMarkdown(text) {
  if (!text) return '';
  return marked.parse(escapeHtml(text), { breaks: true });
}

// ---- 分子查询(与主站逻辑一致):识别「X 的结构式」类输入 ----
function parseMoleculeQuery(text) {
  let m = text.match(/^\/(?:mol|分子)\s*[:：]?\s*(.+)$/i);
  if (m) return m[1].trim();
  m = text.match(/^(?:帮我|给我|我想看?|我想看看|请)?(?:画|生成|画出|显示|看看|查|做)?一?[下张个幅]?(.{1,24}?)(?:的)?(?:分子)?(?:结构式|结构图|结构|分子式|分子模型)(?:图|图像|可视化|的可视化图像)?[。!！？?]*$/);
  if (m) {
    const q = m[1].trim();
    if (q && !/^(我|你|它|这|那|哪|什么|怎么|为什么)/.test(q) && !/^(分子式|结构式|结构图|分子|化合物)$/.test(q)) return q;
  }
  return null;
}

function molQueryKinds(q) {
  if (q.startsWith('InChI=')) return ['inchi', 'name', 'smiles'];
  if (/^([A-Z][a-z]?\d*)+$/.test(q)) return ['fastformula', 'name', 'smiles'];
  if (/[()=#\[\]@\\\/+]/.test(q)) return ['smiles', 'name', 'fastformula'];
  return ['name', 'smiles', 'fastformula'];
}

async function fetchMolecule(query) {
  query = (query || '').trim();
  if (!query) return { error: '请输入化合物名称' };
  let note = '';
  // 中文名:先用 DeepSeek 转英文名 + SMILES,再查 PubChem
  if (/[\u4e00-\u9fa5]/.test(query)) {
    try {
      const resp = await fetch('/api/ai/compound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: query }),
      });
      const json = await resp.json();
      if (json.code === 200 && json.data && (json.data.smiles || json.data.english)) {
        note = `已自动翻译:「${query}」→ ${json.data.english || json.data.smiles}`;
        query = json.data.smiles || json.data.english;
      } else if (json.code === 500) {
        return { error: '翻译服务暂不可用,请稍后重试,或直接输入英文名 / 分子式 / SMILES。' };
      } else {
        return { error: `无法识别「${query}」,请换用更规范的名称,或直接输入英文名 / 分子式 / SMILES。` };
      }
    } catch {
      return { error: '翻译服务暂不可用,请改用英文名 / 分子式 / SMILES 直接查询。' };
    }
  }
  for (const kind of molQueryKinds(query)) {
    try {
      const resp = await fetch(`${PUBCHEM}/${kind}/${encodeURIComponent(query)}/property/MolecularFormula,MolecularWeight,IUPACName,IsomericSMILES,CanonicalSMILES,InChIKey/JSON`);
      if (!resp.ok) continue;
      const json = await resp.json();
      const prop = json.PropertyTable && json.PropertyTable.Properties && json.PropertyTable.Properties[0];
      if (prop) {
        // PubChem JSON 输出把 IsomericSMILES/CanonicalSMILES 映射为 SMILES/ConnectivitySMILES
        prop.IsomericSMILES = prop.IsomericSMILES || prop.SMILES || prop.CanonicalSMILES || prop.ConnectivitySMILES || '';
        prop.CanonicalSMILES = prop.CanonicalSMILES || prop.ConnectivitySMILES || prop.SMILES || '';
        return { imgUrl: `${PUBCHEM}/${kind}/${encodeURIComponent(query)}/PNG`, prop, note, query };
      }
    } catch {}
  }
  return { error: `PubChem 未收录「${query}」——它可能是非整比材料、混合物或聚合物,不在小分子数据库中。你可以直接向 Agent 提问了解它。` };
}

// 3D 查看器:优先 PubChem 3D SDF,备选 SMILES 直接生成,最后回退 2D 图
async function initMol3D(container) {
  if (!container || container.dataset.inited === '1') return;
  const cid = container.dataset.cid;
  const smiles = container.dataset.smiles;
  const fallback = container.dataset.fallback;
  const showFallback = () => { container.innerHTML = `<img src="${fallback}" alt="2D 结构式">`; };
  if (!window.$3Dmol) { showFallback(); return; }
  const render3D = (model, format) => {
    container.innerHTML = '';
    const viewer = window.$3Dmol.createViewer(container, { backgroundColor: '#f4f8fb' });
    viewer.addModel(model, format);
    viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.3 } });
    viewer.zoomTo();
    viewer.spin('y', 0.5);
    viewer.render();
  };
  if (cid) {
    try {
      const resp = await fetch(`${PUBCHEM}/cid/${cid}/SDF?record_type=3d`);
      if (resp.ok) {
        const sdf = await resp.text();
        if (sdf && sdf.length > 50) { render3D(sdf, 'sdf'); container.dataset.inited = '1'; return; }
      }
    } catch {}
  }
  if (smiles) {
    try { render3D(smiles, 'smiles'); container.dataset.inited = '1'; return; } catch {}
  }
  showFallback();
  container.dataset.inited = '1';
}

let localId = 0;

export default function App() {
  const [input, setInput] = useState('');
  const [localMsgs, setLocalMsgs] = useState([]); // 本地渲染的消息(分子查询卡片), 与后端消息按时间合并
  const bottomRef = useRef(null);
  const embed = typeof window !== 'undefined' && window.self !== window.top;
  const { messages, sendMessage, status, error, regenerate } = useChat({
    transport: new DefaultChatTransport({ api: '/api/ai/assistant' }),
  });

  const busy = status === 'submitted' || status === 'streaming';

  // 所有消息(后端 + 本地)按时间排序合并显示
  const allMsgs = [...messages.map((m) => ({ ...m, _src: 'chat' })), ...localMsgs]
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, localMsgs, status]);

  // 3D 分子卡片渲染(卡片挂载后初始化)
  useEffect(() => {
    document.querySelectorAll('.mol-3d').forEach((el) => initMol3D(el));
  }, [localMsgs]);

  // 分子卡片 HTML
  const molCardHtml = (r) => {
    if (r.error) return `⚠️ ${escapeHtml(r.error)}`;
    const p = r.prop;
    return (
      <div className="mol-card">
        {r.note ? <div className="mol-note">{escapeHtml(r.note)}</div> : null}
        <div className="mol-head">🧬 <b>{escapeHtml(p.IUPACName || r.query)}</b></div>
        <div className="mol-3d" data-cid={p.CID || ''} data-smiles={escapeHtml(p.IsomericSMILES || p.CanonicalSMILES || '')} data-fallback={r.imgUrl}>
          <div className="mol-3d-loading">3D 加载中…</div>
        </div>
        <dl className="mol-props">
          <div><dt>分子式</dt><dd>{escapeHtml(p.MolecularFormula || '-')}</dd></div>
          <div><dt>分子量</dt><dd>{escapeHtml(String(p.MolecularWeight || '-'))} g/mol</dd></div>
          <div><dt>SMILES</dt><dd className="mol-smiles">{escapeHtml(p.IsomericSMILES || '-')}</dd></div>
          {p.InChIKey ? <div><dt>InChIKey</dt><dd className="mol-smiles">{escapeHtml(p.InChIKey)}</dd></div> : null}
        </dl>
      </div>
    );
  };

  // 统一发送入口:分子查询在本地渲染 3D 卡片,同时把问题发给 AI 后端,
  // 保证后续「这个分子……」的追问能带上上下文继续讨论
  const handleSend = async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || busy) return;
    const molQuery = parseMoleculeQuery(trimmed);
    if (molQuery) {
      sendMessage({ text: trimmed });
      const result = await fetchMolecule(molQuery);
      setLocalMsgs((prev) => [...prev,
        { id: `loc-${localId++}`, role: 'assistant', createdAt: Date.now(), parts: [], mol: result },
      ]);
      return;
    }
    sendMessage({ text: trimmed });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!input.trim() || busy) return;
    handleSend(input);
    setInput('');
  };

  // 接收主站 postMessage:统一「问 Agent」入口(周期表 / 今日分子 / 发送网页等)
  useEffect(() => {
    const onMsg = (e) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d && d.type === 'ask' && typeof d.text === 'string' && d.text.trim()) {
        handleSend(d.text);
      } else if (d && d.type === 'read' && typeof d.url === 'string' && d.url.trim()) {
        const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : '这个网页';
        sendMessage({ text: `请阅读并总结这篇网页内容:\n标题:${title}\n链接:${d.url.trim()}` });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendMessage, busy]);

  const renderParts = (m) => m.parts.map((p, i) => {
    if (p.type === 'text') {
      return <div className="text" key={i} dangerouslySetInnerHTML={{ __html: renderMarkdown(p.text) }} />;
    }
    if (p.type === 'tool-searchItems' || p.type === 'tool-getItemById' || p.type === 'tool-readUrl') {
      const name = p.type.replace('tool-', '');
      const q = p.input?.query || p.input?.id || p.input?.url;
      return (
        <div className="tool" key={i}>
          <span className="tool-icon">🔧</span>
          <span>{TOOL_LABEL[name] || name}</span>
          {p.state === 'input-available' && q != null ? <span className="tool-q">“{String(q)}”</span> : null}
          <span className="tool-state">
            {p.state === 'input-streaming' ? '准备参数…'
              : p.state === 'input-available' ? '查询中…'
              : p.state === 'output-available' ? '完成'
              : p.state === 'output-error' ? '出错'
              : ''}
          </span>
          {p.state === 'output-available' && Array.isArray(p.output) && p.output.length > 0 && (
            <div className="refs">
              {p.output.map((o) => (
                <a key={o.id} href={o.url} target="_blank" rel="noreferrer">{o.title}</a>
              ))}
            </div>
          )}
        </div>
      );
    }
    return null;
  });

  return (
    <div className="wrap">
      {!embed && (
        <header>
          <h1>🧪 站内 AI 助手</h1>
          <a className="back" href="/">← 返回资料站</a>
        </header>
      )}

      <main className="chat">
        {allMsgs.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.mol ? molCardHtml(m.mol) : renderParts(m)}
          </div>
        ))}

        {busy && (
          <div className="msg assistant">
            <div className="text typing"><span className="dot" /> 思考中…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {error && (
        <div className="error">
          <span>出错了：{error.message}</span>
          <button onClick={() => regenerate()}>重试</button>
        </div>
      )}

      <div className="quick">
        {QUICK.map((q) => (
          <button key={q} disabled={busy} onClick={() => handleSend(q)}>{q}</button>
        ))}
      </div>

      <form className="input-row" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问我站内有什么内容，例如：有哪些和 AI 相关的？\n也可以输入「布洛芬的结构式」查看 3D 分子模型"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>发送</button>
      </form>
    </div>
  );
}
