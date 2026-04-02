// Misión 9 Días
// Core Application Logic

const USERS = [
    { id: 'julia', email: 'julia@mision9dias.app', name: 'Julia', icon: '🌸', role: 'user', pin: '1234' },
    { id: 'alex', email: 'alex@mision9dias.app', name: 'Alex', icon: '🎧', role: 'user', pin: '1234' },
    { id: 'sam', email: 'sam@mision9dias.app', name: 'Sam', icon: '🦕', role: 'user', pin: '1234' },
    { id: 'admin', email: 'admin@mision9dias.app', name: 'Papás', icon: '👑', role: 'admin', pin: '2026' }
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
    
    getAutomaticCurrentDay() {
        const startDateStr = '2026-03-29'; // Día 1 oficial
        // Formato YYYY-MM-DD en hora de España
        const todayStr = new Intl.DateTimeFormat('fr-CA', {timeZone: 'Europe/Madrid'}).format(new Date());
        
        const start = Date.parse(startDateStr + "T00:00:00Z");
        const today = Date.parse(todayStr + "T00:00:00Z");
        
        const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        let computedDay = diffDays + 1;
        
        // Mapear entre 1 y 9
        if (computedDay < 1) computedDay = 1;
        if (computedDay > 9) computedDay = 9;
        
        return computedDay;
    }

    async init() {
        try {
            // 1. Force Clean Refresh 
            if (localStorage.getItem('mision_kora_refresh_v8_3') !== 'true') {
                localStorage.clear();
                localStorage.setItem('mision_kora_refresh_v8_3', 'true');
                location.reload(true);
                return;
            }

            this.registerServiceWorker();
            this.loadData();

            if (this.state.tasks.length === 0) {
                this.generateAllDaysTasks();
            }

            this.setupEventListeners();
            
            document.getElementById('loader')?.classList.add('hidden');
            document.body.classList.add('ready');

            // Recuperar sesión activa de Supabase
            const { data: { session } } = await this.sb.auth.getSession();
            if (session && session.user) {
                const userObj = USERS.find(u => u.email === session.user.email);
                if (userObj) {
                    this.state.currentUser = userObj;
                    this.state.adminViewDay = this.getAutomaticCurrentDay();
                    document.getElementById('dashboard').classList.remove('hidden');
                    
                    // Iniciar Sync solo cuando estamos autenticados
                    this.setupRealtimeSync();
                    await this.syncWithSupabase(true);
                    this.renderDashboard();
                } else {
                    document.getElementById('user-selection')?.classList.remove('hidden');
                    this.renderUserSelection();
                }
            } else {
                document.getElementById('user-selection')?.classList.remove('hidden');
                this.renderUserSelection();
            }

        } catch (e) {
            console.error("Init Error:", e);
            document.getElementById('loader')?.classList.add('hidden');
        }
    }

    setupRealtimeSync() {
        const channelId = `mision_${Math.random().toString(36).slice(2, 7)}`;
        if (this.channel) this.sb.removeChannel(this.channel);
        
        this.channel = this.sb.channel(channelId)
            // Listen for Global Config changes
            .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, payload => {
                if (payload.new) {
                    this.state.currentDay = payload.new.current_day || this.state.currentDay;
                    this.state.earnings = payload.new.earnings || this.state.earnings;
                    this.renderDashboard();
                }
            })
            // Listen for INDIVIDUAL task changes (The granular part!)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, payload => {
                if (payload.new) {
                    this.handleRealtimeTaskUpdate(payload.new);
                }
            })
            .subscribe(status => {
                if (status === 'SUBSCRIBED') this.setSyncIndicator('success');
                else if (status === 'CHANNEL_ERROR') this.setSyncIndicator('error', 'Error de canal Real-time');
            });
    }

    async syncWithSupabase(isInitial = false) {
        if (!isInitial) this.showSyncStatus("Sincronizando...");
        try {
            // 1. Fetch Global Config (ID 1)
            const { data: configData, error: configError } = await this.sb
                .from('config').select('current_day, earnings, generation_id').eq('id', 1).single();
            
            if (configError && configError.code !== 'PGRST116') throw configError;

            // 2. Fetch All Tasks from the NEW granular table
            const { data: cloudTasks, error: tasksError } = await this.sb
                .from('tasks').select('*').order('id', { ascending: true });
            
            if (tasksError) throw tasksError;

            if (configData) {
                // Ya no confiamos en configData.current_day para obligarlo. 
                // Lo hacemos 100% automático por fecha.
                this.state.currentDay = this.getAutomaticCurrentDay();
                this.state.earnings = configData.earnings || this.state.earnings;
                this.state.generationId = configData.generation_id || this.state.generationId;
            } else {
                this.state.currentDay = this.getAutomaticCurrentDay();
            }

            if (cloudTasks && cloudTasks.length > 0) {
                // Map DB columns to our local state structure
                this.state.tasks = cloudTasks.map(t => ({
                    id: t.id,
                    day: t.day,
                    assigneeId: t.assignee_id,
                    name: t.name,
                    type: t.type,
                    status: t.status,
                    baseReward: t.base_reward,
                    validation: t.validation
                }));
            } else if (isInitial && this.state.tasks.length > 0) {
                // If cloud is empty but local has tasks, migrate them to the new table
                console.log("Migrating local tasks to granular table...");
                await this.pushAllTasksToCloud();
            }

            this.saveData(false); // Update local cache
            this.renderDashboard();
            if (!isInitial) this.showSyncStatus("Sincronizado");
            this.setSyncIndicator('success');
        } catch (e) {
            console.error("Deep Sync Error:", e);
            this.setSyncIndicator('error', `Fallo de Sincro: ${e.message}`);
        }
    }

    async pushAllTasksToCloud() {
        // Migration helper: pushes all local tasks as individual rows
        try {
            const rows = this.state.tasks.map(t => ({
                id: t.id, day: t.day, assignee_id: t.assigneeId, 
                name: t.name, type: t.type, status: t.status, 
                base_reward: t.baseReward, validation: t.validation
            }));
            
            const { error } = await this.sb.from('tasks').upsert(rows);
            if (error) throw error;
            
            // Push global config too
            await this.pushGlobalConfig();
        } catch (e) {
            console.error("Migration Fail:", e);
        }
    }

    async pushGlobalConfig() {
        try {
            const { error } = await this.sb.from('config').upsert({
                id: 1, // Corrected from 'global' to 1 for consistency
                current_day: this.state.currentDay, 
                earnings: this.state.earnings,
                generation_id: this.state.generationId
            });
            if (error) throw error;
            this.logDebug("Config global OK");
        } catch (e) { 
            this.logDebug("Error Config: " + e.message);
            console.error("Global push fail:", e); 
        }
    }

    async pushTaskUpdate(taskId) {
        const task = this.state.tasks.find(t => t.id === taskId);
        if (!task) return;

        try {
            this.setSyncIndicator('syncing');
            this.logDebug(`Subiendo tarea ${taskId}...`);
            const { error } = await this.sb.from('tasks').upsert({
                id: task.id, 
                day: task.day, 
                assignee_id: task.assigneeId,
                name: task.name, 
                type: task.type, 
                status: task.status, 
                base_reward: task.baseReward,
                validation: task.validation
            });

            if (error) throw error;
            this.logDebug(`✅ Tarea ${taskId} ok`);
            this.setSyncIndicator('success');
        } catch (e) {
            this.logDebug(`❌ Error Tarea: ${e.message}`);
            this.setSyncIndicator('error', 'Fallo al guardar tarea');
        }
    }

    logDebug(msg) {
        const log = document.getElementById('debug-log');
        if (log) {
            log.innerHTML += `<br>[${new Date().toLocaleTimeString()}] ${msg}`;
            log.scrollTop = log.scrollHeight;
        }
        console.log("DEBUG:", msg);
    }

    // Keep original pushToSupabase for massive changes (like resets)
    async pushToSupabase() {
        this.setSyncIndicator('syncing');
        await this.pushAllTasksToCloud();
    }

    setSyncIndicator(status, errorMsg = '') {
        this.lastSyncError = errorMsg;
        const dots = document.querySelectorAll('.sync-dot');
        dots.forEach(dot => {
            dot.className = 'sync-dot ' + status;
            dot.onclick = () => {
                if (this.lastSyncError) this.showAlert("Estado Sincro", this.lastSyncError);
            };
            dot.style.cursor = errorMsg ? 'pointer' : 'default';
        });
    }

    mergeData(cloudData, isInitial = false, isQuiet = false) {
        // This method is now legacy as we sync via tables, but kept for deep compatibility
        if (!cloudData) return;
        this.renderDashboard();
    }

    // NEW: Handle real-time updates for individual tasks
    handleRealtimeTaskUpdate(cloudTask) {
        // Map cloud snake_case to local camelCase
        const incomingTask = {
            id: cloudTask.id, 
            day: cloudTask.day, 
            assigneeId: cloudTask.assignee_id,
            name: cloudTask.name, 
            type: cloudTask.type, 
            status: cloudTask.status,
            baseReward: parseFloat(cloudTask.base_reward), 
            validation: cloudTask.validation
        };

        const idx = this.state.tasks.findIndex(t => t.id === incomingTask.id);

        if (idx === -1) {
            this.logDebug(`Recibida tarea nueva nube: ${incomingTask.id}`);
            this.state.tasks.push(incomingTask);
        } else {
            this.logDebug(`Actualizada tarea nube: ${incomingTask.id} -> ${incomingTask.status}`);
            this.state.tasks[idx] = incomingTask;
        }
        this.saveData(false);
        this.renderDashboard();
    }

    async validateTask(taskId, quality, attitude, penalty = 0) {
        const idx = this.state.tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return;

        const task = this.state.tasks[idx];
        const multiplier = (quality + attitude) / 2;
        const totalReward = Math.max(0, (task.baseReward * multiplier) - penalty);

        this.state.tasks[idx].status = 'validated';
        this.state.tasks[idx].validation = { quality, attitude, penalty, totalReward };
        
        // Update earnings
        if (task.assigneeId) {
            this.state.earnings[task.assigneeId] = (this.state.earnings[task.assigneeId] || 0) + totalReward;
        }

        this.saveData(false);
        this.renderDashboard();
        
        // Atomic Cloud Pushes
        await this.pushTaskUpdate(taskId);
        await this.pushGlobalConfig();
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
        try {
            const saved = localStorage.getItem('mision_9_dias_data');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object') {
                    // Safe merge: keep defaults if property is missing in saved
                    this.state = { ...this.state, ...parsed };
                }
            }
        } catch (e) {
            console.error("LoadData failed:", e);
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
                // DETERMINISTIC ID: day + index + type
                // This ensures all devices generate the SAME ID for the same task
                const deterministicId = `d${d}-i${index}-${t.type}`;
                allTasks.push({
                    id: deterministicId,
                    name: t.name,
                    day: d,
                    type: t.type,
                    assigneeId: t.assigneeId || null,
                    baseReward: t.baseReward,
                    status: 'pending',
                    validation: null
                });
            });
        }
        this.state.tasks = allTasks;
        this.saveData(); // This pushes them with deterministic IDs
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
        
        let promptText = "Tu PIN:";
        if (user.role === 'admin') promptText = "PIN de acceso para Papás:";
        else promptText = `Introduce el PIN para el perfil de ${user.name}:`;

        const pin = await this.showPrompt("Acceso Seguro", promptText, "PIN numérico");
        if (!pin) return;

        // Iniciar sesión con Supabase en background
        const loader = document.getElementById('loader');
        if (loader) loader.classList.remove('hidden');
        
        let { data, error } = await this.sb.auth.signInWithPassword({
            email: user.email,
            password: 'pin' + pin
        });

        // Intentar la contraseña tal cual la escribieron por si la configuraron diferente en Supabase
        if (error && error.message === 'Invalid login credentials') {
            const tempResponse = await this.sb.auth.signInWithPassword({
                email: user.email,
                password: pin
            });
            if (!tempResponse.error) {
                data = tempResponse.data;
                error = null;
            }
        }

        if (loader) loader.classList.add('hidden');

        if (error) {
            this.showAlert("Error de Acceso", `Supabase dice: ${error.message} (Asegúrate de que su correo en Supabase es ${user.email} y que la contraseña y confirmaciones de email sean correctas)`);
            console.error("Login auth error:", error);
            return;
        }

        this.state.currentUser = user;
        document.getElementById('user-selection').classList.add('hidden');
        document.getElementById('dashboard').classList.remove('hidden');
        
        // Iniciar Sincronización post-login
        this.setupRealtimeSync();
        await this.syncWithSupabase(true);
        this.renderDashboard();
    }

    async logout() {
        if (this.channel) {
            this.sb.removeChannel(this.channel);
            this.channel = null;
        }
        await this.sb.auth.signOut();
        
        this.state.currentUser = null;
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('user-selection').classList.remove('hidden');
        this.renderUserSelection();
    }

    renderDashboard() {
        const user = this.state.currentUser;
        document.getElementById('current-user-name').innerText = user.name;
        
        // Refrescar el día dinámico en cada renderizado por si han pasado las 00:00
        this.state.currentDay = this.getAutomaticCurrentDay();
        document.getElementById('day-counter').innerText = `Día ${this.state.currentDay}/9`;
        
        // Renderizar la fecha real en la cabecera de las tareas
        const dateElem = document.getElementById('current-date');
        if (dateElem) {
            const options = { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' };
            let displayDate = new Intl.DateTimeFormat('es-ES', options).format(new Date());
            displayDate = displayDate.charAt(0).toUpperCase() + displayDate.slice(1);
            dateElem.innerText = displayDate;
        }
        
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

        // Global version indicator at the bottom
        this.renderVersionFooter();
    }

    renderVersionFooter() {
        let footer = document.getElementById('app-footer-version');
        if (!footer) {
            footer = document.createElement('div');
            footer.id = 'app-footer-version';
            footer.style.textAlign = 'center';
            footer.style.fontSize = '0.6rem';
            footer.style.opacity = '0.3';
            footer.style.marginTop = '40px';
            footer.style.paddingBottom = '20px';
            document.getElementById('dashboard').appendChild(footer);
        }
        footer.innerText = 'v6.2.0 · Supabase Real-time (Granular)';
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

    adminNextDay() {
        if (this.state.adminViewDay < 9) {
            this.state.adminViewDay++;
            this.renderDashboard();
        }
    }

    adminPrevDay() {
        if (this.state.adminViewDay > 1) {
            this.state.adminViewDay--;
            this.renderDashboard();
        }
    }

    // Ya no las usan los hijos
    nextDay() { }
    prevDay() { }

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
        // Cálculo dinámico puro desde la base de datos de tareas
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

        // Lógica de Constancia (Bonus de 5€) si han completado sus 9 días fijos
        const fixedTasks = this.state.tasks.filter(t => t.assigneeId === userId && t.type === 'fixed');
        const allValidated = fixedTasks.length === 9 && fixedTasks.every(t => t.status === 'validated');
        
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
        return `<button class="btn-done" onclick="window.app.markTaskDone('${task.id}')">Hecho</button>`;
    }

    async markTaskDone(taskId) {
        const idx = this.state.tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return;

        this.state.tasks[idx].status = 'done';
        if (!this.state.tasks[idx].assigneeId) {
            this.state.tasks[idx].assigneeId = this.state.currentUser.id;
        }
        this.saveData(false); // Save locally 
        this.renderDashboard();
        
        // Granular Cloud Push
        await this.pushTaskUpdate(taskId);
        await this.showAlert("¡Hecho!", "✓ Tarea marcada. Espera a que Papá la valide.");
    }

    renderAdminPanel() {
        const adminPanel = document.getElementById('admin-panel');
        if (!adminPanel) return;

        const scrollPos = window.scrollY; // SAVE SCROLL
        const unvalidatedTasks = this.state.tasks.filter(t => t.day === this.state.adminViewDay && t.status !== 'validated');

        // Only update the controls part IF not already there to avoid flickering
        let controlsHtml = `
            <div class="admin-controls">
                <div class="day-selector">
                    <button onclick="window.app.adminPrevDay()">◀</button>
                    <span>Viendo Día ${this.state.adminViewDay}</span>
                    <button onclick="window.app.adminNextDay()">▶</button>
                </div>
                <div class="quick-actions">
                    <div id="sync-indicator" style="font-size:0.7rem; text-align:center; color:var(--text-muted); margin-bottom:10px; transition: opacity 0.5s">Sincronizado</div>
                    <button class="btn-save" style="background:#4CAF50" onclick="window.app.syncWithSupabase()">🔄 Sincronizar Ahora</button>
                    <button class="btn-save" style="background:#8E735B" onclick="window.app.renderRequestExtraModal()">+ Añadir Extra/Sorpresa</button>
                    <button class="btn-save" style="background:#D32F2F; border: 3px solid white" onclick="window.app.nuclearReset()">☢️ ALINEAR TODA LA FAMILIA (Nuclear)</button>
                    
                    <details style="margin-top:15px; color:var(--text-muted); font-size:0.9rem">
                        <summary style="cursor:pointer">⚙️ Opciones Avanzadas</summary>
                        <div id="debug-log" style="font-size:0.5rem; background:rgba(0,0,0,0.2); padding:5px; margin-top:5px; max-height:100px; overflow-y:auto; font-family:monospace">Logs de Sincro: Iniciado v6.2.0</div>
                        <div style="display:flex; flex-direction:column; gap:10px; margin-top:10px">
                            <div style="display:flex; gap:10px">
                                <button class="btn-save" style="background:#455A64; flex:1; font-size:0.8rem" onclick="window.app.exportData()">📤 Exportar</button>
                                <button class="btn-save" style="background:#455A64; flex:1; font-size:0.8rem" onclick="window.app.importData()">📥 Importar</button>
                            </div>
                            <button class="btn-save" style="background:#607D8B; font-size:0.8rem" onclick="window.app.clearLocalAndSync()">🔄 Forzar Recuperación Nube</button>
                        </div>
                    </details>
                </div>
            </div>
            
            <div class="admin-ranking">
                <h3>🏆 Posiciones Actuales</h3>
                ${this.renderRanking()}
            </div>

            <h3 style="margin-top:20px">📥 Validaciones Pendientes</h3>
        `;

        let listHtml = '';
        if (unvalidatedTasks.length === 0) {
            listHtml = '<p class="text-muted">No hay tareas pendientes para este día.</p>';
        } else {
            listHtml = unvalidatedTasks.map(t => {
                const user = USERS.find(u => u.id === t.assigneeId);
                const isPending = t.status === 'pending';
                return `
                    <div class="task-card ${isPending ? 'task-disabled' : ''}" style="opacity: ${isPending ? 0.7 : 1}">
                        <div class="task-main">
                            <span class="task-name">${t.name}</span>
                            <span class="user-badge">${user ? user.name : 'Libre (Asigna al Validar)' } ${user ? user.icon : '❓'}</span>
                        </div>
                        <div class="task-action">
                            ${isPending ? '<span class="limit-msg" style="margin-right:10px">No Marcada</span>' : ''}
                            <button class="btn-done active" onclick="window.app.openValidationModal('${t.id}')">Validar</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        const validated = this.state.tasks.filter(t => t.day === this.state.adminViewDay && t.status === 'validated');
        let historyHtml = `
            <h3 style="margin-top:30px">✅ Registro del Día ${this.state.adminViewDay}</h3>
            <div class="tasks-grid">
                ${validated.length === 0 ? '<p class="text-muted">No hay tareas validadas hoy.</p>' : 
                    validated.map(t => {
                        const user = USERS.find(u => u.id === t.assigneeId);
                        const v = t.validation || {};
                        const stars = '⭐'.repeat(v.quality || 0);
                        const attitude = v.attitude === 3 ? '😊' : (v.attitude === 1 ? '😠' : '😐');
                        return `
                            <div class="task-card status-done" style="opacity: 0.8">
                                <div class="task-main">
                                    <span class="task-name">${t.name}</span>
                                    <span class="user-badge">${user ? user.name : '?' }</span>
                                    <div style="font-size:0.75rem; color:var(--text-muted)">
                                        ${stars} ${attitude} 💰 ${v.totalReward ? v.totalReward.toFixed(2) : '?' }€
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('')
                }
            </div>
        `;
        
        // Final Assembly
        adminPanel.innerHTML = `
            <div class="section-title"><h2>Panel de Control</h2></div>
            ${controlsHtml}
            <div id="pending-validation-list" class="tasks-grid">
                ${listHtml}
            </div>
            <div id="validated-history-list">
                ${historyHtml}
            </div>
        `;
        
        window.scrollTo(0, scrollPos);
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

    // Removed obsolete saveCloudUrl method as we now use Supabase constants


    async addExtraTask(assigneeId, name, reward) {
        const newTask = {
            id: `extra-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            name: name,
            day: this.state.currentDay,
            type: 'extra',
            assigneeId: assigneeId,
            baseReward: parseFloat(reward),
            status: 'pending',
            validation: null
        };

        this.state.tasks.push(newTask);
        this.saveData(false);
        this.renderDashboard();
        
        await this.pushTaskUpdate(newTask.id);
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

        let assigneeSelectHtml = '';
        if (!task.assigneeId) {
            assigneeSelectHtml = `
                <label style="color:#d32f2f; font-weight:bold">¿Quién realizó esta tarea libre?</label>
                <select id="modal-assignee-select" class="modal-input" style="width:100%; margin-bottom:15px; padding:10px; border-radius:5px">
                    ${USERS.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
                </select>
            `;
        }
        
        content.innerHTML = `
            <h2>Validar Tarea</h2>
            <div class="task-info-brief">
                <span class="task-name">${task.name}</span>
                <span class="user-badge">${task.assigneeId ? USERS.find(u => u.id === task.assigneeId).name : 'Pendiente Asignar'}</span>
            </div>
            
            <div class="validation-form">
                ${assigneeSelectHtml}
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

    async validateTask(taskId) {
        const idx = this.state.tasks.findIndex(t => t.id === taskId);
        if (idx === -1) return;

        const selectElem = document.getElementById('modal-assignee-select');
        if (selectElem && !this.state.tasks[idx].assigneeId) {
            this.state.tasks[idx].assigneeId = selectElem.value;
        }

        const task = this.state.tasks[idx];
        const penalty = parseFloat(document.getElementById('input-penalty').value) || 0;
        
        task.status = 'validated';
        task.validation = {
            quality: this.tempValidation.quality,
            attitude: this.tempValidation.attitude,
            penalty: penalty
        };

        // 1. Calcular recompensa final e inyectarla en la bóveda de ganancias histórica
        const qBonus = this.tempValidation.quality === 3 ? 0.25 : 0.0;
        let aBonus = 0;
        if (this.tempValidation.attitude === 3) aBonus = 0.25;
        else if (this.tempValidation.attitude === 1) aBonus = -0.50;
        
        const totalReward = task.baseReward + qBonus + aBonus - penalty;
        
        if (task.assigneeId) {
            this.state.earnings[task.assigneeId] = (this.state.earnings[task.assigneeId] || 0) + Math.max(0, totalReward);
        }

        // 2. SAVE LOCAL (Instant)
        this.saveData(false); 
        this.closeModal();
        this.renderDashboard();
        this.showFeedback('Tarea validada con éxito.');

        // 3. SYNC CLOUD (Background/Granular)
        await this.pushTaskUpdate(taskId);
        await this.pushGlobalConfig();
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
            this.saveData(false);
            this.renderDashboard();
            
            // GRANULAR PUSH (v8.6)
            await this.pushTaskUpdate(newTask.id);
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

    async clearLocalAndSync() {
        const confirm = await this.showConfirm("🔄 Forzar Recuperación", "¿Quieres borrar los datos locales y descargar todo de nuevo desde la nube? (Útil si un móvil no se sincroniza bien)");
        if (!confirm) return;
        
        localStorage.removeItem('mision_9_dias_data');
        this.showSyncStatus("Limpiando...");
        await this.syncWithSupabase(true);
        this.renderDashboard();
        await this.showAlert("Recuperado", "✓ Datos locales limpiados y sincronizados con la nube.");
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

    async nuclearReset() {
        if (!confirm("☢️ ¡PELIGRO NUCLEAR! Esto borrará todas las tareas de la nube y alineará los IDs de todos los móviles. Usa esto solo si los niños ven cosas distintas a ti. ¿Continuar?")) return;
        
        try {
            this.setSyncIndicator('syncing');
            // 1. Wipe cloud tasks
            await this.sb.from('tasks').delete().neq('id', 'void');
            
            // 2. Reset global config
            this.state.currentDay = 1;
            this.state.earnings = { julia: 0, alex: 0, sam: 0 };
            this.state.generationId = Date.now();
            await this.pushGlobalConfig();

            // 3. Clear local and regenerate with deterministic IDs
            this.state.tasks = [];
            this.generateAllDaysTasks(); 
            
            await this.pushToSupabase();
            
            await this.showAlert("Éxito Nuclear", "✓ IDs alineados. Pide a todos que cierren y abran la App.");
            location.reload();
        } catch (e) {
            console.error("Nuclear reset failed:", e);
            this.showAlert("Error", "Fallo en el reset nuclear.");
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
window.addEventListener('load', () => {
    console.log("Misión Kora: Iniciando...");
    if (typeof supabase === 'undefined') {
        alert("Error: No se ha podido cargar el motor de Supabase. Reintenta o comprueba tu conexión.");
        return;
    }
    window.app = new App();
});
