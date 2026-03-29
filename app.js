// Misión 9 Días
// Core Application Logic

const USERS = [
    { id: 'julia', name: 'Julia', icon: '🌸', role: 'user' },
    { id: 'alex', name: 'Alex', icon: '🎧', role: 'user' },
    { id: 'sam', name: 'Sam', icon: '🦕', role: 'user' },
    { id: 'admin', name: 'Papás', icon: '👑', role: 'admin' }
];

const INITIAL_TASKS = [
    // Fixed tasks
    { name: 'Poner/Quitar Mesa Mediodía', type: 'fixed', assigneeId: 'julia', baseReward: 0.5 },
    { name: 'Poner/Quitar Mesa Noche', type: 'fixed', assigneeId: 'alex', baseReward: 0.5 },
    { name: 'Bajar Basura', type: 'fixed', assigneeId: 'sam', baseReward: 0.5 },
    
    // Free tasks (Unique)
    { name: 'Alimentar Kora (Mañana)', type: 'free', baseReward: 0.5 },
    { name: 'Alimentar Kora (Noche)', type: 'free', baseReward: 0.5 },
    { name: 'Vaciar Lavavajillas', type: 'free', baseReward: 0.5 },
    { name: 'Limpiar Patio', type: 'free', baseReward: 0.5 },
    
    // Free tasks (Multiple slots for Sacar Kora)
    { name: 'Sacar Kora (Mañana)', type: 'free', baseReward: 3.0 },
    { name: 'Sacar Kora (Tarde)', type: 'free', baseReward: 3.0 },
    { name: 'Sacar Kora (Noche)', type: 'free', baseReward: 3.0 }
];

class App {
    constructor() {
        this.state = {
            currentUser: null,
            currentDay: 1,
            tasks: [],
            earnings: { julia: 0, alex: 0, sam: 0 },
            cloudUrl: "https://script.google.com/macros/s/AKfycbzKDxrm74YsnLR4stCPhPqD1SLKw-qOnGGvWbw4hfbV7Op2GHx8qJBP2knznbm9T_SyGg/exec" 
        };
        
        this.init();
    }

    async init() {
        this.registerServiceWorker();
        this.loadData();
        if (this.state.tasks.length === 0) {
            this.generateAllDaysTasks();
        }
        
        // Render and setup listeners IMMEDIATELY so UI is interactive
        this.renderUserSelection();
        this.setupEventListeners();
        
        // Hide loader early
        document.body.classList.add('ready');
        document.getElementById('loader').classList.add('hidden');
        document.getElementById('user-selection').classList.remove('hidden');

        // Sync in the background or await it if you want, but UI is already ready
        await this.syncWithCloud();
        this.renderUserSelection(); // Re-render if cloud data changed
    }

    async syncWithCloud() {
        if (!this.state.cloudUrl) return;
        
        try {
            const response = await fetch(this.state.cloudUrl);
            const cloudData = await response.json();
            
            if (cloudData && cloudData.tasks) {
                // Merge logic could be complex, but for now we trust cloud if it's newer
                // Simple overwrite for this demo
                this.state = { ...this.state, ...cloudData };
                this.saveData(false); // Save local without triggering another cloud sync
                console.log("Synced from cloud");
            }
        } catch (e) {
            console.error("Cloud sync failed", e);
        }
    }

    async pushToCloud() {
        if (!this.state.cloudUrl) return;

        try {
            await fetch(this.state.cloudUrl, {
                method: 'POST',
                mode: 'no-cors', // Apps Script web app needs no-cors for simple POST
                body: JSON.stringify(this.state)
            });
            console.log("Pushed to cloud");
        } catch (e) {
            console.error("Cloud push failed", e);
        }
    }

    loadData() {
        const saved = localStorage.getItem('mision_9_dias_data');
        if (saved) {
            this.state = JSON.parse(saved);
        }
    }

    saveData(push = true) {
        localStorage.setItem('mision_9_dias_data', JSON.stringify(this.state));
        if (push) this.pushToCloud();
    }

