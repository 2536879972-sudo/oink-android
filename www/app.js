/* ============================================================
   Oink Android — 主逻辑
   ============================================================ */
'use strict';

const $ = id => document.getElementById(id);

/* ---------------- 状态 ---------------- */
const DEFAULT_CONFIG = {
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  key: '',
  model: 'deepseek-chat',
  temperature: 0.7,
  system: '你是一个有帮助的助手。回答简洁准确。'
};

const state = {
  chats: [],          // [{id,title,messages:[{role,content,images}],createdAt}]
  currentId: null,
  sending: false,
  abortCtrl: null,
  pendingImage: null  // dataURL
};

let config = { ...DEFAULT_CONFIG };

/* ---------------- 存储 ---------------- */
const STORE_KEY = 'oink_android_v1';

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      chats: state.chats,
      currentId: state.currentId,
      config
    }));
  } catch (e) { console.warn('save failed', e); }
}

function hydrate() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (Array.isArray(d.chats)) state.chats = d.chats;
    if (d.currentId) state.currentId = d.currentId;
    if (d.config) config = { ...DEFAULT_CONFIG, ...d.config };
  } catch (e) { console.warn('load failed', e); }
}

/* ---------------- 工具 ---------------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function currentChat() {
  return state.chats.find(c => c.id === state.currentId) || null;
}

function ensureChat() {
  let c = currentChat();
  if (!c) {
    c = { id: uid(), title: '新对话', messages: [], createdAt: Date.now() };
    state.chats.unshift(c);
    state.currentId = c.id;
  }
  return c;
}

/* ---------------- 启动动画 ---------------- */
window.addEventListener('load', () => {
  const sp = $('splash');
  if (!sp) return;
  setTimeout(() => {
    sp.classList.add('hide');
    setTimeout(() => { if (sp.parentNode) sp.remove(); }, 650);
  }, 1900);
});

/* ---------------- 渲染：会话列表 ---------------- */
function renderChatList() {
  const box = $('chatList');
  box.innerHTML = '';
  const list = state.chats.length ? state.chats : [];

  if (!list.length) {
    box.innerHTML = '<div style="padding:20px;text-align:center;color:#5a5a68;font-size:13px">还没有会话</div>';
    return;
  }

  list.forEach(c => {
    const el = document.createElement('div');
    el.className = 'chat-item' + (c.id === state.currentId ? ' active' : '');
    el.innerHTML = `
      <span class="ci-title">${esc(c.title || '新对话')}</span>
      <button class="ci-del" data-id="${c.id}">×</button>`;
    el.addEventListener('click', e => {
      if (e.target.classList.contains('ci-del')) return;
      state.currentId = c.id;
      persist();
      renderChatList();
      renderMessages();
      closeSidebar();
    });
    el.querySelector('.ci-del').addEventListener('click', e => {
      e.stopPropagation();
      deleteChat(c.id);
    });
    box.appendChild(el);
  });
}

function deleteChat(id) {
  state.chats = state.chats.filter(c => c.id !== id);
  if (state.currentId === id) state.currentId = state.chats[0]?.id || null;
  persist();
  renderChatList();
  renderMessages();
}

/* ---------------- 渲染：消息 ---------------- */
function renderMessages() {
  const box = $('messages');
  box.innerHTML = '';
  const c = currentChat();

  $('chatTitle').textContent = c ? (c.title || '新对话') : '新对话';
  $('chatSub').textContent = config.model;

  if (!c || !c.messages.length) {
    box.innerHTML = `
      <div id="empty">
        <div class="e-icon">💬</div>
        <div class="e-title">开始聊天</div>
        <div class="e-sub">输入文字、发图片或按住麦克风说话</div>
      </div>`;
    return;
  }

  c.messages.forEach((m, i) => {
    box.appendChild(buildMsgEl(m, i));
  });
  scrollBottom();
}

