(function(){
// Lightweight helpers
const $ = id => document.getElementById(id);
const qsa = sel => Array.from(document.querySelectorAll(sel));

// Local storage helpers
const saveToStorage = (key, value) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.warn('Failed to save to local storage:', e);
    }
};

const loadFromStorage = (key, defaultValue = []) => {
    try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : defaultValue;
    } catch (e) {
        console.warn('Failed to load from local storage:', e);
        return defaultValue;
    }
};

// App state (single source of truth) with persistence
window.todos = loadFromStorage('todos', []);
window.goals = loadFromStorage('goals', []);
window.journalEntries = loadFromStorage('journal', []);
// Habits state: array of habit objects
// habit: { id, name, frequency: 'daily'|'weekly', reminderTime: 'HH:MM'|null, why: string|null, history: { 'YYYY-MM-DD': true } }
window.habits = loadFromStorage('habits', []);

let timer = null;
let timerSeconds = 25 * 60; // seconds
let focusTimer = null;
let focusTimerSeconds = 25 * 60;
let isTimerRunning = false;
let isFocusTimerRunning = false;
let completedPomodoros = 0;
let currentSession = 1;
let dailyFocusTime = 0; // in minutes

// Cache common DOM nodes after DOMContentLoaded
const DOM = {};

function cacheDOM(){
    DOM.views = qsa('.view');
    DOM.navBtns = qsa('.nav-btn');
    DOM.oneThingText = $('one-thing-text');
    DOM.completedTasks = $('completed-tasks');
    DOM.totalTasks = $('total-tasks');
    DOM.progressBar = $('progress-bar');
    DOM.timerDisplay = $('timer-display');
    DOM.focusTimer = $('focus-timer');
    DOM.completedPomodoros = $('completed-pomodoros');
    DOM.currentSession = $('current-session');
    DOM.dailyFocusTime = $('daily-focus-time');
}

// Mobile sidebar toggle (off-canvas behavior)
window.toggleSidebar = function(force){
    const isOpen = document.body.classList.contains('mobile-open');
    const shouldOpen = typeof force === 'boolean' ? force : !isOpen;
    // Ensure overlay element exists
    let overlay = $('mobile-overlay');
    if (!overlay){
        overlay = document.createElement('div');
        overlay.id = 'mobile-overlay';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', ()=> window.toggleSidebar(false));
    }

    if (shouldOpen){
        // rely on CSS for transition (body.mobile-open toggles transform/opactiy)
        document.body.classList.add('mobile-open');
        // ensure focus is managed
        try{ overlay.setAttribute('tabindex','-1'); overlay.focus(); }catch(e){}
    } else {
        document.body.classList.remove('mobile-open');
    }
};

// Accept either showView('name') or showView(event,'name')
function showView(a,b){
    const isStringCall = typeof a === 'string';
    const viewName = isStringCall ? a : b;
    const ev = isStringCall ? null : a;

    // Hide all
    DOM.views.forEach(v => v.classList.add('hidden'));

    // Show view
    const el = $(viewName + '-view');
    if (el) el.classList.remove('hidden');

    // update nav active state
    DOM.navBtns.forEach(btn => btn.classList.remove('bg-primary','text-white'));
    if (ev && ev.currentTarget) {
        ev.currentTarget.classList.add('bg-primary','text-white');
    } else {
        // If no event provided, try to highlight based on viewName
        const match = DOM.navBtns.find(n => n.outerHTML.includes(viewName));
        if (match) match.classList.add('bg-primary','text-white');
    }

    if (viewName === 'dashboard') updateDashboard();
}

// Expose showView to global scope for inline handlers
window.showView = showView;