    generateAllDaysTasks() {
        const allTasks = [];
        for (let d = 1; d <= 9; d++) {
            INITIAL_TASKS.forEach((t, index) => {
                allTasks.push({
                    id: `d${d}-t${index}-${Math.random().toString(36).substr(2, 5)}`,
                    name: t.name,
                    day: d,
                    type: t.type,
                    assigneeId: t.assigneeId || null,
                    baseReward: t.baseReward,
                    status: 'pending', // pending, done, validated
                    validation: null // { quality: 1-3, attitude: 1-3, penalty: 0 }
                });
            });
        }
        this.state.tasks = allTasks;
        this.saveData();
    }

    renderUserSelection() {
        const grid = document.getElementById('user-grid');
        grid.innerHTML = USERS.map(user => `
            <div class="user-card" data-id="${user.id}">
                <div class="user-avatar">${user.icon}</div>
                <div class="user-name">${user.name}</div>
            </div>
        `).join('');

        grid.querySelectorAll('.user-card').forEach(card => {
            card.onclick = () => this.login(card.dataset.id);
        });
    }

    login(userId) {
        const user = USERS.find(u => u.id === userId);
        
        // Security check for Parents
        if (user.role === 'admin') {
            const pin = prompt("Introduce el PIN de acceso para Papás:");
            if (pin !== "2026") { // Default PIN
                alert("PIN Incorrecto");
                return;
            }
        }

        this.state.currentUser = user;
        document.getElementById('user-selection').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        this.renderDashboard();
    }

    logout() {
        this.state.currentUser = null;
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('user-selection').classList.remove('hidden');
    }

    renderDashboard() {
        const user = this.state.currentUser;
        document.getElementById('current-user-name').innerText = user.name;
        document.getElementById('day-counter').innerText = `Día ${this.state.currentDay}/9`;
        
        // Show/Hide sections based on role
        if (user.role === 'admin') {
            document.getElementById('user-stats').classList.add('hidden');
            document.getElementById('admin-panel').classList.remove('hidden');
            this.renderAdminPanel();
        } else {
            document.getElementById('user-stats').classList.remove('hidden');
            document.getElementById('admin-panel').classList.add('hidden');
            this.updateStats();
        }

        this.renderTasks();

        // Add "Pedir Tarea Extra" button for children
        if (user.role !== 'admin') {
            this.renderExtraTaskButton();
        }
    }

