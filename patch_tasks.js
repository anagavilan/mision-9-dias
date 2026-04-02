const fs = require('fs');
let code = fs.readFileSync('/Users/anagavilan/Documents/AntiGravity/AppPuntos/app_v8.js', 'utf8');

// 1. Fix Admin Button in renderAdminPanel
code = code.replace(/window\.app\.renderRequestExtraModal\(\)/g, "window.app.createSurpriseTask()");

// 2. Child requestExtraTask
const requestExtraFn = `
    async requestExtraTask() {
        const text = await this.showPrompt("Tarea Extra", "¿Qué tarea extra quieres proponer (que no esté en la lista normal)?", "");
        if (!text || text.trim() === '') return;
        
        const newTask = {
            id: \`extra-req-\${Date.now()}\`,
            name: text.trim(),
            day: this.state.currentDay,
            type: 'extra',
            assigneeId: this.state.currentUser.id,
            baseReward: 0,
            status: 'pending',
            validation: null
        };
        this.state.tasks.push(newTask);
        this.saveData(false);
        this.renderDashboard();
        await this.pushTaskUpdate(newTask.id);
        await this.showAlert("Añadida", \`¡Tarea "\${newTask.name}" añadida a tu lista!\`);
    }

    async createSurpriseTask() {
        const name = await this.showPrompt("Tarea Sorpresa", "Nombre o descripción de la Tarea Sorpresa:", "");
        if (!name || name.trim() === '') return;
        
        const amountStr = await this.showPrompt("Importe Fijo", "¿Cuántos euros exactos vale esta tarea? (ej. 2.50)", "1.00");
        const amount = parseFloat(amountStr);
        if (isNaN(amount)) return;
        
        const newTask = {
            id: \`sorpresa-\${Date.now()}\`,
            name: '🎁 ' + name.trim(),
            day: this.state.adminViewDay,
            type: 'sorpresa',
            assigneeId: null, // Que la validen o reclamen quien la haga
            baseReward: amount,
            status: 'pending',
            validation: null
        };
        this.state.tasks.push(newTask);
        this.saveData(false);
        this.renderDashboard();
        await this.pushTaskUpdate(newTask.id);
        await this.showAlert("Creada", "Tarea sorpresa creada para el Día " + this.state.adminViewDay);
    }
`;

// Replace the old requestExtraTask with the new block.
const rxStart = code.indexOf('async requestExtraTask() {');
const rxEnd = code.indexOf('async rejectTask(taskId) {');

code = code.substring(0, rxStart) + requestExtraFn + "\n    " + code.substring(rxEnd);

// 3. Update Validation Modal 
// We want to hide stars for 'sorpresa' and show baseReward override for 'extra'
const validateModalStart = code.lastIndexOf('openValidationModal(taskId) {');
code = code.replace(/<div class="validation-form">[\s\S]*?<label>Calidad del Resultado/, 
`<div class="validation-form">
                \${assigneeSelectHtml}
                
                \${task.type === 'sorpresa' ? \`
                    <div style="background:#f5f5f5; padding:15px; border-radius:5px; margin-bottom:15px; text-align:center">
                        <strong>Recompensa Fija: \${task.baseReward}€</strong><br>
                        (Las tareas sorpresa no suman extras de calidad ni actitud)
                    </div>
                \` : \`
                    \${task.type === 'extra' ? \`
                        <label>Recompensa Base a asignar (€)</label>
                        <input type="number" id="input-base-reward" value="0.5" step="0.1" min="0" style="margin-bottom:15px">
                    \` : ''}
                    <label>Calidad del Resultado (1-3 Estrellas)`);

// 4. Also hide the attitude and penalty if it's 'sorpresa'
code = code.replace(/<label>Calidad del Resultado/g, 
`\${task.type === 'sorpresa' ? '' : \`<label>Calidad del Resultado`);

code = code.replace(/<div class="modal-actions">/g, 
`\` } <div class="modal-actions">`);

// 5. Update validateTask logic
code = code.replace(/const penalty = parseFloat\(document.getElementById\('input-penalty'\).value\) \|\| 0;/,
`const penalty = document.getElementById('input-penalty') ? (parseFloat(document.getElementById('input-penalty').value) || 0) : 0;
        const baseOverride = document.getElementById('input-base-reward') ? parseFloat(document.getElementById('input-base-reward').value) : null;
        if (baseOverride !== null && !isNaN(baseOverride)) {
            task.baseReward = baseOverride;
        }`);

code = code.replace(/const qBonus = this\.tempValidation\.quality === 3 \? 0\.25 : 0\.0;/,
`let qBonus = 0;
        let aBonus = 0;
        if (task.type !== 'sorpresa') {
            qBonus = this.tempValidation.quality === 3 ? 0.25 : 0.0;
            if (this.tempValidation.attitude === 3) aBonus = 0.25;
            else if (this.tempValidation.attitude === 1) aBonus = -0.50;
        }`);
code = code.replace(/let aBonus = 0;[\s\S]*?else if \(this.tempValidation.attitude === 1\) aBonus = -0\.50;/, '');

fs.writeFileSync('/Users/anagavilan/Documents/AntiGravity/AppPuntos/app_v8.js', code);