function buildMsgEl(m, index) {
  const isUser = m.role === 'user';
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + (isUser ? 'user' : 'ai');
  wrap.dataset.index = index;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = isUser ? '我' : 'AI';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (m.images && m.images.length) {
    m.images.forEach(src => {
      const im = document.createElement('img');
      im.src = src;
      im.loading = 'lazy';
      im.addEventListener('click', () => openFull(src));
      bubble.appendChild(im);
    });
  }

  if (m.content) {
    const txt = document.createElement('div');
    txt.textContent = m.content;
    bubble.appendChild(txt);
  }

  wrap.appendChild(avatar);
  wrap.appendChild(bubble);
  return wrap;
}

function scrollBottom() {
  const box = $('messages');
  box.scrollTop = box.scrollHeight;
}

function openFull(src) {
  const w = document.createElement('div');
  w.style.cssText = 'position:fixed;inset:0;z-index:9998;background:#000;display:flex;align-items:center;justify-content:center;padding:16px';
  const im = document.createElement('img');
  im.src = src;
  im.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain';
  w.appendChild(im);
  w.addEventListener('click', () => w.remove());
  document.body.appendChild(w);
}

/* ---------------- 侧边栏 ---------------- */
function openSidebar() {
  $('sidebar').classList.add('open');
  $('scrim').classList.add('show');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('scrim').classList.remove('show');
}

/* ---------------- 图片 ---------------- */
function pickImage(fromCamera) {
  $(fromCamera ? 'fileCamera' : 'fileGallery').click();
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('no file'));
    if (!file.type.startsWith('image/')) return reject(new Error('not image'));
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // 压缩：最长边 1280
        const MAX = 1280;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const r = Math.min(MAX / width, MAX / height);
          width = Math.round(width * r);
          height = Math.round(height * r);
        }
        const cv = document.createElement('canvas');
        cv.width = width; cv.height = height;
        cv.getContext('2d').drawImage(img, 0, 0, width, height);
        let quality = 0.85;
        let data = cv.toDataURL('image/jpeg', quality);
        // 压到 1.5MB 以内
        while (data.length > 1_500_000 * 1.37 && quality > 0.5) {
          quality -= 0.1;
          data = cv.toDataURL('image/jpeg', quality);
        }
        resolve(data);
      };
      img.onerror = () => reject(new Error('decode failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

function showPreview(dataUrl) {
  state.pendingImage = dataUrl;
  $('previewImg').src = dataUrl;
  $('imgPreview').classList.remove('hidden');
}
function clearPreview() {
  state.pendingImage = null;
  $('imgPreview').classList.add('hidden');
  $('previewImg').src = '';
  $('fileGallery').value = '';
  $('fileCamera').value = '';
}

/* ---------------- 发送 ---------------- */
async function send() {
  if (state.sending) { stopSend(); return; }

  const input = $('input');
  const text = input.value.trim();
  const img = state.pendingImage;

  if (!text && !img) return;
  if (!config.key) {
    openSettings();
    toast('请先在设置里填 API Key');
    return;
  }

  const chat = ensureChat();

  // 用户消息
  const userMsg = { role: 'user', content: text, images: img ? [img] : [] };
  chat.messages.push(userMsg);

  if (chat.title === '新对话') {
    chat.title = (text || '图片消息').slice(0, 20);
  }

  input.value = '';
  input.style.height = 'auto';
  clearPreview();
  renderChatList();
  renderMessages();

  // 占位 AI 消息
  const aiMsg = { role: 'assistant', content: '' };
  chat.messages.push(aiMsg);
  const aiEl = buildMsgEl(aiMsg, chat.messages.length - 1);
  const bubble = aiEl.querySelector('.bubble');
  bubble.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  $('messages').appendChild(aiEl);
  scrollBottom();

  state.sending = true;
  setSendBtn(true);

  const ctrl = new AbortController();
  state.abortCtrl = ctrl;

  try {
    await streamChat(chat, aiMsg, bubble, ctrl.signal);
  } catch (err) {
    if (err.name === 'AbortError') {
      if (!aiMsg.content) aiMsg.content = '（已停止）';
    } else {
      aiMsg.content = '请求失败：' + (err.message || err);
    }
    bubble.textContent = aiMsg.content;
  } finally {
    state.sending = false;
    state.abortCtrl = null;
    setSendBtn(false);
    persist();
    scrollBottom();
  }
}

function setSendBtn(busy) {
  const btn = $('sendBtn');
  if (busy) {
    btn.classList.add('stop');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>';
  } else {
    btn.classList.remove('stop');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 12l16-8-6 16-2-6z" fill="currentColor"/></svg>';
  }
}

function stopSend() {
  if (state.abortCtrl) state.abortCtrl.abort();
}

/* ---------------- 流式请求 ---------------- */
async function streamChat(chat, aiMsg, bubble, signal) {
  const msgs = [];

  if (config.system) msgs.push({ role: 'system', content: config.system });

  // 历史（不含刚加的占位 AI）
  chat.messages.slice(0, -1).forEach(m => {
    if (m.role === 'user' && m.images && m.images.length) {
      // 多模态格式
      const parts = [];
      if (m.content) parts.push({ type: 'text', text: m.content });
      m.images.forEach(src => parts.push({ type: 'image_url', image_url: { url: src } }));
      msgs.push({ role: 'user', content: parts });
    } else if (m.content) {
      msgs.push({ role: m.role, content: m.content });
    }
  });

  const body = {
    model: config.model,
    messages: msgs,
    temperature: Number(config.temperature),
    stream: true
  };

  const res = await fetch(config.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + config.key
    },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 200));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let first = true;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';

    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith('data:')) continue;
      const payload = s.slice(5).trim();
      if (payload === '[DONE]') continue;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          if (first) { bubble.textContent = ''; first = false; }
          aiMsg.content += delta;
          bubble.textContent = aiMsg.content;
          scrollBottom();
        }
        // 推理模型：reasoning_content
        const rc = j.choices?.[0]?.delta?.reasoning_content;
        if (rc && first) {
          bubble.textContent = '思考中…';
        }
      } catch (e) { /* 忽略解析错误 */ }
    }
  }

  if (!aiMsg.content) {
    aiMsg.content = '（无回复）';
    bubble.textContent = aiMsg.content;
  }
}

