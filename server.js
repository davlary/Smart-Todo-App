/*
  Minimal Express + SQLite + Socket.IO scaffold
  - Serves static frontend files from project root
  - Provides basic API endpoints for auth, tasks, teams, comments, time-tracking, reminders
  - WebSocket hooks for real-time collaboration

  This is a scaffold to extend with the features you requested.
*/

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const socketio = require('socket.io');
const db = require('./db');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const speakeasy = require('speakeasy');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'replace-this-with-secure-secret';

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiter for auth and critical endpoints
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
app.use('/api/auth', authLimiter);

// Simple auth helper
function generateToken(user){
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next){
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Missing auth header' });
  const token = header.split(' ')[1];
  try{
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  }catch(e){
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Health
app.get('/api/health', (req,res)=> res.json({ ok:true, ts: Date.now() }));

// Auth routes (register/login) with validation
app.post('/api/auth/register', [ body('email').isEmail(), body('password').isLength({ min:6 }) ], (req,res)=>{
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { email, password, name } = req.body;
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 8);
  const created_at = Date.now();
  db.run('INSERT INTO users (id,email,name,password,created_at) VALUES (?,?,?,?,?)', [id,email,name||'',hashed,created_at], function(err){
    if (err) return res.status(400).json({ error: err.message });
    const token = generateToken({ id, email });
    res.json({ id, email, token });
  });
});

app.post('/api/auth/login', (req,res)=>{
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  db.get('SELECT * FROM users WHERE email = ?', [email], (err, user)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const ok = bcrypt.compareSync(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const token = generateToken(user);
    res.json({ id: user.id, email: user.email, token });
  });
});

// 2FA (TOTP) setup and verify - helper endpoints (NOTE: in prod, persist secret per-user encrypted)
app.post('/api/2fa/setup', authMiddleware, (req,res)=>{
  const secret = speakeasy.generateSecret({ length: 20 });
  // Return base32 and otpauth_url - client should display QR or save secret
  res.json({ base32: secret.base32, otpauth_url: secret.otpauth_url });
});

app.post('/api/2fa/verify', authMiddleware, (req,res)=>{
  const { token, base32 } = req.body;
  if (!token || !base32) return res.status(400).json({ error: 'token and base32 secret required' });
  const verified = speakeasy.totp.verify({ secret: base32, encoding: 'base32', token, window:1 });
  res.json({ verified });
});

// Tasks: CRUD + dependencies enforcement + recurring field handling
app.get('/api/tasks', authMiddleware, (req,res)=>{
  db.all('SELECT * FROM tasks', [], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/tasks', authMiddleware, [ body('title').notEmpty().trim().escape() ], (req,res)=>{
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  const { title, description, priority, due_at, assignee, recurring_rule } = req.body;
  const id = uuidv4();
  const created_at = Date.now();
  db.run('INSERT INTO tasks (id,title,description,priority,due_at,created_by,assignee,recurring_rule,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [id,title||'',description||'',priority||'medium',due_at||null,req.user.id||null,assignee||null,recurring_rule||null,created_at], function(err){
    if (err) return res.status(500).json({ error: err.message });
    const task = { id, title, description, priority, due_at, assignee, recurring_rule, created_at };
    io.emit('task:created', task);
    res.json(task);
  });
});

app.put('/api/tasks/:id', authMiddleware, (req,res)=>{
  const id = req.params.id;
  const { title, description, priority, completed, due_at, assignee, recurring_rule } = req.body;

  // Dependency enforcement: if marking completed=true, ensure all dependencies are complete
  if (completed){
    db.all('SELECT d.depends_on_id FROM dependencies d JOIN tasks t ON d.depends_on_id = t.id WHERE d.task_id = ? AND t.completed = 0', [id], (err, rows)=>{
      if (err) return res.status(500).json({ error: err.message });
      if (rows && rows.length>0) return res.status(400).json({ error: 'Cannot complete task while dependencies are incomplete', missing: rows.map(r=>r.depends_on_id) });
      // proceed to update
      doTaskUpdate();
    });
  } else doTaskUpdate();

  function doTaskUpdate(){
    db.run('UPDATE tasks SET title=?,description=?,priority=?,completed=?,due_at=?,assignee=?,recurring_rule=? WHERE id=?', [title,description,priority,completed?1:0,due_at,assignee,recurring_rule,id], function(err){
      if (err) return res.status(500).json({ error: err.message });
      // If task was completed and has a recurring_rule, create next instance
      if (completed && recurring_rule){
        // simplistic recurrence: 'daily' | 'weekly' | 'monthly'
        db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, taskRow)=>{
          if (!err && taskRow){
            const currentDue = taskRow.due_at ? new Date(taskRow.due_at) : new Date();
            let nextDue = new Date(currentDue);
            if (recurring_rule === 'daily') nextDue.setDate(nextDue.getDate() + 1);
            else if (recurring_rule === 'weekly') nextDue.setDate(nextDue.getDate() + 7);
            else if (recurring_rule === 'monthly') nextDue.setMonth(nextDue.getMonth() + 1);
            const newId = uuidv4();
            db.run('INSERT INTO tasks (id,title,description,priority,due_at,created_by,assignee,recurring_rule,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [newId,taskRow.title,taskRow.description,taskRow.priority,nextDue.toISOString(),taskRow.created_by,taskRow.assignee,taskRow.recurring_rule,Date.now()], function(err){
              if (!err) io.emit('task:created', { id:newId, title:taskRow.title, due_at: nextDue.toISOString(), recurring_rule: taskRow.recurring_rule });
            });
          }
        });
      }

      io.emit('task:updated', { id, ...req.body });
      res.json({ id, ...req.body });
    });
  }
});

