const express = require('express');
const crypto = require('crypto');
const axios = require('axios');

const app = express();

const CHANNEL_SECRET = process.env.CHANNEL_SECRET || 'your_channel_secret';
const CHANNEL_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN || 'your_channel_access_token';
const PORT = process.env.PORT || 3000;

const userTodos = {};

app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

function verifySignature(req) {
  const signature = req.headers['x-line-signature'];
  const hash = crypto.createHmac('SHA256', CHANNEL_SECRET).update(req.rawBody).digest('base64');
  return signature === hash;
}

async function replyMessage(replyToken, messages) {
  await axios.post('https://api.line.me/v2/bot/message/reply', {
    replyToken,
    messages: Array.isArray(messages) ? messages : [{ type: 'text', text: messages }]
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CHANNEL_ACCESS_TOKEN}` }
  });
}

function getTodos(userId) {
  if (!userTodos[userId]) userTodos[userId] = [];
  return userTodos[userId];
}

function getDailySummary(userId) {
  const todos = getTodos(userId);
  const today = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
  if (todos.length === 0) return `📅 ${today}\n\n目前沒有任何待辦事項！\n輸入「+ 事情」來新增吧 😊`;
  const pending = todos.filter(t => !t.done);
  const done = todos.filter(t => t.done);
  let msg = `📅 ${today}\n━━━━━━━━━━━━━━\n`;
  if (pending.length > 0) { msg += `\n📌 待完成（${pending.length} 項）\n`; pending.forEach((t, i) => { msg += `  ${i + 1}. ${t.text}\n`; }); }
  if (done.length > 0) { msg += `\n✅ 已完成（${done.length} 項）\n`; done.forEach(t => { msg += `  ✓ ${t.text}\n`; }); }
  const pct = Math.round((done.length / todos.length) * 100);
  msg += `\n━━━━━━━━━━━━━━\n完成率：${pct}% 🎯`;
  return msg;
}

const HELP_TEXT = `🤖 待辦機器人使用說明\n━━━━━━━━━━━━━━\n➕ 新增：+ 事情名稱\n✅ 完成：完成 編號\n🗑 刪除：刪除 編號\n📋 清單：清單\n📅 摘要：今天\n🔄 清除已完成：清除完成`;

async function handleMessage(event) {
  const { replyToken, source, message } = event;
  const userId = source.userId;
  const text = message.text?.trim() || '';

  if (text.startsWith('+') || text.startsWith('＋')) {
    const task = text.replace(/^[+＋]\s*/, '').trim();
    if (!task) return replyMessage(replyToken, '請輸入事項內容，例：+ 買早餐');
    const todos = getTodos(userId);
    todos.push({ id: Date.now(), text: task, done: false, createdAt: new Date().toISOString() });
    return replyMessage(replyToken, `✅ 已新增：${task}\n\n目前共 ${todos.filter(t => !t.done).length} 項待完成`);
  }

  const doneMatch = text.match(/^(完成|✓|done)\s*(\d+)$/i);
  if (doneMatch) {
    const idx = parseInt(doneMatch[2]) - 1;
    const pending = getTodos(userId).filter(t => !t.done);
    if (idx < 0 || idx >= pending.length) return replyMessage(replyToken, `❌ 找不到第 ${idx + 1} 項`);
    pending[idx].done = true;
    return replyMessage(replyToken, `🎉 完成：${pending[idx].text}`);
  }

  const deleteMatch = text.match(/^(刪除|delete|del)\s*(\d+)$/i);
  if (deleteMatch) {
    const idx = parseInt(deleteMatch[2]) - 1;
    const todos = getTodos(userId);
    const pending = todos.filter(t => !t.done);
    if (idx < 0 || idx >= pending.length) return replyMessage(replyToken, `❌ 找不到第 ${idx + 1} 項`);
    const removed = pending[idx];
    todos.splice(todos.indexOf(removed), 1);
    return replyMessage(replyToken, `🗑 已刪除：${removed.text}`);
  }

  if (['清除完成', '清除', 'clear'].includes(text.toLowerCase())) {
    const todos = getTodos(userId);
    const before = todos.length;
    userTodos[userId] = todos.filter(t => !t.done);
    return replyMessage(replyToken, `🧹 已清除 ${before - userTodos[userId].length} 項已完成事項`);
  }

  if (['清單', 'list', '待辦', '今天', '摘要', 'summary', '今日'].includes(text.toLowerCase())) {
    return replyMessage(replyToken, getDailySummary(userId));
  }

  if (['說明', 'help', '?', '？'].includes(text.toLowerCase())) {
    return replyMessage(replyToken, HELP_TEXT);
  }

  return replyMessage(replyToken, `👋 你好！輸入「說明」查看使用方法\n輸入「+ 事項」快速新增待辦`);
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.status(400).send('Invalid signature');
  res.status(200).send('OK');
  for (const event of req.body.events || []) {
    if (event.type === 'message' && event.message.type === 'text') {
      try { await handleMessage(event); } catch (err) { console.error(err.response?.data || err.message); }
    }
  }
});

app.get('/', (req, res) => res.send('LINE Todo Bot is running! 🤖'));
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