// Utils
function formatTime(seconds){
    const mins = Math.floor(seconds/60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
}

// Todo functions (kept global names)
window.addTodo = function(){
    const input = $('new-todo');
    const priority = $('todo-priority').value;
    const text = input.value.trim();
    if (!text) return;
    const todo = { id: Date.now(), text, priority, completed: false, createdAt: new Date() };
    window.todos.push(todo);
    saveToStorage('todos', window.todos);
    input.value = '';
    renderTodos();
    updateDashboard();
};

window.toggleTodo = function(id){
    const todo = window.todos.find(t=>t.id===id);
    if (!todo) return;
    todo.completed = !todo.completed;
    saveToStorage('todos', window.todos);
    renderTodos();
    updateDashboard();
};

window.deleteTodo = function(id){
    showConfirmDialog('Are you sure you want to delete this task?', ()=>{
        window.todos = window.todos.filter(t=>t.id!==id);
        saveToStorage('todos', window.todos);
        renderTodos();
        updateDashboard();
    });
};

function escapeHtml(s){ return String(s).replace(/[&<>\"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]||c); }

function renderTodos(){
    const priorities = ['high','medium','low'];
    for (const priority of priorities){
        const container = $(priority + '-priority-todos');
        if (!container) continue;
        const list = window.todos.filter(t=>t.priority===priority);
        container.innerHTML = list.map(todo=>{
            const checked = todo.completed ? 'checked' : '';
            const opacity = todo.completed ? 'opacity-60' : '';
            const line = todo.completed ? 'line-through text-gray-500' : '';
            // use template with escaped content
            return `\n<div class="todo-item bg-white dark:bg-gray-800 p-3 rounded-lg border ${opacity} animate-fade-in">\n  <div class="flex items-center space-x-3">\n    <input type="checkbox" ${checked} onchange="toggleTodo(${todo.id})" class="w-4 h-4 text-primary rounded focus:ring-primary">\n    <span class="${line} flex-1 text-sm">${escapeHtml(todo.text)}</span>\n    <button onclick="deleteTodo(${todo.id})" class="text-red-500 hover:text-red-700 text-sm">\n      <i class=\"fas fa-trash\"></i>\n    </button>\n  </div>\n</div>`;
        }).join('');
    }
}

// AI Feedback kept as-is but uses fewer DOM lookups
window.getAIFeedback = function(){
    const section = $('ai-feedback-section');
    const content = $('ai-feedback-content');
    section.classList.remove('hidden');
    content.innerHTML = `<div class="flex items-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Analyzing your progress...</div>`;

    const completedTasks = window.todos.filter(t=>t.completed);
    const pendingTasks = window.todos.filter(t=>!t.completed);
    const highPriorityPending = pendingTasks.filter(t=>t.priority==='high');

    const promptText = `@Claude-Sonnet-4 As a productivity coach expert in Getting Things Done, The One Thing, and Deep Work methodologies, analyze my current task list and provide actionable feedback:\n\nCOMPLETED TASKS (${completedTasks.length}):\n${completedTasks.map(t=>`- ${t.text} (${t.priority} priority)`).join('\n')||'None'}\n\nPENDING TASKS (${pendingTasks.length}):\n${pendingTasks.map(t=>`- ${t.text} (${t.priority} priority)`).join('\n')||'None'}\n\nHIGH PRIORITY PENDING: ${highPriorityPending.length}\n\nPlease provide:\n1. Assessment of my current task prioritization\n2. Suggestions for applying "The One Thing" principle\n3. Recommendations for task organization using GTD methodology\n4. Tips for maintaining deep work focus\n5. Specific actions I should take next\n\nProvide ONLY structured markdown response with actionable insights.`;

    if (window.Poe && window.Poe.registerHandler){
        window.Poe.registerHandler('feedback-handler', (result)=>{
            const msg = result.responses && result.responses[0];
            if (!msg) return;
            if (msg.status === 'error') content.innerHTML = `<p class="text-red-500">Error generating feedback: ${msg.statusText}</p>`;
            else if (msg.status === 'complete' || msg.status === 'incomplete') content.innerHTML = marked.parse(msg.content);
        });

        window.Poe.sendUserMessage(promptText, { handler: 'feedback-handler', stream:true, openChat:false }).catch(err=>{
            content.innerHTML = `<p class="text-red-500">Error: ${err.message}</p>`;
        });
    } else {
        // If Poe not available, show local summary
        content.innerHTML = `<div class="markdown-content"><p>No AI endpoint available — incomplete data preview:</p><pre>${escapeHtml(promptText)}</pre></div>`;
    }
};

// Goals / roadmap functions kept with minimal changes
window.createGoalRoadmap = function(){
    const title = $('goal-title').value.trim();
    const description = $('goal-description').value.trim();
    const timeframe = $('goal-timeframe').value;
    if (!title || !description){ showAlert('Please fill in both goal title and description'); return; }
    const goal = { id: Date.now(), title, description, timeframe, createdAt: new Date(), roadmap: null };
    window.goals.push(goal);
    saveToStorage('goals', window.goals);
    $('goal-title').value = ''; $('goal-description').value = '';
    $('roadmap-generation').classList.remove('hidden');
    generateRoadmap(goal);
    renderGoals();
};

function generateRoadmap(goal){
    const promptText = `@Claude-Sonnet-4 As an expert in productivity methodologies (Getting Things Done, The One Thing, Deep Work), create a detailed roadmap for this goal:\n\nGOAL: ${goal.title}\nDESCRIPTION: ${goal.description}\nTIMEFRAME: ${goal.timeframe}\n\nCreate a structured roadmap that includes:\n1. Break down into specific milestones\n2. Weekly/monthly action steps\n3. Key performance indicators\n4. Potential obstacles and solutions\n5. Daily habits to support this goal\n6. Deep work sessions needed\n7. Resource requirements\n\nApply GTD principles for organizing actions and The One Thing principle for prioritization. Format as clear, actionable markdown.`;

    if (window.Poe && window.Poe.registerHandler){
        window.Poe.registerHandler('roadmap-handler', (result)=>{
            const msg = result.responses && result.responses[0];
            if (!msg) return;
            if (msg.status === 'error') goal.roadmap = `Error generating roadmap: ${msg.statusText}`;
            else goal.roadmap = msg.content || msg.statusText;
            saveToStorage('goals', window.goals);
            $('roadmap-generation').classList.add('hidden');
            renderGoals();
        });

        window.Poe.sendUserMessage(promptText, { handler: 'roadmap-handler', stream:true, openChat:false }).catch(err=>{
            goal.roadmap = `Error: ${err.message}`;
            $('roadmap-generation').classList.add('hidden');
            renderGoals();
        });
    } else {
        goal.roadmap = 'AI endpoint not available locally — enable Poe integration to generate roadmaps.';
        $('roadmap-generation').classList.add('hidden');
        renderGoals();
    }
}

window.renderGoals = function(){
    const container = $('goals-list');
    container.innerHTML = window.goals.map(goal=>{
        const roadmap = goal.roadmap ? marked.parse(goal.roadmap) : '<div class="flex items-center text-gray-500"><i class="fas fa-spinner fa-spin mr-2"></i>Generating roadmap...</div>';
        return `\n<div class="bg-card-light dark:bg-card-dark rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 animate-slide-up">\n  <div class="flex justify-between items-start mb-4">\n    <div>\n      <h3 class="text-xl font-semibold">${escapeHtml(goal.title)}</h3>\n      <p class="text-gray-600 dark:text-gray-400 text-sm">Target: ${escapeHtml(goal.timeframe)}</p>\n    </div>\n    <button onclick="deleteGoal(${goal.id})" class="text-red-500 hover:text-red-700">\n      <i class=\"fas fa-trash\"></i>\n    </button>\n  </div>\n  <p class="text-gray-700 dark:text-gray-300 mb-4">${escapeHtml(goal.description)}</p>\n  <div class="border-t border-gray-200 dark:border-gray-700 pt-4">\n    <h4 class="font-semibold mb-2 flex items-center">\n      <i class=\"fas fa-route text-primary mr-2\"></i>\n      AI Roadmap\n    </h4>\n    <div class="markdown-content">${roadmap}</div>\n  </div>\n</div>`;
    }).join('');
};

window.deleteGoal = function(id){
    showConfirmDialog('Are you sure you want to delete this goal?', ()=>{
        window.goals = window.goals.filter(g=>g.id!==id);
        saveToStorage('goals', window.goals);
        renderGoals();
    });
};

// Timer functions
window.startTimer = function(){
    if (isTimerRunning) return;
    isTimerRunning = true;
    timer = setInterval(()=>{
        timerSeconds--;
        if (DOM.timerDisplay) DOM.timerDisplay.textContent = formatTime(timerSeconds);
        if (timerSeconds <= 0){
            window.pauseTimer();
            showAlert('Pomodoro completed! Take a break.');
            timerSeconds = 25*60;
            if (DOM.timerDisplay) DOM.timerDisplay.textContent = formatTime(timerSeconds);
        }
    },1000);
};

window.pauseTimer = function(){
    isTimerRunning = false;
    if (timer){ clearInterval(timer); timer = null; }
};

window.resetTimer = function(){ window.pauseTimer(); timerSeconds = 25*60; if (DOM.timerDisplay) DOM.timerDisplay.textContent = formatTime(timerSeconds); };

// Focus timer
window.startFocusTimer = function(){
    if (isFocusTimerRunning) return;
    isFocusTimerRunning = true;
    focusTimer = setInterval(()=>{
        focusTimerSeconds--;
        if (DOM.focusTimer) DOM.focusTimer.textContent = formatTime(focusTimerSeconds);
        if (focusTimerSeconds <= 0){
            window.pauseFocusTimer();
            completedPomodoros++;
            dailyFocusTime += 25; // minutes
            updateFocusStats();
            showAlert('Deep work session completed! Great job!');
            focusTimerSeconds = 25*60;
            if (DOM.focusTimer) DOM.focusTimer.textContent = formatTime(focusTimerSeconds);
        }
    },1000);
};

window.pauseFocusTimer = function(){ isFocusTimerRunning = false; if (focusTimer){ clearInterval(focusTimer); focusTimer = null; } };
window.resetFocusTimer = function(){ window.pauseFocusTimer(); focusTimerSeconds = 25*60; if (DOM.focusTimer) DOM.focusTimer.textContent = formatTime(focusTimerSeconds); };

function updateFocusStats(){ if (DOM.completedPomodoros) DOM.completedPomodoros.textContent = completedPomodoros; if (DOM.currentSession) DOM.currentSession.textContent = currentSession; if (DOM.dailyFocusTime){ const h = Math.floor(dailyFocusTime/60); const m = dailyFocusTime%60; DOM.dailyFocusTime.textContent = `${h}h ${m}m`; } }
window.updateFocusStats = updateFocusStats;

window.selectFocusTask = function(){ const available = window.todos.filter(t=>!t.completed); if (!available.length){ showAlert('No pending tasks available. Add some tasks first!'); return; } const high = available.find(t=>t.priority==='high'); const selected = high || available[0]; const el = $('current-focus-task'); if (el) el.textContent = selected.text; };

// Journal functions
window.saveJournalEntry = function(){
    const entryText = $('journal-entry').value.trim();
    const energyLevel = $('energy-level').value;
    const focusQuality = $('focus-quality').value;
    if (!entryText){ showAlert('Please write your journal entry first'); return; }
    const entry = { id: Date.now(), text: entryText, energyLevel: parseInt(energyLevel,10), focusQuality: parseInt(focusQuality,10), date: new Date(), completedTasks: window.todos.filter(t=>t.completed).length, totalTasks: window.todos.length };
    window.journalEntries.unshift(entry);
    saveToStorage('journal', window.journalEntries);
    $('journal-entry').value = ''; $('energy-level').value = '3'; $('focus-quality').value = '3';
    renderJournalEntries(); showAlert('Journal entry saved successfully!');
};

window.renderJournalEntries = function(){
    const container = $('journal-entries');
    if (!container) return;
    
    const getEnergyEmoji = level => {
        const emojis = ['😫', '😴', '😐', '😊', '⚡️'];
        return emojis[level-1] || '😐';
    };
    
    const getFocusEmoji = level => {
        const emojis = ['🌪', '😅', '😐', '👍', '🎯'];
        return emojis[level-1] || '😐';
    };
    
    container.innerHTML = window.journalEntries.map(entry => `
        <div class="journal-entry animate-fade-in">
            <div class="journal-meta">
                <div class="flex-1">
                    <div class="text-lg font-semibold mb-2">${entry.date.toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}</div>
                    <div class="flex space-x-6">
                        <span><i class="fas fa-battery-three-quarters mr-2"></i>Energy: ${getEnergyEmoji(entry.energyLevel)} ${entry.energyLevel}/5</span>
                        <span><i class="fas fa-bullseye mr-2"></i>Focus: ${getFocusEmoji(entry.focusQuality)} ${entry.focusQuality}/5</span>
                        <span><i class="fas fa-tasks mr-2"></i>Tasks: ${entry.completedTasks}/${entry.totalTasks}</span>
                    </div>
                </div>
                <button onclick="deleteJournalEntry(${entry.id})" 
                    class="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
            <div class="journal-content">${escapeHtml(entry.text)}</div>
        </div>
    `).join('');
};

window.deleteJournalEntry = function(id){ showConfirmDialog('Are you sure you want to delete this journal entry?', ()=>{ window.journalEntries = window.journalEntries.filter(e=>e.id!==id); saveToStorage('journal', window.journalEntries); renderJournalEntries(); }); };

window.loadJournalEntries = function(){ renderJournalEntries(); };

window.getJournalInsights = function(){ if (!window.journalEntries.length){ showAlert('Please add some journal entries first to get AI insights'); return; } const section = $('journal-insights-section'); const content = $('journal-insights-content'); section.classList.remove('hidden'); content.innerHTML = `<div class=\"flex items-center text-gray-500\"><i class=\"fas fa-spinner fa-spin mr-2\"></i>Analyzing your journal patterns...</div>`; const recent = window.journalEntries.slice(0,10); const entryData = recent.map(e=>`Date: ${e.date.toLocaleDateString()}, Energy: ${e.energyLevel}/5, Focus: ${e.focusQuality}/5, Completion: ${e.completedTasks}/${e.totalTasks}, Entry: "${e.text}"`).join('\n'); const promptText = `@Claude-Sonnet-4 As a productivity coach, analyze these journal entries and provide insights:\n\nRECENT JOURNAL ENTRIES:\n${entryData}\n\nPlease analyze patterns and provide:\n1. Energy and focus patterns over time\n2. Correlation between completion rates and mood/energy\n3. Productivity trends and insights\n4. Personalized recommendations for improvement\n5. Suggestions for optimizing daily routines\n6. Areas where GTD, The One Thing, or Deep Work principles could help\n\nProvide ONLY structured markdown with actionable insights and patterns you notice.`;

    if (window.Poe && window.Poe.registerHandler){
        window.Poe.registerHandler('journal-insights-handler', (result)=>{
            const msg = result.responses && result.responses[0];
            if (!msg) return;
            if (msg.status === 'error') content.innerHTML = `<p class="text-red-500">Error generating insights: ${msg.statusText}</p>`;
            else if (msg.status === 'complete' || msg.status === 'incomplete') content.innerHTML = marked.parse(msg.content);
        });
        window.Poe.sendUserMessage(promptText, { handler:'journal-insights-handler', stream:true, openChat:false }).catch(err=>{ content.innerHTML = `<p class=\"text-red-500\">Error: ${err.message}</p>`; });
    } else {
        content.innerHTML = `<div class=\"markdown-content\"><p>No AI endpoint available — show recent entries:</p><pre>${escapeHtml(entryData)}</pre></div>`;
    }
};

// Dashboard / insights
window.updateDashboard = function(){ const completed = window.todos.filter(t=>t.completed).length; const total = window.todos.length; const percentage = total>0? (completed/total)*100 : 0; if (DOM.completedTasks) DOM.completedTasks.textContent = completed; if (DOM.totalTasks) DOM.totalTasks.textContent = total; if (DOM.progressBar) DOM.progressBar.style.width = percentage + '%'; if (window.todos.length>0 || window.goals.length>0) updateAIInsights(); };

window.updateAIInsights = function(){ const insights = $('ai-insights'); if (!insights) return; const completedToday = window.todos.filter(t=>t.completed).length; const highPriorityPending = window.todos.filter(t=>!t.completed && t.priority==='high').length; let insightText = ''; if (completedToday===0 && window.todos.length>0) insightText = '🎯 **Ready to start?** Choose your ONE thing for today and begin with your highest priority task.'; else if (highPriorityPending>0) insightText = `⚡ **Focus Alert:** You have ${highPriorityPending} high-priority task${highPriorityPending>1?'s':''} pending. Apply "The One Thing" principle and tackle the most important one first.`; else if (completedToday>0) insightText = `🚀 **Great progress!** You've completed ${completedToday} task${completedToday>1?'s':''} today. Remember to take breaks and maintain deep work sessions.`; if (window.goals.length===0) insightText += '\n\n💡 **Tip:** Set some long-term goals to create AI-powered roadmaps for success.'; insights.innerHTML = marked.parse(insightText); };

window.setOneThing = function(){ const high = window.todos.filter(t=>!t.completed && t.priority==='high'); if (!high.length){ showAlert('Add some high-priority tasks first to set your ONE thing'); return; } const task = high[0]; if (DOM.oneThingText) DOM.oneThingText.textContent = task.text; showAlert('ONE thing set! Focus on this task first.'); };

// UI helpers: modals
window.showAlert = function(message){ const modal = document.createElement('div'); modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'; modal.innerHTML = `<div class=\"bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-sm w-full mx-4\"><div class=\"flex items-center mb-4\"><i class=\"fas fa-info-circle text-primary mr-3\"></i><h3 class=\"font-semibold\">Information</h3></div><p class=\"text-gray-700 dark:text-gray-300 mb-4\">${message}</p><div class=\"flex justify-end\"><button class=\"px-4 py-2 bg-primary text-white hover:bg-primary-dark rounded transition-colors\" onclick=\"this.closest('.fixed').remove()\">OK</button></div></div>`; document.body.appendChild(modal); };

window.showConfirmDialog = function(message, onConfirm){ const modal = document.createElement('div'); modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'; modal.innerHTML = `<div class=\"bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-sm w-full mx-4\"><div class=\"flex items-center mb-4\"><i class=\"fas fa-question-circle text-yellow-500 mr-3\"></i><h3 class=\"font-semibold\">Confirm Action</h3></div><p class=\"text-gray-700 dark:text-gray-300 mb-4\">${message}</p><div class=\"flex justify-end space-x-3\"><button class=\"px-4 py-2 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors\" onclick=\"this.closest('.fixed').remove()\">Cancel</button><button class=\"px-4 py-2 bg-red-500 text-white hover:bg-red-600 rounded transition-colors\" onclick=\"this.closest('.fixed').remove(); (${onConfirm})()\">Confirm</button></div></div>`; document.body.appendChild(modal); };

// Clear all app data (todos, goals, journal) with confirmation
window.clearAllData = function(){
    showConfirmDialog('This will permanently remove all todos, goals, and journal entries from this browser. Are you sure?', ()=>{
        // reset in-memory state
        window.todos = [];
        window.goals = [];
        window.journalEntries = [];

        // remove only the app keys from localStorage
        try{
            localStorage.removeItem('todos');
            localStorage.removeItem('goals');
            localStorage.removeItem('journal');
        }catch(e){ console.warn('Failed clearing localStorage keys', e); }

        // re-render UI
        try{ renderTodos(); }catch(e){}
        try{ renderGoals(); }catch(e){}
        try{ renderJournalEntries(); }catch(e){}
        try{ updateDashboard(); }catch(e){}

        // Small feedback
        showAlert('All app data has been cleared from this browser.');
    });
};

// --- Habits feature ---
function getDateKey(date = new Date()){ const y = date.getFullYear(); const m = String(date.getMonth()+1).padStart(2,'0'); const d = String(date.getDate()).padStart(2,'0'); return `${y}-${m}-${d}`; }
function getWeekKey(date = new Date()){ // Year-week like YYYY-W##
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(),0,1));
    const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1)/7);
    return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

// compute streak: for daily, consecutive days; for weekly, consecutive weeks where at least one day in week is checked
function computeStreak(habit){
    const today = new Date();
    let count = 0;
    if (habit.frequency === 'daily'){
        let cursor = new Date();
        while (true){
            const key = getDateKey(cursor);
            if (habit.history && habit.history[key]){ count++; cursor.setDate(cursor.getDate() - 1); } else break;
        }
    } else { // weekly
        let cursor = new Date();
        while (true){
            const key = getWeekKey(cursor);
            // Check any date in that week - we stored by dates, so search history for any date with same week key
            const found = Object.keys(habit.history||{}).some(d=> getWeekKey(new Date(d)) === key && habit.history[d]);
            if (found){ count++; cursor.setDate(cursor.getDate() - 7); } else break;
        }
    }
    return count;
}

window.addHabit = function(){
    const name = $('habit-name').value.trim();
    const frequency = $('habit-frequency').value;
    const reminder = $('habit-reminder').value || null;
    const why = $('habit-why').value.trim() || null;
    if (!name) { showToast('Please provide a habit name', 'warn', 3200); return; }

    // support editing when data attribute set on save button
    const editingId = window._editingHabitId || null;
    if (editingId){
        const h = window.habits.find(x=>x.id===editingId);
        if (!h) return;
        h.name = name; h.frequency = frequency; h.reminderTime = reminder; h.why = why;
        saveToStorage('habits', window.habits);
        window._editingHabitId = null;
        $('habit-save-btn').textContent = 'Save Habit';
        $('habit-name').value=''; $('habit-frequency').value='daily'; $('habit-reminder').value=''; $('habit-why').value='';
    renderHabits(); showToast('Habit updated', 'success', 2600);
        return;
    }

    const habit = { id: Date.now(), name, frequency, reminderTime: reminder, why, history: {} };
    window.habits.push(habit);
    saveToStorage('habits', window.habits);
    $('habit-name').value=''; $('habit-frequency').value='daily'; $('habit-reminder').value=''; $('habit-why').value='';
    renderHabits(); showToast('Habit added', 'success', 2600);
};

window.deleteHabit = function(id){
    showConfirmDialog('Delete this habit?', ()=>{
        window.habits = window.habits.filter(h=>h.id!==id);
        saveToStorage('habits', window.habits);
        renderHabits();
    });
};

window.editHabit = function(id){
    const h = window.habits.find(x=>x.id===id);
    if (!h) return;
    $('habit-name').value = h.name;
    $('habit-frequency').value = h.frequency;
    $('habit-reminder').value = h.reminderTime || '';
    $('habit-why').value = h.why || '';
    window._editingHabitId = id;
    $('habit-save-btn').textContent = 'Save Changes';
    // scroll into view
    const el = $('habit-save-btn'); if (el) el.scrollIntoView({behavior:'smooth', block:'center'});
};

window.toggleHabit = function(id){
    const h = window.habits.find(x=>x.id===id); if(!h) return;
    const key = getDateKey(new Date());
    const was = !!h.history[key];
    h.history[key] = !was;
    saveToStorage('habits', window.habits);
    renderHabits();

    // feedback: check streak and congratulate when thresholds crossed
    const streak = computeStreak(h);
    if (!was && streak>0 && [3,5,7,14].includes(streak)){
        showToast(`🔥 ${streak}-day streak for "${h.name}" — keep it up!`, 'success', 4500);
    } else if (!was){
        // small micro moment
        showToast('👏 You did it!', 'success', 2200);
    }
};

function renderHabits(){
    const container = $('habits-list'); if (!container) return;
    if (!window.habits.length){ container.innerHTML = `<div class="text-gray-600 dark:text-gray-400">No habits yet. Add one above to get started.</div>`; return; }
    container.innerHTML = window.habits.map(h=>{
        const todayKey = getDateKey(new Date());
        const doneToday = !!(h.history && h.history[todayKey]);
        const streak = computeStreak(h);
        const streakBadge = streak>0 ? `<span class="text-sm font-semibold text-primary">🔥 ${streak}</span>` : '';
        const whyLine = h.why ? `<div class="text-sm text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(h.why)}</div>` : '';
        return `\n<div class="bg-card-light dark:bg-card-dark rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 flex items-center justify-between">\n  <div>\n    <div class=\"flex items-center gap-3\">\n      <label class=\"flex items-center gap-3\">\n        <input type=\"checkbox\" ${doneToday? 'checked':''} onchange=\"toggleHabit(${h.id})\" class=\"h-5 w-5 rounded border-gray-300 dark:border-gray-600 text-primary\"/>\n        <div>\n          <div class=\"font-semibold ${doneToday? 'text-green-600':'text-gray-900 dark:text-gray-100'}\">${escapeHtml(h.name)}</div>\n          <div class=\"text-sm text-gray-500 dark:text-gray-400\">${escapeHtml(h.frequency)} ${streakBadge}</div>\n        </div>\n      </label>\n    </div>\n    ${whyLine}\n  </div>\n  <div class=\"flex items-center gap-3\">\n    <button onclick=\"editHabit(${h.id})\" class=\"text-sm text-gray-600 dark:text-gray-300 hover:text-primary\">Edit</button>\n    <button onclick=\"deleteHabit(${h.id})\" class=\"text-sm text-red-500 hover:text-red-700\">Delete</button>\n  </div>\n</div>`;
    }).join('');
}

// Heatmap rendering helper (separate so we can append after render)
function renderHeatmapForHabitCard(habit, containerEl){
    try{
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const first = new Date(year, month, 1);
        const last = new Date(year, month+1, 0);
        const days = last.getDate();
        const heat = document.createElement('div'); heat.className = 'heatmap'; heat.title = `Completion for ${first.toLocaleString('default', {month:'long'})}`;
        for (let d=1; d<=days; d++){
            const dt = new Date(year, month, d);
            const key = getDateKey(dt);
            const day = document.createElement('div'); day.className = 'day';
            if (habit.history && habit.history[key]) day.classList.add('done');
            if (key === getDateKey(new Date())) day.classList.add('today');
            day.title = dt.toLocaleDateString();
            heat.appendChild(day);
        }
        containerEl.appendChild(heat);
    }catch(e){ /* ignore heatmap errors */ }
}

// Export / Import helpers
window.exportHabits = function(){
    const data = { habits: window.habits, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `habits-export-${new Date().toISOString().slice(0,10)}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    try{ showToast('Habits exported to JSON file', 'info', 3000); }catch(e){}
};

window.toggleHabitsImport = function(){ const inp = $('habits-import-file'); if (inp) inp.click(); };

window.importHabits = function(e){
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const reader = new FileReader(); reader.onload = function(){
        try{
            const data = JSON.parse(reader.result);
            if (!data || !Array.isArray(data.habits)) { showToast('Invalid file format', 'error', 3500); return; }
            showConfirmDialog('Importing will replace current habits. Continue?', ()=>{
                window.habits = data.habits.map(h=>({ ...h, history: h.history||{} }));
                saveToStorage('habits', window.habits);
                renderHabits();
                scheduleReminders();
                try{ showToast('Habits imported', 'success', 3000); }catch(e){}
            });
        }catch(err){ showToast('Failed to parse import file', 'error', 3500); }
    };
    reader.readAsText(f);
    e.target.value = '';
};

// Reminders scheduling (Notification API + setTimeout)
window._reminderTimers = [];
function clearScheduledReminders(){ window._reminderTimers.forEach(t=>clearTimeout(t)); window._reminderTimers = []; }
function scheduleReminders(){
    clearScheduledReminders();
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const now = new Date();
    window.habits.forEach(h=>{
        if (!h.reminderTime) return;
        const parts = h.reminderTime.split(':'); if (parts.length<2) return;
        const hr = parseInt(parts[0],10); const min = parseInt(parts[1],10);
        let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hr, min, 0, 0);
        if (next <= now){ if (h.frequency === 'weekly') next.setDate(next.getDate()+7); else next.setDate(next.getDate()+1); }
        const delay = next - now;
        const tId = setTimeout(()=>{
            try{ new Notification(h.name, { body: `Reminder: ${h.name}` }); }catch(e){}
            try{ showToast(`Reminder: ${h.name}`, 'info', 4000); }catch(e){}
            scheduleReminders();
        }, delay);
        window._reminderTimers.push(tId);
    });
}

function requestNotificationPermission(){ if (!('Notification' in window)) return; if (Notification.permission === 'default') Notification.requestPermission().then(p=>{ if (p === 'granted') scheduleReminders(); }); }

// expose render for initial load
window.renderHabits = renderHabits;

// Wire up on DOM ready
document.addEventListener('DOMContentLoaded', ()=>{ cacheDOM(); // show dashboard by default
    showView('dashboard'); window.updateDashboard(); window.loadJournalEntries(); renderHabits(); // attach optional keyboard handler for Enter
    document.querySelectorAll('#new-todo').forEach(n=>n.addEventListener('keypress', e=>{ if (e.key==='Enter') addTodo(); }));

    // ensure overlay exists but hidden
    if (!$('mobile-overlay')){
        const overlay = document.createElement('div'); overlay.id = 'mobile-overlay'; overlay.style.display = 'none'; document.body.appendChild(overlay);
    }

    // close mobile sidebar when resizing to a wider screen
    window.addEventListener('resize', ()=>{
        if (window.innerWidth > 768 && document.body.classList.contains('mobile-open')){
            window.toggleSidebar(false);
        }
    });
    // Close mobile sidebar with Escape key for accessibility
    document.addEventListener('keydown', (e)=>{
        if (e.key === 'Escape' || e.key === 'Esc'){
            if (document.body.classList.contains('mobile-open')){
                window.toggleSidebar(false);
            }
        }
    });
});

})();