/* ---------------- 语音 ---------------- */
let recog = null;

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('此设备不支持语音识别'); return; }

  recog = new SR();
  recog.lang = 'zh-CN';
  recog.continuous = false;
  recog.interimResults = true;

  $('voiceOverlay').classList.remove('hidden');
  $('voiceOverlay').querySelector('.voice-text').textContent = '正在听…';

  let finalText = '';

  recog.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    $('voiceOverlay').querySelector('.voice-text').textContent = finalText + interim || '正在听…';
  };

  recog.onerror = e => {
    closeVoice();
    toast('语音识别失败：' + (e.error || 'unknown'));
  };

  recog.onend = () => {
    closeVoice();
    if (finalText.trim()) {
      $('input').value = ($('input').value + ' ' + finalText).trim();
      autoResize();
    }
  };

  try { recog.start(); } catch (e) { closeVoice(); toast('无法启动语音'); }
}

function closeVoice() {
  $('voiceOverlay').classList.add('hidden');
  if (recog) { try { recog.stop(); } catch (e) {} recog = null; }
}

/* ---------------- 设置 ---------------- */
function openSettings() {
  $('cfgEndpoint').value = config.endpoint;
  $('cfgKey').value = config.key;
  $('cfgModel').value = config.model;
  $('cfgTemp').value = config.temperature;
  $('tempVal').textContent = config.temperature;
  $('cfgSystem').value = config.system;
  $('settingsSheet').classList.remove('hidden');
}

function closeSettings() {
  $('settingsSheet').classList.add('hidden');
}

function saveSettings() {
  config.endpoint = $('cfgEndpoint').value.trim() || DEFAULT_CONFIG.endpoint;
  config.key = $('cfgKey').value.trim();
  config.model = $('cfgModel').value;
  config.temperature = Number($('cfgTemp').value);
  config.system = $('cfgSystem').value;
  persist();
  closeSettings();
  $('chatSub').textContent = config.model;
  toast('已保存');
}