    renderExtraTaskButton() {
        const tasksSection = document.querySelector('.tasks-section');
        let btn = document.getElementById('request-extra-btn');
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'request-extra-btn';
            btn.className = 'btn-save';
            btn.style.width = '100%';
            btn.style.marginTop = '20px';
            btn.style.background = 'var(--accent)';
            btn.innerText = '🚀 Pedir Tarea Extra (+1.50€)';
            btn.onclick = () => this.requestExtraTask();
            tasksSection.appendChild(btn);
        }
    }

    nextDay() {
        if (this.state.currentDay < 9) {
            this.state.currentDay++;
            this.saveData();
            this.renderDashboard();
        }
    }

    prevDay() {
        if (this.state.currentDay > 1) {
            this.state.currentDay--;
            this.saveData();
            this.renderDashboard();
        }
    }

    updateStats() {
        const user = this.state.currentUser;
        const total = this.calculateEarnings(user.id);
        document.getElementById('user-total-earnings').innerText = `${total.toFixed(2)}€`;
        
        const doneCount = this.state.tasks.filter(t => 
            t.assigneeId === user.id && t.status !== 'pending'
        ).length;
        const totalAssigned = this.state.tasks.filter(t => t.assigneeId === user.id).length;
        document.getElementById('user-tasks-count').innerText = `${doneCount}/${totalAssigned}`;
    }

    calculateEarnings(userId) {
        let total = this.state.tasks
            .filter(t => t.assigneeId === userId && t.status === 'validated')
            .reduce((acc, t) => {
                let reward = t.baseReward;
                if (t.validation) {
                    const qBonus = t.validation.quality === 3 ? 0.25 : 0.0;
                    let aBonus = 0;
                    if (t.validation.attitude === 3) aBonus = 0.25;
                    else if (t.validation.attitude === 1) aBonus = -0.50;
                    
                    reward = t.baseReward + qBonus + aBonus - (t.validation.penalty || 0);
                }
                return acc + Math.max(0, reward);
            }, 0);

        const fixedTasks = this.state.tasks.filter(t => t.assigneeId === userId && t.type === 'fixed');
        const allValidated = fixedTasks.length > 0 && fixedTasks.every(t => t.status === 'validated');
        
        if (allValidated) {
            total += 5.0;
        }
        
        return total;
    }

    renderTasks() {
        const tasksList = document.getElementById('tasks-list');
        const user = this.state.currentUser;
        
        // Filter tasks for the user and day
        // Show assigned to them OR free tasks
        const todayTasks = this.state.tasks.filter(t => 
            t.day === this.state.currentDay && 
            (t.assigneeId === user.id || t.assigneeId === null) &&
            user.role !== 'admin'
        );

        // Check 18:00h limit logic for free tasks
        const now = new Date();
        const hour = now.getHours();
        const isBeforeRelease = hour < 18;
        
        const completedFreeToday = this.state.tasks.filter(t => 
            t.day === this.state.currentDay && 
            t.assigneeId === user.id && 
            t.type === 'free' && 
            t.status !== 'pending'
        ).length;

        const reachedLimit = isBeforeRelease && completedFreeToday >= 3;

        if (user.role === 'admin') {
            tasksList.innerHTML = '<p class="text-muted">Vista de administrador. Usa el panel inferior.</p>';
            return;
        }

        tasksList.innerHTML = todayTasks.map(t => {
            const isDisabled = reachedLimit && t.type === 'free' && t.status === 'pending';
            
            return `
                <div class="task-card ${t.status !== 'pending' ? 'status-done' : ''} ${isDisabled ? 'task-disabled' : ''}">
                    <div class="task-main">
                        <span class="task-type type-${t.type}">${t.type}</span>
                        <span class="task-name">${t.name}</span>
                        <span class="task-reward">${t.baseReward.toFixed(2)}€ base</span>
                    </div>
                    <div class="task-action">
                        ${isDisabled ? '<span class="limit-msg">Límite (Max 3) hasta 18h</span>' : this.getTaskActionButton(t)}
                    </div>
                </div>
            `;
        }).join('');
    }

    getTaskActionButton(task) {
        if (task.status === 'validated') {
            let reward = task.baseReward;
            if (task.validation) {
                const qBonus = task.validation.quality === 3 ? 0.25 : 0.0;
                let aBonus = 0;
                if (task.validation.attitude === 3) aBonus = 0.25;
                else if (task.validation.attitude === 1) aBonus = -0.50;
                reward = task.baseReward + qBonus + aBonus - (task.validation.penalty || 0);
            }
            return `<span class="task-badge badge-validated">💰 +${Math.max(0, reward).toFixed(2)}€</span>`;
        }
        if (task.status === 'done') {
            return `<span class="task-badge badge-done">⌛ Revisando...</span>`;
        }
        return `<button class="btn-done" onclick="window.app.markAsDone('${task.id}')">Hecho</button>`;
    }

    markAsDone(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'done';
            // If it was a free task, the user who clicks it becomes the assignee
            if (!task.assigneeId) {
                task.assigneeId = this.state.currentUser.id;
            }
            this.saveData();
            this.renderDashboard();
            this.showFeedback('¡Buen trabajo! Pendiente de validación.');
        }
    }

    renderAdminPanel() {
        const pendingList = document.getElementById('pending-validation-list');
        const pending = this.state.tasks.filter(t => t.status === 'done');

        let html = `
            <div class="admin-controls">
                <div class="day-selector">
                    <button onclick="window.app.prevDay()">◀</button>
                    <span>Día ${this.state.currentDay}</span>
                    <button onclick="window.app.nextDay()">▶</button>
                </div>
                <div class="settings-section">
                    <h3>Configuración Nube</h3>
                    <input type="text" id="cloud-url-input" placeholder="URL de Google Apps Script" value="${this.state.cloudUrl || ''}">
                    <button class="btn-save" onclick="window.app.saveCloudUrl()">Guardar URL</button>
                    <p class="sync-status ${this.state.cloudUrl ? 'online' : ''}">
                        ${this.state.cloudUrl ? '✓ Conectado a Sheets' : '⚠ Solo local'}
                    </p>
                </div>
                <div class="quick-actions">
                    <button class="btn-save" style="background:#8E735B" onclick="window.app.addExtraTask()">+ Añadir Extra/Sorpresa</button>
                    <button class="btn-save" style="background:#D32F2F" onclick="window.app.resetTasks()">⚠ Reiniciar Todas las Tareas</button>
                </div>
            </div>
            
            <div class="admin-ranking">
                <h3>🏆 Posiciones Actuales</h3>
                ${this.renderRanking()}
            </div>

            <h3>Validaciones Pendientes</h3>
        `;

        if (pending.length === 0) {
            html += '<p class="text-muted">No hay tareas pendientes de validar.</p>';
        } else {
            html += pending.map(t => {
                const user = USERS.find(u => u.id === t.assigneeId);
                return `
                    <div class="task-card">
                        <div class="task-main">
                            <span class="task-name">${t.name}</span>
                            <span class="task-reward">Por: ${user.name} (${user.icon})</span>
                        </div>
                        <button class="btn-done active" onclick="window.app.openValidationModal('${t.id}')">Validar</button>
                    </div>
                `;
            }).join('');
        }
        
        pendingList.innerHTML = html;
    }

    renderRanking() {
        const rankings = USERS.filter(u => u.role === 'user').map(u => ({
            name: u.name,
            icon: u.icon,
            total: this.calculateEarnings(u.id)
        })).sort((a, b) => b.total - a.total);

        return `
            <div class="ranking-list">
                ${rankings.map((u, i) => {
                    const fixed = this.state.tasks.filter(t => t.assigneeId === USERS.find(user => user.name === u.name).id && t.type === 'fixed');
                    const valCount = fixed.filter(t => t.status === 'validated').length;
                    const isPerfect = fixed.length > 0 && valCount === fixed.length;
                    
                    return `
                        <div class="ranking-item ${isPerfect ? 'perfect-score' : ''}">
                            <span class="rank-pos">${i === 0 ? '🥇' : (i === 1 ? '🥈' : '🥉')}</span>
                            <span class="rank-name">${u.name} ${isPerfect ? '🔥' : ''}</span>
                            <span class="rank-total">${u.total.toFixed(2)}€</span>
                            <div class="rank-details">
                                <span class="rank-bonus">+${i === 0 ? '5' : (i === 1 ? '3' : '1')}€ Posición</span>
                                ${isPerfect ? '<span class="rank-bonus" style="background:var(--success)">+5€ Constancia!</span>' : `<span class="rank-subtext">${valCount}/9 días fijos</span>`}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    saveCloudUrl() {
        let url = document.getElementById('cloud-url-input').value;
        if (url && !url.includes('exec')) {
            alert("Atención: La URL de Apps Script suele terminar en '/exec'. Asegúrate de que sea la URL de implementación.");
        }
        this.state.cloudUrl = url;
        this.saveData();
        alert("Configuración guardada.");
        this.renderDashboard();
    }

    addExtraTask() {
        const name = prompt("Nombre de la tarea Extra/Sorpresa:");
        if (!name) return;
        const type = confirm("¿Es una tarea SORPRESA? (Aceptar para Sorpresa, Cancelar para Extra)") ? 'surprise' : 'extra';
        const reward = type === 'surprise' ? 2.5 : 1.5;
        
        const newTask = {
            id: `extra-${Date.now()}`,
            name: name,
            day: this.state.currentDay,
            type: type,
            assigneeId: null,
            baseReward: reward,
            status: 'pending',
            validation: null
        };
        
        this.state.tasks.push(newTask);
        this.saveData();
        this.renderDashboard();
    }

    resetTasks() {
        if (confirm("¿Seguro que quieres borrar todo y empezar de cero con la nueva lista de tareas?")) {
            this.state.tasks = [];
            this.generateAllDaysTasks();
            this.state.currentDay = 1;
            this.saveData();
            this.renderDashboard();
        }
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./service-worker.js')
                .then(() => console.log('SW Registered'))
                .catch(err => console.log('SW Registration failed', err));
        }
    }

    openValidationModal(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        const modal = document.getElementById('modal-container');
        const content = document.getElementById('task-detail-modal');
        
        content.innerHTML = `
            <h2>Validar Tarea</h2>
            <div class="task-info-brief">
                <span class="task-name">${task.name}</span>
                <span class="user-badge">${USERS.find(u => u.id === task.assigneeId).name} ${USERS.find(u => u.id === task.assigneeId).icon}</span>
            </div>
            
            <div class="validation-form">
                <label>Calidad del Resultado (1-3 Estrellas)</label>
                <div class="star-rating" id="rating-quality">
                    <span data-val="1">⭐</span><span data-val="2">⭐⭐</span><span data-val="3">⭐⭐⭐</span>
                </div>

                <label>Actitud / Sin Rechistar</label>
                <div class="emoji-rating" id="rating-attitude">
                    <span data-val="1" title="Mal (con quejas)">😠</span>
                    <span data-val="2" title="Neutral">😐</span>
                    <span data-val="3" title="¡Muy bien! (Sin rechistar)">😊</span>
                </div>

                <label>Penalización (€) - *Solo si aplica*</label>
                <input type="number" id="input-penalty" value="0" step="0.1" min="0">

                <div class="modal-actions">
                    <button class="btn-cancel" onclick="window.app.closeModal()">Cerrar</button>
                    <button class="btn-confirm" onclick="window.app.validateTask('${task.id}')">Validar y Pagar</button>
                </div>
            </div>
        `;

        // Ratings logic (simplified)
        this.tempValidation = { quality: 2, attitude: 3 };
        const setRating = (parent, val) => {
            parent.querySelectorAll('span').forEach(s => s.classList.remove('active'));
            parent.querySelector(`[data-val="${val}"]`).classList.add('active');
        };

        content.querySelectorAll('.star-rating span, .emoji-rating span').forEach(s => {
            s.onclick = () => {
                const isQuality = s.parentElement.id === 'rating-quality';
                if (isQuality) this.tempValidation.quality = parseInt(s.dataset.val);
                else this.tempValidation.attitude = parseInt(s.dataset.val);
                setRating(s.parentElement, s.dataset.val);
            };
        });

        modal.classList.remove('hidden');
    }

    validateTask(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        const penalty = parseFloat(document.getElementById('input-penalty').value) || 0;
        
        task.status = 'validated';
        task.validation = {
            quality: this.tempValidation.quality,
            attitude: this.tempValidation.attitude,
            penalty: penalty
        };

        this.saveData();
        this.closeModal();
        this.renderDashboard();
        this.showFeedback('Tarea validada con éxito.');
    }

    requestExtraTask() {
        const options = [
            { name: 'Preparar Comida', reward: 1.5 },
            { name: 'Preparar Cena', reward: 1.5 },
            { name: 'Cepillar a Kora', reward: 1.0 },
            { name: 'Limpiar Nevera', reward: 2.0 },
            { name: 'Ordenar Trastero/Cajones', reward: 2.0 }
        ];

        const list = options.map((o, i) => `${i + 1}. Ejemplo: ${o.name} (+${o.reward}€)`).join('\n');
        const choice = prompt(`Elige una tarea extra para hoy:\n\n${list}\n\nEscribe el número:`);
        
        const idx = parseInt(choice) - 1;
        if (options[idx]) {
            const newTask = {
                id: `extra-req-${Date.now()}`,
                name: options[idx].name,
                day: this.state.currentDay,
                type: 'extra',
                assigneeId: this.state.currentUser.id,
                baseReward: options[idx].reward,
                status: 'pending',
                validation: null
            };
            this.state.tasks.push(newTask);
            this.saveData();
            this.renderDashboard();
            this.showFeedback(`¡Tarea "${newTask.name}" añadída a tu lista!`);
        }
    }

    openInstructions() {
        document.getElementById('modal-container').classList.remove('hidden');
        document.getElementById('task-detail-modal').classList.add('hidden');
        document.getElementById('instructions-modal').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-container').classList.add('hidden');
        document.getElementById('instructions-modal').classList.add('hidden');
        document.getElementById('task-detail-modal').classList.add('hidden');
    }

    setupEventListeners() {
        document.getElementById('logout-btn').onclick = () => this.logout();
        document.getElementById('show-instructions-btn').onclick = () => this.openInstructions();
    }

    showFeedback(msg) {
        // Simple alert for now, could be a toast
        alert(msg);
    }
}

// Start App
window.app = new App();
