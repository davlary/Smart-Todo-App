# Smart Todo App — Backend Scaffold

This repository contains a minimal backend scaffold for the Smart Todo App using Express, SQLite and Socket.IO. It's intended as a starting point to implement the advanced features you requested (task dependencies, recurring tasks, time tracking, collaboration, reminders, AI features, integrations, security, billing/premium, gamification, SEO, etc.).

Files added:
- `server.js` — Express server with API endpoints and Socket.IO hooks.
- `db.js` — SQLite initialization and table creation (stored in `data/app.db`).
- `package.json` — lists runtime dependencies for the scaffold.

Quick setup (Windows PowerShell):

1. Install dependencies

```powershell
cd "c:\Users\pc\Documents\Smart Todo App"
npm install
```

2. Run the server

```powershell
npm start
```

The server will start on port 3000 by default. Open http://localhost:3000/index.html to see the frontend served by the server.

Notes & next steps
- Authentication: the scaffold uses JWTs with a default secret. Replace `JWT_SECRET` in environment variables for production.
- Persistence: SQLite is used for simplicity. For scaling, migrate to Postgres or another managed DB.
- Advanced features: the API and DB include placeholders for task dependencies, recurring rules, reminders, time entries, teams and comments. Implement business logic (scheduling recurring tasks, reminder sending, predictive reminders, AI task suggestion) as next steps.
- Real-time collaboration: Socket.IO is configured and emits events for created/updated tasks and comments; expand rooms and events for presence, typing indicators, and live editing.
- Notifications & Reminders: integrate `node-cron` or a job queue + SMTP/push services to send emails/push notifications.
- Security: add rate limiting, input validation, HTTPS, and two-factor authentication (TOTP) for production.

If you'd like, I can now:
- Wire server endpoints into the frontend (replace the current in-browser data model with API calls).
- Add persistent user sessions and localStorage sync for offline UX.
- Implement reminder delivery via email (nodemailer) and a small cron scheduler.
- Add example client-side code demonstrating WebSocket collaboration.

Tell me which of these you'd like to prioritize and I'll implement the next set of changes.
