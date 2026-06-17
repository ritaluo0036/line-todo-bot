const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const CHANNEL_SECRET = process.env.CHANNEL_SECRET || 'your_channel_secret';
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || 'your_channel_access_token';
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join('/tmp', 'todos.json');

const TYPE_EMOJI = { '修繕': '🔧', '打掃': '🧹', '續約': '📝', '退租': '🚪', '提醒': '🔔', '其他': '📌' };
const TYPES = Object.keys(TYPE_EMOJI);
const waitingState = {};

function loadData() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
  return { todos: {}, userIds: [] };
}
function saveData(data) { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data), 'utf8'); } catch (e) {} }
let db = loadData();

function getTodos(userId) {
  if (!db.todos[userId]) db.todos[userId] = [];
  if (!db.userIds.includes(userId)) db.userIds.push(userId);
  saveData(db);
  return db.todos[userId];
}

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

function verifySignature(req) {
  const signature = req.headers['x-line-signature'];
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(req.rawBody).digest('base64');
  return signature === hash;
}

async function replyMessage(replyToken, text, quickReplies) {
  const message = { type: 'text', text };
  if (quickReplies) {
    message.quickReply = { items: quickReplies.map(label => ({ type: 'action', action: { type: 'message', label, text: label } })) };
  }
  await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages: [message] },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
}

async function pushMessage(userId, text) {
  await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages: [{ type: 'text', text }] },
    { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
}

function parseDate(text) {
  const rocMatch = text.match(/^(\d{3})[./](\d{1,2})[./](\d{1,2})/);
  if (rocMatch) return `${parseInt(rocMatch[1])+1911}-${rocMatch[2].padStart(2,'0')}-${rocMatch[3].padStart(2,'0')}`;
  const adMatch = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  if (adMatch) return `${adMatch[1]}-${adMatch[2].padStart(2,'0')}-${adMatch[3].padStart(2,'0')}`;
  return null;
}

function getTodayTW() {
  const tw = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  return `${tw.getUTCFullYear()}-${String(tw.getUTCMonth()+1).padStart(2,'0')}-${String(tw.getUTCDate()).padStart(2,'0')}`;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return ` 📅${parseInt(y)-1911}.${m}.${d}`;
}

function getDailySummary(userId) {
  const todos = getTodos(userId);
  const tw = new Date(new Date().getTime() + 8 * 60 * 60 * 1000);
  const dateStr = tw.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long', timeZone:'Asia/Taipei' });
  if (todos.length === 0) return `📅 ${dateStr}\n\n目前沒有任何待辦事項！\n輸入「+」來新增吧 😊`;
  const pending = todos.filter(t => !t.done);
  const done = todos.filter(t => t.done);
  let msg = `📅 ${dateStr}\n━━━━━━━━━━━━━━\n`;
  if (pending.length > 0) { msg += `\n📌 待完成（${pending.length} 項）\n`; pending.forEach((t,i) => { const e = TYPE_EMOJI[t.type]||'📌'; msg += `  ${i+1}. ${e}${t.type?`[${t.type}]`:''}${formatDateDisplay(t.date)} ${t.text}\n`; }); }
  if (done.length > 0) { msg += `\n✅ 已完成（${done.length} 項）\n`; done.forEach(t => { const e = TYPE_EMOJI[t.type]||'📌'; msg += `  ✓ ${e}${t.type?`[${t.type}]`:''}${formatDateDisplay(t.date)} ${t.text}\n`; }); }
  msg += `\n━━━━━━━━━━━━━━\n完成率：${Math.round((done.length/todos.length)*100)}% 🎯`;
  return msg;
}

function scheduleDailyReminder() {
  function getNextRunMs() {
    const now = new Date();
    const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const next = new Date(Date.UTC(tw.getUTCFullYear(), tw.getUTCMonth(), tw.getUTCDate(), 1, 0, 0, 0));
    if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
    return next - now;
  }
  function run() {
    db = loadData();
    const today = getTodayTW();
    const [y,m,d] = today.split('-');
    const dateDisplay = `${parseInt(y)-1911}.${m}.${d}`;
    db.userIds.forEach(async (userId) => {
      try {
        const todayTodos = (db.todos[userId]||[]).filter(t => !t.done && t.date === today);
        let msg = todayTodos.length === 0
          ? `🌅 早安！\n📅 今天 ${dateDisplay} 沒有待辦事項\n\n輸入「清單」查看所有事項 😊`
          : `🌅 早安！📅 今天 ${dateDisplay} 有 ${todayTodos.length} 件事要做：\n\n` + todayTodos.map((t,i) => `  ${i+1}. ${TYPE_EMOJI[t.type]||'📌'}${t.type?`[${t.type}] `:''}${t.text}`).join('\n') + `\n\n加油！完成後輸入「完成 編號」✅`;
        await pushMessage(userId, msg);
      } catch (e) { console.error('Push error:', e.response?.data || e.message); }
    });
    setTimeout(run, getNextRunMs());
  }
  setTimeout(run, getNextRunMs());
}

const HELP_TEXT = `🤖 待辦機器人使用說明\n━━━━━━━━━━━━━━\n➕ 快捷新增：輸入「+」→ 選類型 → 輸入日期說明\n➕ 直接新增：+ 115.06.20 修繕 新光路漏水\n✅ 完成：完成 編號\n🗑 刪除：刪除 編號\n📋 清單：清單\n🔄 清除完成：清除完成`;