app.delete('/api/tasks/:id', authMiddleware, (req,res)=>{
  const id = req.params.id;
  db.run('DELETE FROM tasks WHERE id=?', [id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    io.emit('task:deleted', { id });
    res.json({ ok:true });
  });
});

// Comments
app.post('/api/tasks/:id/comments', authMiddleware, (req,res)=>{
  const id = uuidv4();
  const task_id = req.params.id;
  const { content } = req.body;
  const created_at = Date.now();
  db.run('INSERT INTO comments (id,task_id,user_id,content,created_at) VALUES (?,?,?,?,?)', [id,task_id,req.user.id,content,created_at], function(err){
    if (err) return res.status(500).json({ error: err.message });
    const comment = { id, task_id, user_id: req.user.id, content, created_at };
    io.to(`task:${task_id}`).emit('comment:created', comment);
    res.json(comment);
  });
});

// Time tracking start/stop
app.post('/api/tasks/:id/time/start', authMiddleware, (req,res)=>{
  const id = uuidv4();
  const task_id = req.params.id;
  const started_at = Date.now();
  db.run('INSERT INTO time_entries (id,task_id,user_id,started_at) VALUES (?,?,?,?)', [id,task_id,req.user.id,started_at], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, task_id, user_id: req.user.id, started_at });
  });
});

app.post('/api/time/:entryId/stop', authMiddleware, (req,res)=>{
  const entryId = req.params.entryId;
  const stopped_at = Date.now();
  db.get('SELECT * FROM time_entries WHERE id = ?', [entryId], (err, row)=>{
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'entry not found' });
    const duration = Math.max(0, Math.floor((stopped_at - row.started_at)/1000));
    db.run('UPDATE time_entries SET stopped_at=?,duration=? WHERE id=?', [stopped_at,duration,entryId], function(err){
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: entryId, stopped_at, duration });
    });
  });
});

// Reminders (create/snooze)
app.post('/api/reminders', authMiddleware, (req,res)=>{
  const id = uuidv4();
  const { task_id, remind_at } = req.body;
  db.run('INSERT INTO reminders (id,task_id,user_id,remind_at, sent) VALUES (?,?,?,?,?)', [id,task_id,req.user.id,remind_at||null,0], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, task_id, remind_at });
  });
});

app.post('/api/reminders/:id/snooze', authMiddleware, (req,res)=>{
  const id = req.params.id;
  const { snoozed_until } = req.body;
  db.run('UPDATE reminders SET snoozed_until=? WHERE id=?', [snoozed_until, id], function(err){
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id, snoozed_until });
  });
});

