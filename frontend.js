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

window.renderJournalEntries = function(){ const container = $('journal-entries'); if (!container) return; container.innerHTML = window.journalEntries.map(entry=>`\n<div class=\"bg-card-light dark:bg-card-dark rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 animate-fade-in\">\n  <div class=\"flex justify-between items-start mb-4\">\n    <div>\n      <h3 class=\"font-semibold\">${entry.date.toLocaleDateString()}</h3>\n      <div class=\"flex space-x-4 text-sm text-gray-600 dark:text-gray-400\">\n        <span>Energy: ${entry.energyLevel}/5</span>\n        <span>Focus: ${entry.focusQuality}/5</span>\n        <span>Tasks: ${entry.completedTasks}/${entry.totalTasks}</span>\n      </div>\n    </div>\n    <button onclick=\"deleteJournalEntry(${entry.id})\" class=\"text-red-500 hover:text-red-700\">\n      <i class=\\\"fas fa-trash\\\"></i>\n    </button>\n  </div>\n  <p class=\"text-gray-700 dark:text-gray-300 whitespace-pre-wrap\">${escapeHtml(entry.text)}</p>\n</div>`).join(''); };

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

// Wire up on DOM ready
document.addEventListener('DOMContentLoaded', ()=>{ cacheDOM(); // show dashboard by default
    showView('dashboard'); window.updateDashboard(); window.loadJournalEntries(); // attach optional keyboard handler for Enter
    document.querySelectorAll('#new-todo').forEach(n=>n.addEventListener('keypress', e=>{ if (e.key==='Enter') addTodo(); }));
});

})();