/* ---------------- 导出 ---------------- */
function exportChats() {
  if (!state.chats.length) { toast('没有会话可导出'); return; }

  let md = '# Oink 对话导出\n\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
  state.chats.forEach(c => {
    md += '---\n\n## ' + (c.title || '新对话') + '\n\n';
    md += '创建时间：' + new Date(c.createdAt).toLocaleString('zh-CN') + '\n\n';
    c.messages.forEach(m => {
      md += (m.role === 'user' ? '**我：**' : '**AI：**') + '\n\n';
      if (m.images && m.images.length) md += '_[含 ' + m.images.length + ' 张图片]_\n\n';
      md += (m.content || '') + '\n\n';
    });
  });

  const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'oink-export-' + new Date().toISOString().slice(0, 10) + '.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('已导出');
}

/* ---------------- 提示 ---------------- */
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(100px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:rgba(40,40,52,.95);color:#fff;padding:10px 20px;border-radius:20px;font-size:14px;z-index:9999;backdrop-filter:blur(10px);box-shadow:0 6px 24px rgba(0,0,0,.4);animation:msgIn .2s ease-out';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

/* ---------------- 输入框自适应 ---------------- */
function autoResize() {
  const el = $('input');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 130) + 'px';
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $('menuBtn').addEventListener('click', openSidebar);
  $('scrim').addEventListener('click', closeSidebar);

  $('newChatBtn').addEventListener('click', () => {
    const c = { id: uid(), title: '新对话', messages: [], createdAt: Date.now() };
    state.chats.unshift(c);
    state.currentId = c.id;
    persist();
    renderChatList();
    renderMessages();
    closeSidebar();
  });

  $('settingsBtn').addEventListener('click', () => { openSettings(); closeSidebar(); });
  $('exportBtn').addEventListener('click', () => { exportChats(); closeSidebar(); });

  $('clearBtn').addEventListener('click', () => {
    const c = currentChat();
    if (!c) return;
    if (confirm('清空当前对话？')) {
      c.messages = [];
      c.title = '新对话';
      persist();
      renderChatList();
      renderMessages();
    }
  });

  $('attachBtn').addEventListener('click', () => pickImage(false));
  $('cameraBtn').addEventListener('click', () => pickImage(true));

  ['fileGallery', 'fileCamera'].forEach(id => {
    $(id).addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = await readImage(f);
        showPreview(data);
      } catch (err) {
        toast('图片读取失败');
      }
    });
  });

  $('removeImg').addEventListener('click', clearPreview);

  $('input').addEventListener('input', autoResize);
  $('input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  $('sendBtn').addEventListener('click', send);
  $('micBtn').addEventListener('click', startVoice);
  $('voiceCancel').addEventListener('click', closeVoice);

  $('closeSettings').addEventListener('click', closeSettings);
  $('saveSettings').addEventListener('click', saveSettings);

  $('cfgTemp').addEventListener('input', e => {
    $('tempVal').textContent = Number(e.target.value).toFixed(2);
  });

  // 点击遮罩关闭设置
  $('settingsSheet').addEventListener('click', e => {
    if (e.target === $('settingsSheet')) closeSettings();
  });

  // 物理返回键（安卓）
  document.addEventListener('backbutton', e => {
    if ($('sidebar').classList.contains('open')) { closeSidebar(); e.preventDefault(); }
    else if (!$('settingsSheet').classList.contains('hidden')) { closeSettings(); e.preventDefault(); }
    else if (!$('voiceOverlay').classList.contains('hidden')) { closeVoice(); e.preventDefault(); }
  });
}

/* ---------------- 初始化 ---------------- */
function init() {
  hydrate();
  bind();
  if (!state.currentId && state.chats.length) state.currentId = state.chats[0].id;
  renderChatList();
  renderMessages();
  if (!config.key) {
    setTimeout(() => {
      openSettings();
      toast('首次使用，请填 API Key');
    }, 2400);
  }
}

document.addEventListener('DOMContentLoaded', init);