// Sync endpoint - accept client queued ops and apply server-side
app.post('/api/sync', authMiddleware, (req,res)=>{
  const ops = Array.isArray(req.body.ops) ? req.body.ops : [];
  const results = [];
  // simple sequential processing
  (async ()=>{
    for (const op of ops){
      if (op.type === 'task'){
        if (op.action === 'create'){
          const t = op.payload; const id = t.id || uuidv4();
          try{
            await new Promise((resolve,reject)=>{
              db.run('INSERT OR REPLACE INTO tasks (id,title,description,priority,due_at,created_by,assignee,recurring_rule,created_at,completed) VALUES (?,?,?,?,?,?,?,?,?,?)', [id,t.title||'',t.description||'',t.priority||'medium',t.due_at||null,req.user.id, t.assignee||null, t.recurring_rule||null, Date.now(), t.completed?1:0], function(err){ if (err) reject(err); else resolve(); });
            });
            results.push({ ok:true, id });
          }catch(e){ results.push({ ok:false, error: e.message }); }
        } else if (op.action === 'update'){
          const t = op.payload;
          try{
            await new Promise((resolve,reject)=>{ db.run('UPDATE tasks SET title=?,description=?,priority=?,due_at=?,assignee=?,recurring_rule=?,completed=? WHERE id=?', [t.title,t.description,t.priority,t.due_at,t.assignee,t.recurring_rule,t.completed?1:0,t.id], function(err){ if (err) reject(err); else resolve(); }); });
            results.push({ ok:true, id: t.id });
          }catch(e){ results.push({ ok:false, error: e.message }); }
        }
      }
    }
    res.json({ results });
  })();
});

// AI placeholder endpoints
app.post('/api/ai/suggest', authMiddleware, (req,res)=>{
  const tasks = req.body.tasks || [];
  // simple heuristic: promote tasks with 'due' or 'urgent' in text
  const suggestions = tasks.map(t=>({ id: t.id, suggestion: t.text.toLowerCase().includes('urgent') ? 'Do this now' : 'Schedule this', priorityBoost: t.text.toLowerCase().includes('urgent') ? 1 : 0 }));
  res.json({ suggestions });
});

// Reports
app.get('/api/reports/productivity', authMiddleware, (req,res)=>{
  db.all('SELECT user_id, SUM(duration) as total_seconds FROM time_entries GROUP BY user_id', [], (err, rows)=>{
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Email transporter (nodemailer) - reads SMTP config from env
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: process.env.SMTP_SECURE === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
});

// Reminder scheduler: every minute, find reminders that should fire
cron.schedule('* * * * *', ()=>{
  const now = Date.now();
  db.all('SELECT r.*, u.email as user_email, t.title as task_title FROM reminders r LEFT JOIN users u ON r.user_id = u.id LEFT JOIN tasks t ON r.task_id = t.id WHERE r.sent = 0 AND r.remind_at IS NOT NULL AND r.remind_at <= ?', [now], (err, rows)=>{
    if (err) return console.error('Reminder query error', err.message);
    rows.forEach(rem =>{
      // skip if snoozed
      if (rem.snoozed_until && rem.snoozed_until > now) return;
      // attempt send email
      const to = rem.user_email;
      if (!to) return console.warn('No email for reminder', rem.id);
      const mail = {
        from: process.env.FROM_EMAIL || 'no-reply@example.com',
        to,
        subject: `Reminder: ${rem.task_title || 'Task'}`,
        text: `Reminder for task: ${rem.task_title || ''} - scheduled at ${new Date(rem.remind_at).toLocaleString()}`
      };
      transporter.sendMail(mail, (err, info)=>{
        if (err){
          console.error('Failed to send reminder', err.message);
        } else {
          db.run('UPDATE reminders SET sent = 1 WHERE id = ?', [rem.id], (err)=>{ if (err) console.error('Failed to mark reminder sent', err.message); });
          io.to(`user:${rem.user_id}`).emit('reminder:sent', { id: rem.id, task_id: rem.task_id });
        }
      });
    });
  });
});

// Websocket real-time collaboration
io.on('connection', socket => {
  console.log('ws: connected', socket.id);
  socket.on('join:task', ({ taskId }) => {
    socket.join(`task:${taskId}`);
  });
  socket.on('join:user', ({ userId }) => {
    socket.join(`user:${userId}`);
  });
  socket.on('comment:create', (comment) => {
    // broadcast to task room
    io.to(`task:${comment.task_id}`).emit('comment:created', comment);
  });
  socket.on('disconnect', ()=>{
    console.log('ws: disconnected', socket.id);
  });
});

server.listen(PORT, ()=>{
  console.log(`Server running on http://localhost:${PORT}`);
});