async function handleMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text?.trim() || '';

  if (waitingState[userId]) {
    const { type } = waitingState[userId];
    delete waitingState[userId];
    const date = parseDate(text);
    const taskText = date ? text.replace(/^\d{3,4}[./\-]\d{1,2}[./\-]\d{1,2}\s*/, '').trim() : text.trim();
    if (!taskText) return replyMessage(replyToken, '請輸入說明文字，例：115.07.01 民生路');
    const todos = getTodos(userId);
    todos.push({ id: Date.now(), text: taskText, type, date: date||null, done: false, createdAt: new Date().toISOString() });
    saveData(db);
    const emoji = TYPE_EMOJI[type]||'📌';
    return replyMessage(replyToken, `✅ 已新增：${emoji}[${type}] ${taskText}${date?`\n日期：${formatDateDisplay(date).trim()}`:''}\n\n待完成共 ${todos.filter(t=>!t.done).length} 項`);
  }

  if (text === '+' || text === '＋') {
    return replyMessage(replyToken, '請選擇類型 👇', TYPES.map(t => `${TYPE_EMOJI[t]}${t}`));
  }

  const matchedType = TYPES.find(t => text === `${TYPE_EMOJI[t]}${t}` || text === t);
  if (matchedType) {
    waitingState[userId] = { type: matchedType };
    return replyMessage(replyToken, `${TYPE_EMOJI[matchedType]} 選擇了「${matchedType}」\n\n請輸入日期和說明：\n例：115.07.01 民生路`);
  }

  if (text.startsWith('+') || text.startsWith('＋')) {
    const content = text.replace(/^[+＋]\s*/, '').trim();
    if (!content) return replyMessage(replyToken, '請選擇類型 👇', TYPES.map(t => `${TYPE_EMOJI[t]}${t}`));
    const date = parseDate(content);
    let remaining = date ? content.replace(/^\d{3,4}[./\-]\d{1,2}[./\-]\d{1,2}\s*/, '').trim() : content;
    let detectedType = null;
    for (const t of TYPES) { if (remaining.startsWith(t)) { detectedType = t; remaining = remaining.slice(t.length).trim(); break; } }
    if (!remaining) return replyMessage(replyToken, '請輸入說明文字');
    getTodos(userId).push({ id: Date.now(), text: remaining, type: detectedType||null, date: date||null, done: false, createdAt: new Date().toISOString() });
    saveData(db);
    const emoji = detectedType ? TYPE_EMOJI[detectedType] : '📌';
    return replyMessage(replyToken, `✅ 已新增：${emoji}${detectedType?`[${detectedType}] `:''}${remaining}${date?`\n日期：${formatDateDisplay(date).trim()}`:''}\n\n待完成共 ${getTodos(userId).filter(t=>!t.done).length} 項`);
  }

  const doneMatch = text.match(/^(完成|✓|done)\s*(\d+)$/i);
  if (doneMatch) {
    const idx = parseInt(doneMatch[2]) - 1;
    const pending = getTodos(userId).filter(t => !t.done);
    if (idx < 0 || idx >= pending.length) return replyMessage(replyToken, `❌ 找不到第 ${idx+1} 項`);
    pending[idx].done = true; saveData(db);
    return replyMessage(replyToken, `🎉 完成：${pending[idx].text}`);
  }

  const delMatch = text.match(/^(刪除|delete|del)\s*(\d+)$/i);
  if (delMatch) {
    const idx = parseInt(delMatch[2]) - 1;
    const todos = getTodos(userId);
    const pending = todos.filter(t => !t.done);
    if (idx < 0 || idx >= pending.length) return replyMessage(replyToken, `❌ 找不到第 ${idx+1} 項`);
    const removed = pending[idx];
    todos.splice(todos.indexOf(removed), 1); saveData(db);
    return replyMessage(replyToken, `🗑 已刪除：${removed.text}`);
  }

  if (['清除完成','清除','clear'].includes(text.toLowerCase())) {
    const todos = getTodos(userId); const before = todos.length;
    db.todos[userId] = todos.filter(t=>!t.done); saveData(db);
    return replyMessage(replyToken, `🧹 已清除 ${before-db.todos[userId].length} 項已完成事項`);
  }

  if (['清單','list','待辦','今天','摘要','summary','今日'].includes(text.toLowerCase())) {
    return replyMessage(replyToken, getDailySummary(userId));
  }

  if (['說明','help','?','？'].includes(text.toLowerCase())) {
    return replyMessage(replyToken, HELP_TEXT);
  }

  return replyMessage(replyToken, `👋 輸入「+」快捷新增待辦`, ['➕ 新增', '📋 清單', '❓ 說明']);
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.status(400).send('Invalid signature');
  res.status(200).send('OK');
  for (const event of req.body.events || []) {
    if (event.type === 'message' && event.message.type === 'text') {
      try { await handleMessage(event); } catch (e) { console.error(e.response?.data || e.message); } }
  }
});

app.get('/', (req, res) => res.send('LINE Todo Bot is running! 🤖'));
app.listen(PORT, () => { console.log(`✅ Server running on port ${PORT}`); scheduleDailyReminder(); });
