// Misión 9 Días
// Core Application Logic

const USERS = [
    { id: 'julia', name: 'Julia', icon: '🌸', role: 'user', pin: '1234' }, // PIN Added
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
        // Supabase Config
        const SUPABASE_URL = "https://nckibxkaqkdrkluvbwvz.supabase.co";
        const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ja2lieGthcWtkcmtsdXZid3Z6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3NzI1OTgsImV4cCI6MjA5MDM0ODU5OH0.sCMzFhGwRO3fwNf8m0K4aHjYJpxcN3N4RtfolXn7RV0";
        this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

        this.state = {
            currentUser: null,
            currentDay: 1,
            tasks: [],
            earnings: { julia: 0, alex: 0, sam: 0 },
            generationId: Date.now()
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

        // Sync initially
        this.syncWithSupabase(true);
        
        // Setup REAL-TIME subscription
        this.setupRealtimeSync();
    }

    setupRealtimeSync() {
        this.sb.channel('realtime:config')
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'config' }, payload => {
                if (payload.new && payload.new.data) {
                    console.log("Real-time Update Received!");
                    this.mergeData(payload.new.data, true);
                }
            })
            .subscribe();
    }

    async syncWithSupabase(isInitial = false) {
        if (!isInitial) this.showSyncStatus("Sincronizando manual...");
        try {
            const { data, error } = await this.sb
                .from('config')
                .select('data')
                .eq('id', 1)
                .single();

            if (error) {
                if (error.code === 'PGRST116') {
                    await this.pushToSupabase();
                } else {
                    console.error("Supabase Error:", error);
                    if (!isInitial) this.showAlert("Error Sync", "No hemos podido conectar con la nube.");
                }
                return;
            }

            if (data && data.data) {
                this.mergeData(data.data, isInitial);
                if (!isInitial) this.showSyncStatus("Sync OK");
            }
        } catch (e) {
            console.error("Sync failed:", e);
            if (!isInitial) this.showAlert("Error Red", "Revisa tu conexión a internet.");
        }
    }

    async pushToSupabase() {
        try {
            console.log("Pushing state to cloud...", this.state);
            this.setSyncIndicator('syncing');
            const { error } = await this.sb
                .from('config')
                .upsert({ id: 1, data: this.state });
            
            if (error) {
                console.error("Supabase Upsert Error:", error);
                this.setSyncIndicator('error');
            } else {
                console.log("Cloud Push Success ✅");
                this.setSyncIndicator('success');
            }
        } catch (e) {
            console.error("Push failed:", e);
            this.setSyncIndicator('error');
        }
    }

    setSyncIndicator(status) {
        const dots = document.querySelectorAll('.sync-dot');
        dots.forEach(dot => {
            dot.className = 'sync-dot ' + status;
            dot.title = status === 'success' ? 'Sincronizado' : (status === 'error' ? 'Error de conexión' : 'Sincronizando...');
        });
    }

    mergeData(cloudData, isQuiet = false) {
        const cloudGen = cloudData.generationId || 0;
        const localGen = this.state.generationId || 0;

        // If cloud is from a NEW Mission reset, overwrite local completely
        if (cloudGen > localGen) {
            this.state = { ...this.state, ...cloudData };
            this.saveData(false);
            if (this.state.currentUser) this.renderDashboard();
            return;
        }

        // Merge logic for statuses
        const statusOrder = { 'pending': 0, 'done': 1, 'validated': 2 };
        let hasChanges = false;
        const mergedTasks = [...this.state.tasks];
        
        cloudData.tasks.forEach(cloudTask => {
            const localIdx = mergedTasks.findIndex(t => t.id === cloudTask.id);
            if (localIdx === -1) {
                mergedTasks.push(cloudTask);
                hasChanges = true;
            } else {
                const localTask = mergedTasks[localIdx];
                const localOrder = statusOrder[localTask.status] || 0;
                const cloudOrder = statusOrder[cloudTask.status] || 0;
                
                if (cloudOrder > localOrder) {
                    mergedTasks[localIdx] = cloudTask;
                    hasChanges = true;
                }
            }
        });

        if (hasChanges) {
            console.log("Applying cloud changes...");
            this.state.tasks = mergedTasks;
            this.state.currentDay = Math.max(this.state.currentDay, cloudData.currentDay || 1);
            this.saveData(false);
            if (this.state.currentUser) {
                this.renderDashboard();
                this.showSyncStatus("Actualizado");
            }
        } else {
            this.showSyncStatus("Sincronizado");
        }
    }

    showSyncStatus(msg) {
        const indicator = document.getElementById('sync-indicator');
        if (indicator) {
            indicator.innerText = `${msg} ${new Date().toLocaleTimeString()}`;
            indicator.style.opacity = 1;
            setTimeout(() => { indicator.style.opacity = 0.5; }, 2000);
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
        if (push) this.pushToSupabase();
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

    async login(userId) {
        const user = USERS.find(u => u.id === userId);
        
        // Security check for Parents
        if (user.role === 'admin') {
            const pin = await this.showPrompt("Seguridad", "Introduce el PIN de acceso para Papás:", "PIN de 4 cifras");
            if (pin !== "2026") {
                this.showAlert("Error", "PIN Incorrecto");
                return;
            }
        }

        // Security check for specific users (like Julia)
        if (user.pin) {
            const pin = await this.showPrompt("Acceso", `Introduce el PIN para el perfil de ${user.name}:`, "Tu contraseña");
            if (pin !== user.pin) {
                this.showAlert("Error", "PIN Incorrecto");
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
            document.querySelector('.tasks-section').classList.add('hidden'); // HIDE REDUNDANT "Tareas de Hoy"
            document.getElementById('admin-panel').classList.remove('hidden');
            this.renderAdminPanel();
        } else {
            document.getElementById('user-stats').classList.remove('hidden');
            document.querySelector('.tasks-section').classList.remove('hidden');
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
        if (this.state.currentUser.role === 'admin') {
            if (btn) btn.remove();
            return;
        }
        
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

    async markAsDone(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'done';
            if (!task.assigneeId) {
                task.assigneeId = this.state.currentUser.id;
            }
            this.saveData(); // This pushes to cloud
            this.renderDashboard();
            await this.showAlert("¡Hecho!", "✓ Tarea marcada. Espera a que Papá la valide.");
        }
    }

    renderAdminPanel() {
        const pendingList = document.getElementById('pending-validation-list');
        if (!pendingList) return;
        
        const scrollPos = window.scrollY; // SAVE SCROLL
        const pending = this.state.tasks.filter(t => t.status === 'done');

        // Only update the controls part IF not already there to avoid flickering
        let controlsHtml = `
            <div class="admin-controls">
                <div class="day-selector">
                    <button onclick="window.app.prevDay()">◀</button>
                    <span>Día ${this.state.currentDay}</span>
                    <button onclick="window.app.nextDay()">▶</button>
                </div>
                <div class="quick-actions">
                    <div id="sync-indicator" style="font-size:0.7rem; text-align:center; color:var(--text-muted); margin-bottom:10px; transition: opacity 0.5s">Sincronizado</div>
                    <button class="btn-save" style="background:#4CAF50" onclick="window.app.syncWithSupabase()">🔄 Sincronizar Ahora</button>
                    <button class="btn-save" style="background:#8E735B" onclick="window.app.addExtraTask()">+ Añadir Extra/Sorpresa</button>
                    <button class="btn-save" style="background:#D32F2F" onclick="window.app.resetTasks()">⚠ Reiniciar Todo</button>
                    
                    <details style="margin-top:15px; color:var(--text-muted); font-size:0.9rem">
                        <summary style="cursor:pointer">⚙️ Opciones Avanzadas</summary>
                        <div style="display:flex; gap:10px; margin-top:10px">
                            <button class="btn-save" style="background:#455A64; flex:1; font-size:0.8rem" onclick="window.app.exportData()">📤 Exportar</button>
                            <button class="btn-save" style="background:#455A64; flex:1; font-size:0.8rem" onclick="window.app.importData()">📥 Importar</button>
                        </div>
                        <div style="margin-top:10px; font-size:0.6rem; opacity:0.5; text-align:center">Versión Supabase Real-time v5.0.2</div>
                    </details>
                </div>
            </div>
            
            <div class="admin-ranking">
                <h3>🏆 Posiciones Actuales</h3>
                ${this.renderRanking()}
            </div>

            <h3 style="margin-top:20px">Validaciones Pendientes</h3>
        `;

        let listHtml = '';
        if (pending.length === 0) {
            listHtml = '<p class="text-muted">No hay tareas pendientes de validar.</p>';
        } else {
            listHtml = pending.map(t => {
                const user = USERS.find(u => u.id === t.assigneeId);
                return `
                    <div class="task-card">
                        <div class="task-main">
                            <span class="task-name">${t.name}</span>
                            <span class="user-badge">${user.name} (${user.icon})</span>
                        </div>
                        <button class="btn-done active" onclick="window.app.openValidationModal('${t.id}')">Validar</button>
                    </div>
                `;
            }).join('');
        }
        
        // Use a container for the whole panel to avoid full screen blink
        const adminPanel = document.getElementById('admin-panel');
        // If it's already full, just update the list to preserve scroll better
        if (adminPanel.querySelector('.admin-controls')) {
            // Update Ranking
            const rankingDiv = adminPanel.querySelector('.admin-ranking');
            if (rankingDiv) rankingDiv.innerHTML = `<h3>🏆 Posiciones Actuales</h3>` + this.renderRanking();
            // Update List
            const listContainer = document.getElementById('pending-validation-list');
            listContainer.innerHTML = listHtml;
        } else {
            // Full render first time
            adminPanel.innerHTML = `
                <div class="section-title"><h2>Panel de Control</h2></div>
                ${controlsHtml}
                <div id="pending-validation-list" class="tasks-grid">
                    ${listHtml}
                </div>
            `;
        }
        
        window.scrollTo(0, scrollPos); // RESTORE SCROLL
    }

    renderRanking() {
        const rankings = USERS.filter(u => u.role === 'user').map(u => ({
            id: u.id,
            name: u.name,
            icon: u.icon,
            total: this.calculateEarnings(u.id)
        })).sort((a, b) => b.total - a.total);

        return `
            <div class="ranking-list">
                ${rankings.map((u, i) => {
                    const fixed = this.state.tasks.filter(t => t.assigneeId === u.id && t.type === 'fixed');
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

    async saveCloudUrl() {
        let url = document.getElementById('cloud-url-input').value.trim();
        if (url && !url.includes('exec')) {
            await this.showAlert("Atención", "La URL de Apps Script suele terminar en '/exec'.");
        }
        this.state.cloudUrl = url;
        this.saveData();
        await this.showAlert("Guardado", "✓ Configuración de la nube actualizada.");
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

    async resetTasks() {
        const confirm = await this.showConfirm("⚠ Reiniciar Todo", "¿Seguro que quieres borrar todo y empezar de cero?");
        if (!confirm) return;

        this.state.generationId = Date.now(); // NEW generation forces overwrite on children
        this.state.tasks = [];
        this.generateAllDaysTasks();
        this.state.currentDay = 1;
        
        await this.pushToSupabase();
        this.renderDashboard();
        await this.showAlert("Reiniciado", "✓ Aplicación reseteada en la nube.");
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
                    <button class="btn-cancel" style="background:#FF9800; color:white" onclick="window.app.rejectTask('${task.id}')">No hecha</button>
                    <button class="btn-confirm" style="background:var(--primary); color:white" onclick="window.app.validateTask('${task.id}')">Validar ✅</button>
                </div>
                <button class="secondary-btn" style="margin-top:12px; border:none; background:none; color:var(--text-muted); cursor:pointer" onclick="window.app.closeModal()">Cerrar</button>
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

    async requestExtraTask() {
        const options = [
            { name: 'Preparar Comida', reward: 1.5 },
            { name: 'Preparar Cena', reward: 1.5 },
            { name: 'Cepillar a Kora', reward: 1.0 },
            { name: 'Limpiar Nevera', reward: 2.0 },
            { name: 'Ordenar Trastero/Cajones', reward: 2.0 }
        ];

        const list = options.map((o, i) => `${i + 1}. ${o.name} (+${o.reward.toFixed(2)}€)`).join('\n');
        const choice = await this.showPrompt("Elegir Tarea Extra", `Opciones:\n${list}\n\nEscribe el número:`, "1");
        
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
            await this.showAlert("Añadida", `¡Tarea "${newTask.name}" añadida a tu lista!`);
        }
    }

    async rejectTask(taskId) {
        const confirm = await this.showConfirm("Rechazar Tarea", "¿Quieres marcar esta tarea como 'No hecha' y volverla a poner libre?");
        if (!confirm) return;

        const task = this.state.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'pending';
            if (task.type === 'free') {
                task.assigneeId = null;
            }
            task.validation = null;
            this.saveData();
            this.closeModal();
            this.renderDashboard();
            await this.showAlert("Actualizado", "Tarea devuelta al estado pendiente.");
        }
    }

    openInstructions() {
        document.getElementById('modal-container').classList.remove('hidden');
        document.getElementById('task-detail-modal').classList.add('hidden');
        document.getElementById('instructions-modal').classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-container').classList.add('hidden');
    }

    setupEventListeners() {
        document.getElementById('logout-btn').onclick = () => this.logout();
        document.getElementById('show-instructions-btn').onclick = () => this.openInstructions();
    }

    showFeedback(msg) {
        this.showAlert("Mensaje", msg);
    }

    exportData() {
        const data = JSON.stringify(this.state);
        const el = document.createElement('textarea');
        el.value = data;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
        this.showAlert("Copiado", "✓ Datos copiados al portapapeles.");
    }

    async importData() {
        const json = await this.showPrompt("Importar", "Pega aquí los datos exportados:");
        if (json) {
            try {
                const imported = JSON.parse(json);
                if (imported.tasks && imported.generationId) {
                    this.state = imported;
                    this.saveData();
                    this.renderDashboard();
                    await this.showAlert("Éxito", "✓ Datos importados.");
                } else {
                    throw new Error("Formato inválido.");
                }
            } catch (e) {
                await this.showAlert("Error", "❌ Datos no válidos.");
            }
        }
    }

    showCustomModal(title, msg, type = 'alert', placeholder = '') {
        return new Promise((resolve) => {
            const modal = document.getElementById('custom-modal');
            const titleEl = document.getElementById('modal-title');
            const msgEl = document.getElementById('modal-message');
            const inputContainer = document.getElementById('modal-input-container');
            const inputEl = document.getElementById('modal-input');
            const cancelBtn = document.getElementById('modal-cancel-btn');
            const okBtn = document.getElementById('modal-ok-btn');

            titleEl.innerText = title;
            msgEl.innerText = msg;
            
            inputContainer.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            inputEl.value = '';
            
            if (type === 'prompt') {
                inputContainer.classList.remove('hidden');
                inputEl.placeholder = placeholder;
                cancelBtn.classList.remove('hidden');
            } else if (type === 'confirm') {
                cancelBtn.classList.remove('hidden');
            }

            const cleanUp = (result) => {
                modal.classList.add('hidden');
                okBtn.onclick = null;
                cancelBtn.onclick = null;
                resolve(result);
            };

            okBtn.onclick = () => {
                if (type === 'prompt') cleanUp(inputEl.value);
                else cleanUp(true);
            };

            cancelBtn.onclick = () => {
                cleanUp(false);
            };

            modal.classList.remove('hidden');
            if (type === 'prompt') inputEl.focus();
        });
    }

    showAlert(title, msg) {
        return this.showCustomModal(title, msg, 'alert');
    }

    showConfirm(title, msg) {
        return this.showCustomModal(title, msg, 'confirm');
    }

    showPrompt(title, msg, placeholder) {
        return this.showCustomModal(title, msg, 'prompt', placeholder);
    }
}

// Start App
window.app = new App();
