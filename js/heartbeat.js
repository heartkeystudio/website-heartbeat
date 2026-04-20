// ==========================================
// HEARTBEAT.JS - MIDDLEWARE CENTRALIZADO
// ==========================================

// --- ESTADOS GLOBAIS ---
window.hbAtualId = null;
window.hbEventsCache = {};
window.hbFoldersCache = [];
window.hbEventsList = [];
window.hbPastasFechadas = new Set();
window.ultimaPastaHB = null;
window.hbTimeout = null;
window.itensSelecionadosHB = [];
window.lixeiraAbertaHB = false;
window.hbSortMode = localStorage.getItem('hb_sort') || 'manual';
window.godotAudioFiles = []; // INICIALIZADO VAZIO PARA EVITAR CRASH

// --- FUNÇÃO DE NOTIFICAÇÃO (CORREÇÃO DO ERRO) ---
window.mostrarToastNotificacao = (titulo, mensagem, tipo) => {
    console.log(`%c[${titulo}] ${mensagem}`, "color: var(--primary); font-weight: bold;");
};

// ==========================================
// GERENCIADOR DE CONEXÃO (BRIDGE / WEBSOCKET)
// ==========================================

window.limparCaminhoRes = (path) => {
    if (!path) return "";
    let p = path.replace(/\\/g, '/');
    const marcador = "/data/";
    const index = p.indexOf(marcador);
    if (index !== -1) return "res://" + p.substring(index + marcador.length);

        if (p.includes("res://")) {
            const partes = p.split("res://");
            let final = partes[partes.length - 1];
            if (final.includes(":/")) {
                const subPartes = final.split("/");
                return "res://" + subPartes[subPartes.length - 1];
            }
            return "res://" + final;
        }
        return p;
};

window.updateConnectionStatus = (statusStr, color, bgColor) => {
    const badge = document.getElementById('connection_badge');
    const led = document.getElementById('connection_led');
    const text = document.getElementById('connection_text');
    if (badge && led && text) {
        badge.style.color = color;
        badge.style.borderColor = color;
        badge.style.background = bgColor;
        led.style.background = color;
        led.style.boxShadow = `0 0 8px ${color}`;
        text.innerText = statusStr;
    }
};

window.conectarWebSocket = () => {
    if (window.wsHeartBeat) {
        window.wsHeartBeat.onopen = null;
        window.wsHeartBeat.onmessage = null;
        window.wsHeartBeat.onclose = null;
        window.wsHeartBeat.onerror = null;
        window.wsHeartBeat.close();
    }

    window.wsHeartBeat = new WebSocket('ws://localhost:8088');

    window.wsHeartBeat.onopen = () => {
        console.log("🔌 HeartBeat Studio: WebSocket Online!");
        if (!window.HeartBeatAPI.godotCallback) {
            window.updateConnectionStatus('WEBSOCKET ONLINE', 'var(--primary)', '#112233');
        }
        window.wsHeartBeat.send(JSON.stringify({ type: "request_files" }));
    };

    window.wsHeartBeat.onmessage = (event) => {
        try {
            const parsed = JSON.parse(event.data);

            // 🚨 CORREÇÃO DA LISTA DE ARQUIVOS
            if (parsed.type === "file_list") {
                const dataArray = Array.isArray(parsed.data) ? parsed.data : (parsed.files || []);
                window.godotAudioFiles = dataArray.map(f => window.limparCaminhoRes(f));
                if (window.renderizarFileBrowser) window.renderizarFileBrowser();
            }
            if (parsed.type === "vu_meter") {
                for (const [bus, db] of Object.entries(parsed.data || {})) {
                    const bar = document.getElementById('vu_bar_' + bus);
                    if (bar) bar.style.width = Math.min(100, Math.max(0, ((db + 60) / 60) * 100)) + '%';
                }
            }
        } catch(e) { console.error("Erro no processamento:", e); }
    };

    window.wsHeartBeat.onclose = () => {
        if (!window.HeartBeatAPI.godotCallback) {
            window.updateConnectionStatus('OFFLINE', '#ff5252', '#331111');
        }
    };
};

// --- API DO JAVASCRIPT BRIDGE (NATIVO HTML5) ---
window.HeartBeatAPI = {
    godotCallback: null,
    connectGodot: function(callback) {
        console.log("🟢 Godot conectado via JavaScriptBridge!");
        this.godotCallback = callback;
        window.updateConnectionStatus('JS BRIDGE (NATIVO)', 'var(--primary)', '#113311');
        this.sendToGodot("sync_bank", window.gerarSoundBankJSON());
        this.sendToGodot("request_files", {});
    },
    sendToGodot: function(type, data) {
        if (this.godotCallback) {
            this.godotCallback(JSON.stringify({ type: type, data: data }));
        }
    }
};

// 🚨 NOVA FUNÇÃO PARA O GODOT HTML5 ENVIAR DADOS DE VOLTA
window.receiveFromGodot = (jsonStr) => {
    try {
        const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
        if (parsed.type === "file_list") {
            const dataArray = Array.isArray(parsed.data) ? parsed.data : (parsed.files || []);
            window.godotAudioFiles = dataArray.map(f => window.limparCaminhoRes(f));
            if (window.renderizarFileBrowser) window.renderizarFileBrowser();
        }
    } catch(e) { console.error("Erro no JS Bridge Receive:", e); }
};

window.hbMixerState = { buses: { Master: 0, Music: 0, SFX: 0, Ambience: 0, UI: 0, Voice: 0 }, dsp_nodes: [], modules: {} };
window.cableSystem = { isDragging: false, startJack: null, tempLine: null, colors: ['#ff5252', '#00f2ff', '#4eb5fe', '#ffeb3b', '#e04efe'] };
window.knobSystem = { activeKnob: null, startY: 0, startValue: 0, sensitivity: 0.005 };

const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
const setDisplay = (id, disp) => { const el = document.getElementById(id); if (el) el.style.display = disp; };
const setChecked = (id, check) => { const el = document.getElementById(id); if (el) el.checked = check; };
const getVal = (id, def) => { const el = document.getElementById(id); return el ? el.value : def; };
const getFloat = (id, def) => { const el = document.getElementById(id); return el && !isNaN(parseFloat(el.value)) ? parseFloat(el.value) : def; };
const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };
const gerarIDLocal = () => 'hb_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

window.salvarBancoLocal = () => {
    if (!window.projetoAtualId) return;
    localStorage.setItem('hb_bank_' + window.projetoAtualId, JSON.stringify({ pastas: window.hbFoldersCache, eventos: window.hbEventsList }));
    localStorage.setItem('hb_mixer_' + window.projetoAtualId, JSON.stringify(window.hbMixerState));
};

window.carregarHeartBeatDoProjeto = (pid) => {
    const savedBank = localStorage.getItem('hb_bank_' + pid);
    const savedMixer = localStorage.getItem('hb_mixer_' + pid);

    if (savedBank) {
        const parsed = JSON.parse(savedBank);
        window.hbFoldersCache = parsed.pastas || [];
        window.hbEventsList = parsed.eventos || [];
        window.hbEventsList.forEach(ev => { window.hbEventsCache[ev.id] = ev; });
    }
    if (savedMixer) window.hbMixerState = JSON.parse(savedMixer);

    window.renderizarHeartBeatTree();
    window.carregarUI_Mixer();
    window.sincronizarMixer();
    window.sincronizarBank();
};

window.gerarSoundBankJSON = () => {
    let finalBank = { "engine": "HeartBeat AS", "version": "1.0", "mixer": window.hbMixerState, "events": {} };
    window.hbEventsList.filter(ev => ev.pastaId !== 'trash').forEach(ev => {
        let evtData = { "type": ev.type, "bus": ev.bus || "SFX", "base_volume_db": ev.base_volume_db || 0.0 };
        if (ev.ducking?.active) evtData.ducking = { "target": ev.ducking.target, "db_drop": ev.ducking.db_drop, "fade_time": ev.ducking.fade_time };
        if (ev.rtpc?.active) evtData.rtpc = { "param": ev.rtpc.param, "target": ev.rtpc.target, "in_min": ev.rtpc.in_min, "in_max": ev.rtpc.in_max, "out_min": ev.rtpc.out_min, "out_max": ev.rtpc.out_max };

        if (ev.type === "music_dynamic") { evtData.bus = ev.bus || "Music"; evtData.parameter = "intensity"; evtData.layers = ev.audio_clips || []; }
        else if (ev.type === "sequence") { evtData.spatial = ev.spatial || "global"; evtData.max_distance = ev.max_distance || 2000; evtData.pitch_randomize = { "min": ev.pitch_min || 1.0, "max": ev.pitch_max || 1.0 }; evtData.sequence_steps = ev.sequence_steps || []; }
        else if (ev.type === "switch") { evtData.spatial = ev.spatial || "global"; evtData.max_distance = ev.max_distance || 2000; evtData.pitch_randomize = { "min": ev.pitch_min || 1.0, "max": ev.pitch_max || 1.0 }; evtData.audio_clips = ev.audio_clips || []; }
        else { evtData.spatial = ev.spatial || "global"; evtData.max_distance = ev.max_distance || 2000; evtData.audio_clips = ev.audio_clips || []; }
        finalBank.events[ev.titulo] = evtData;
    });
    return finalBank;
};

window.sincronizarBank = () => {
    const bankData = { "events": window.gerarSoundBankJSON().events };
    if (window.wsHeartBeat?.readyState === WebSocket.OPEN) window.wsHeartBeat.send(JSON.stringify({ type: "sync_bank", data: bankData }));
    if (window.HeartBeatAPI?.godotCallback) window.HeartBeatAPI.sendToGodot("sync_bank", bankData);
};

window.sincronizarMixer = () => {
    const mixerData = { "mixer": window.hbMixerState };
    if (window.wsHeartBeat?.readyState === WebSocket.OPEN) window.wsHeartBeat.send(JSON.stringify({ type: "sync_mixer", data: mixerData }));
    if (window.HeartBeatAPI?.godotCallback) window.HeartBeatAPI.sendToGodot("sync_mixer", mixerData);
};

window.exportarApenasBank = () => downloadJSON({ "engine": "HeartBeat AS", "events": window.gerarSoundBankJSON().events }, "heartbeat_bank.json");
window.exportarApenasMixer = () => downloadJSON({ "engine": "HeartBeat AS", "mixer": window.hbMixerState }, "heartbeat_mixer.json");
function downloadJSON(obj, name) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(obj, null, 2));
    const node = document.createElement('a'); node.setAttribute("href", dataStr); node.setAttribute("download", name);
    document.body.appendChild(node); node.click(); node.remove();
}

window.abrirEventoHeartBeat = (id) => {
    window.hbAtualId = id; localStorage.setItem('heartkey_ultimo_hb_id', id);
    const data = window.hbEventsCache[id]; if (!data) return;

    setDisplay('empty_state', "none"); setDisplay('editor_ui', "block");
    setVal('ev_type', data.type === "music_dynamic" ? "music" : (data.type === "switch" ? "switch" : (data.type === "sequence" ? "sequence" : "sfx")));
    setVal('ev_bus', data.bus || "Master"); setVal('ev_spatial', data.spatial || "global");
    setVal('ev_max_dist', data.max_distance || 2000); setVal('ev_vol', data.base_volume_db || 0);
    setText('vol_val', (data.base_volume_db || 0) + ' dB'); setVal('ev_pan', data.pan || 0);
    setText('pan_val', (data.pan || 0) == 0 ? 'C' : (data.pan < 0 ? 'L '+Math.abs(data.pan) : 'R '+data.pan));

    window.renderizarClipsBuilder(data); window.mudarUIHeartBeat(); window.renderizarHeartBeatTree();
};

window.salvarAlteracoesHeartBeat = () => {
    if (!window.hbAtualId) return; let evCache = window.hbEventsCache[window.hbAtualId]; if (!evCache) return;
    evCache.bus = getVal('ev_bus', 'Master'); evCache.spatial = getVal('ev_spatial', 'global');
    evCache.max_distance = getFloat('ev_max_dist', 2000); evCache.base_volume_db = getFloat('ev_vol', 0); evCache.pan = getFloat('ev_pan', 0);

    const typeInput = getVal('ev_type', 'sfx'); const nodes = document.querySelectorAll('#clips_builder_container .clip-node');

    if (typeInput === "switch") {
        evCache.type = "switch"; evCache.state_parameter = getVal('ev_state_param', 'estado_padrao').trim() || "estado_padrao"; evCache.states = {};
        let estadoAtual = "default";
        nodes.forEach(node => {
            const t = node.getAttribute('data-type');
            if (t === 'state') estadoAtual = node.querySelector('.val-state').value.trim() || 'default';
            else if (t === 'file') {
                if (!evCache.states[estadoAtual]) evCache.states[estadoAtual] = [];
                evCache.states[estadoAtual].push({ file: node.querySelector('.val-file').value, weight: parseFloat(node.querySelector('.val-weight').value) });
            }
        });
    } else if (typeInput === "sequence") {
        evCache.type = "sequence"; evCache.sequence_steps = [];
        nodes.forEach(node => {
            const t = node.getAttribute('data-type');
            if (t === 'delay') evCache.sequence_steps.push({ action: "delay", time: parseFloat(node.querySelector('.val-time').value) });
            else if (t === 'file') evCache.sequence_steps.push({ action: "play", file: node.querySelector('.val-file').value });
        });
    } else {
        evCache.type = typeInput === "music" ? "music_dynamic" : "sfx"; evCache.audio_clips = [];
        nodes.forEach(node => {
            if (node.getAttribute('data-type') === 'file') {
                const cleanPath = window.limparCaminhoRes(node.querySelector('.val-file').value);
                if (typeInput === "music") evCache.audio_clips.push(cleanPath);
                else evCache.audio_clips.push({ file: cleanPath, weight: parseFloat(node.querySelector('.val-weight')?.value || 1.0) });
            }
        });
    }
    window.sincronizarMixer(); window.sincronizarBank(); window.renderizarHeartBeatTree();
    clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000);
};

window.novoEventoHeartBeat = () => {
    if (!window.projetoAtualId) return; const nomeEv = prompt("Nome do Gatilho:", "novo_evento");
    if (!nomeEv || nomeEv.trim() === "" || window.hbEventsList.find(e => e.titulo === nomeEv.trim())) return;

    const novoEvento = { id: gerarIDLocal(), titulo: nomeEv.trim().replace(/[^a-zA-Z0-9_]/g, '_'), type: "sfx", bus: "SFX", base_volume_db: 0.0, spatial: "global", max_distance: 2000, audio_clips: [], projetoId: window.projetoAtualId, pastaId: window.ultimaPastaHB, ordem: Date.now() };
    window.hbEventsList.push(novoEvento); window.hbEventsCache[novoEvento.id] = novoEvento;
    window.salvarBancoLocal(); window.sincronizarBank(); window.renderizarHeartBeatTree();
    window.abrirEventoHeartBeat(novoEvento.id); window.mudarAba('inspector');
};

window.novaPastaHeartBeat = () => {
    const nome = prompt("Nova pasta:"); if (!nome || !window.projetoAtualId) return;
    window.hbFoldersCache.push({ id: gerarIDLocal(), nome: nome, projetoId: window.projetoAtualId, parentId: window.ultimaPastaHB, ordem: Date.now() });
    window.salvarBancoLocal(); window.renderizarHeartBeatTree();
};

window.renderizarHeartBeatTree = () => {
    const container = document.getElementById('hb-tree-container'); if (!container) return;
    const pastasPorPai = { 'root': [], 'trash': [] }; window.hbFoldersCache.forEach(f => { pastasPorPai[f.parentId || 'root']?.push(f) || (pastasPorPai[f.parentId || 'root'] = [f]); });
    const arquivosPorPasta = { 'root': [], 'trash': [] }; window.hbEventsList.forEach(p => { arquivosPorPasta[p.pastaId || 'root']?.push(p) || (arquivosPorPasta[p.pastaId || 'root'] = [p]); });

    const ordenar = (arr) => arr ? arr.sort((a, b) => window.hbSortMode === 'az' ? (a.nome || a.titulo).toLowerCase().localeCompare((b.nome || b.titulo).toLowerCase()) : (a.ordem || 0) - (b.ordem || 0)) : [];
    Object.keys(pastasPorPai).forEach(k => pastasPorPai[k] = ordenar(pastasPorPai[k])); Object.keys(arquivosPorPasta).forEach(k => arquivosPorPasta[k] = ordenar(arquivosPorPasta[k]));

    const buildTree = (parentId, inTrash = false) => {
        let html = '';
        if (pastasPorPai[parentId]) pastasPorPai[parentId].forEach(f => {
            const closed = window.hbPastasFechadas.has(f.id);
            html += `<div style="margin-top: 5px;" class="${inTrash ? 'item-apagado' : ''}"><div class="wiki-folder-header ${f.id === window.ultimaPastaHB ? 'selected' : ''} wiki-node-item" data-node-type="folder" draggable="true" ondragstart="window.dragStartHB(event, '${f.id}', 'folder')" onclick="window.selecionarPastaHB(event, '${f.id}')" ondblclick="window.togglePastaHB(event, '${f.id}')" ondragover="window.dragOverHB(event)" ondragleave="window.dragLeaveHB(event)" ondrop="window.dropHB(event, '${f.id}')" oncontextmenu="window.abrirMenuContexto(event, '${f.id}', 'folder')"><div class="wiki-item-name"><span onclick="window.togglePastaHB(event, '${f.id}')">${closed ? '▶' : '▼'}</span> 📁 <span style="color: #fff; font-size: 0.8rem;">${f.nome}</span></div></div><div class="wiki-dropzone" style="display: ${closed ? 'none' : 'block'};" ondragover="window.dragOverHB(event)" ondragleave="window.dragLeaveHB(event)" ondrop="window.dropHB(event, '${f.id}')">${buildTree(f.id, inTrash)}</div></div>`;
        });
        if (arquivosPorPasta[parentId]) arquivosPorPasta[parentId].forEach(p => {
            html += `<div class="wiki-file-item ${inTrash ? 'item-apagado' : ''} ${p.id === window.hbAtualId ? 'active' : ''} wiki-node-item" data-node-type="event" draggable="true" ondragstart="window.dragStartHB(event, '${p.id}', 'event')" onclick="window.abrirEventoHeartBeat('${p.id}')" oncontextmenu="window.abrirMenuContexto(event, '${p.id}', 'event')"><div class="wiki-item-name" style="width: 100%; display: flex; justify-content: space-between;"><div><span>${p.type === 'music_dynamic' ? '🎵' : '🔊'}</span> <span style="font-size: 0.75rem;">${p.titulo}</span></div><span class="bus-tag">${p.bus}</span></div></div>`;
        });
        return html;
    };

    container.innerHTML = `<div class="wiki-root-node ${window.ultimaPastaHB === null ? 'selected' : ''}" onclick="window.ultimaPastaHB = null; window.renderizarHeartBeatTree();" ondragover="window.dragOverHB(event)" ondragleave="window.dragLeaveHB(event)" ondrop="window.dropHB(event, 'root')"><div class="wiki-item-name"><span>🎛️</span><span style="font-weight: 800; font-size: 0.75rem; color: #aaa;">MASTER BANK</span></div></div><div class="wiki-root-children wiki-dropzone" id="folder-root" ondragover="window.dragOverHB(event)" ondragleave="window.dragLeaveHB(event)" ondrop="window.dropHB(event, 'root')">${buildTree('root')}</div><div class="wiki-trash-zone wiki-dropzone" id="folder-trash" ondragover="window.dragOverHB(event)" ondragleave="window.dragLeaveHB(event)" ondrop="window.dropHB(event, 'trash')" style="padding: 10px; margin-top: 20px; border-top: 1px solid var(--border-color);"><div onclick="window.lixeiraAbertaHB = !window.lixeiraAbertaHB; window.renderizarHeartBeatTree();" style="cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 0.8rem; color: var(--danger);"><span>${window.lixeiraAbertaHB ? '▼' : '▶'} 🗑️ Lixeira</span></div><div style="display: ${window.lixeiraAbertaHB ? 'block' : 'none'}; margin-top: 10px;">${buildTree('trash', true)}<button onclick="window.esvaziarLixeiraHB()" style="width: 100%; background: transparent; border: 1px solid var(--danger); color: var(--danger); padding: 5px; margin-top: 10px; cursor: pointer; border-radius: 4px;">Esvaziar</button></div></div>`;
};

window.selecionarPastaHB = (e, fId) => { e.stopPropagation(); window.ultimaPastaHB = fId; window.renderizarHeartBeatTree(); };
window.togglePastaHB = (e, fId) => { e.stopPropagation(); window.hbPastasFechadas.has(fId) ? window.hbPastasFechadas.delete(fId) : window.hbPastasFechadas.add(fId); window.renderizarHeartBeatTree(); };
window.deletarEventoAtual = () => { if (!window.hbAtualId) return; if (confirm("Mover para lixeira?")) { window.hbEventsCache[window.hbAtualId].pastaId = 'trash'; window.salvarBancoLocal(); setDisplay('empty_state', 'block'); setDisplay('editor_ui', 'none'); window.hbAtualId = null; window.renderizarHeartBeatTree(); } };
window.esvaziarLixeiraHB = () => { if(confirm("Apagar lixeira?")) { window.hbFoldersCache = window.hbFoldersCache.filter(f => f.parentId !== 'trash'); window.hbEventsList = window.hbEventsList.filter(p => p.pastaId !== 'trash'); window.salvarBancoLocal(); window.renderizarHeartBeatTree(); } };

window.dragStartHB = (e, itemId, type) => { e.stopPropagation(); window.itensSelecionadosHB = [{ id: itemId, type: type }]; e.dataTransfer.setData("items", JSON.stringify(window.itensSelecionadosHB)); };
window.dragOverHB = (e) => { e.preventDefault(); e.stopPropagation(); const target = e.currentTarget; target.classList.remove('wiki-drop-above', 'wiki-drop-below', 'wiki-drop-inside'); if (target.id === 'folder-root' || target.id === 'folder-trash' || target.getAttribute('data-node-type') === 'folder') { target.classList.add('wiki-drop-inside'); } else { const rect = target.getBoundingClientRect(); if (e.clientY - rect.top < rect.height * 0.5) target.classList.add('wiki-drop-above'); else target.classList.add('wiki-drop-below'); } };
window.dragLeaveHB = (e) => { e.stopPropagation(); e.currentTarget.classList.remove('wiki-drop-above', 'wiki-drop-below', 'wiki-drop-inside'); };
window.dropHB = (e, targetId) => {
    e.preventDefault(); e.stopPropagation(); const targetEl = e.currentTarget; let dropAction = 'inside'; if (targetEl.classList.contains('wiki-drop-above')) dropAction = 'above'; else if (targetEl.classList.contains('wiki-drop-below')) dropAction = 'below'; targetEl.classList.remove('wiki-drop-above', 'wiki-drop-below', 'wiki-drop-inside');
    const pacote = e.dataTransfer.getData("items"); if (!pacote) return;
    JSON.parse(pacote).forEach(item => {
        let cacheAlvo = item.type === 'folder' ? window.hbFoldersCache : window.hbEventsList; let obj = cacheAlvo.find(i => i.id === item.id); if (!obj) return;
        let novoPai = targetId === 'root' ? null : targetId; let novaOrdem = Date.now();
        if (dropAction !== 'inside' && targetId !== 'root' && targetId !== 'trash') { const dAlvo = cacheAlvo.find(i => i.id === targetId); if (dAlvo) { novoPai = item.type === 'folder' ? dAlvo.parentId : dAlvo.pastaId; novaOrdem = dropAction === 'above' ? (dAlvo.ordem || Date.now()) - 0.5 : (dAlvo.ordem || Date.now()) + 0.5; } }
        if (item.type === 'folder') obj.parentId = novoPai; else obj.pastaId = novoPai; obj.ordem = novaOrdem;
    });
        window.salvarBancoLocal(); window.renderizarHeartBeatTree(); window.itensSelecionadosHB = [];
};

window.testarNoGodot = () => {
    if (!window.hbAtualId) return;
    const evento = window.hbEventsCache[window.hbAtualId] || window.hbEventsList.find(e => e.id === window.hbAtualId);
    if (!evento || !evento.titulo) return;

    if (window.wsHeartBeat && window.wsHeartBeat.readyState === 1) window.wsHeartBeat.send(JSON.stringify({ type: "remote_play", event_id: evento.titulo }));
    if (window.HeartBeatAPI && window.HeartBeatAPI.godotCallback) window.HeartBeatAPI.sendToGodot("remote_play", { event_id: evento.titulo });
};

window.renderizarFileBrowser = () => {
    const list = document.getElementById('fb_list');
    const term = getVal('fb_search', '').toLowerCase();
    if (!list || !window.godotAudioFiles) return;

    const files = window.godotAudioFiles.filter(f => f.toLowerCase().includes(term));
    if (files.length === 0) { list.innerHTML = '<div style="color:#555; text-align:center; padding:20px; font-size:0.7rem;">Nenhum arquivo encontrado.</div>'; return; }

    list.innerHTML = files.map(f => `
    <div class="audio-file-item" draggable="true" ondragstart="window.audioDragStart(event, '${f}')" ondblclick="window.inserirArquivoClip('${f}')">
    <span>${f.endsWith('.ogg') ? '🎵' : '🔊'}</span>
    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${f}">${f.replace('res://', '')}</span>
    </div>
    `).join('');
};

window.audioDragStart = (e, path) => { e.dataTransfer.setData("audio_path", path); e.dataTransfer.effectAllowed = "copy"; };

window.inserirArquivoClip = (path) => { window.adicionarNodeBuilder('file', path); window.salvarAlteracoesHeartBeat(); setDisplay('file_browser', 'none'); };

window.adicionarNodeBuilder = (type, value, extra = 1.0) => {
    const container = document.getElementById('clips_builder_container');
    if (container.innerHTML.includes('Nenhum áudio')) container.innerHTML = '';
    const div = document.createElement('div'); div.className = 'clip-node'; div.setAttribute('draggable', 'true'); div.setAttribute('data-type', type);
    div.ondragstart = window.clipDragStart; div.ondragend = () => { window.draggedClipNode = null; window.salvarAlteracoesHeartBeat(); };

    let contentHtml = '';
    if (type === 'file') {
        const isMusic = getVal('ev_type', 'sfx') === 'music';
        contentHtml = `<span class="clip-content"><span style="color:var(--primary);">▶</span> <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${value}">${value.replace('res://', '')}</span>${!isMusic ? `<input type="number" class="val-weight" value="${extra}" step="0.1" title="Probabilidade/Peso" style="width: 50px;" onchange="window.salvarAlteracoesHeartBeat()">` : ''}</span><input type="hidden" class="val-file" value="${value}">`;
    } else if (type === 'delay') contentHtml = `<span class="clip-content" style="color:#ffeb3b;"><span>⏱️ DELAY (s):</span><input type="number" class="val-time" value="${value}" step="0.1" style="width: 60px;" onchange="window.salvarAlteracoesHeartBeat()"></span>`;
    else if (type === 'state') contentHtml = `<span class="clip-content" style="color:var(--danger); font-weight:bold;"><span>🏷️ ESTADO:</span><input type="text" class="val-state" value="${value}" style="width: 120px;" onchange="window.salvarAlteracoesHeartBeat()"></span>`;

    div.innerHTML = `<span class="clip-drag-handle">☰</span>${contentHtml}<button class="clip-btn-delete" onclick="this.parentElement.remove(); window.salvarAlteracoesHeartBeat()" title="Remover">✖</button>`;
    container.appendChild(div);
};

window.renderizarClipsBuilder = (data) => {
    const container = document.getElementById('clips_builder_container'); container.innerHTML = '';
    if (data.type === "switch" && data.states) for (const [estado, clips] of Object.entries(data.states)) { window.adicionarNodeBuilder('state', estado); clips.forEach(c => typeof c === 'object' ? window.adicionarNodeBuilder('file', c.file, c.weight) : window.adicionarNodeBuilder('file', c, 1.0)); }
    else if (data.type === "sequence" && data.sequence_steps) data.sequence_steps.forEach(s => s.action === "delay" ? window.adicionarNodeBuilder('delay', s.time) : window.adicionarNodeBuilder('file', s.file, 1.0));
    else if (data.audio_clips) data.audio_clips.forEach(c => typeof c === 'object' ? window.adicionarNodeBuilder('file', c.file, c.weight || 1.0) : window.adicionarNodeBuilder('file', c, 1.0));
    if (container.innerHTML === '') container.innerHTML = '<div style="color: #444; text-align: center; margin-top: 20px; font-size: 0.7rem;">Nenhum áudio inserido.<br>Clique em 📂 ENGINE para adicionar.</div>';
};

window.draggedClipNode = null;
window.clipDragStart = (e) => { window.draggedClipNode = e.currentTarget; e.dataTransfer.effectAllowed = 'move'; };
window.clipDragOver = (e) => {
    e.preventDefault(); e.dataTransfer.dropEffect = "copyMove";
    const container = document.getElementById('clips_builder_container');
    const afterElement = [...container.querySelectorAll('.clip-node:not(.dragging)')].reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2; return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest; }, { offset: Number.NEGATIVE_INFINITY }).element;
    if (window.draggedClipNode) afterElement == null ? container.appendChild(window.draggedClipNode) : container.insertBefore(window.draggedClipNode, afterElement);
};

window.clipDrop = (e) => {
    e.preventDefault(); const path = e.dataTransfer.getData("audio_path");
    if (path) {
        const container = document.getElementById('clips_builder_container');
        const afterElement = [...container.querySelectorAll('.clip-node:not(.dragging)')].reduce((closest, child) => { const box = child.getBoundingClientRect(); const offset = e.clientY - box.top - box.height / 2; return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest; }, { offset: Number.NEGATIVE_INFINITY }).element;
        window.adicionarNodeBuilder('file', path); const recemAdicionado = container.lastElementChild;
        if (afterElement && recemAdicionado) container.insertBefore(recemAdicionado, afterElement);
        window.salvarAlteracoesHeartBeat();
    }
};

window.mudarUIHeartBeat = () => {
    const type = getVal('ev_type', '');
    setDisplay('container_state_param', type === "switch" ? "flex" : "none"); setDisplay('container_scatterer', type === "scatterer" ? "block" : "none");
    setDisplay('btn_add_delay', type === "sequence" ? "block" : "none"); setDisplay('btn_add_state', type === "switch" ? "block" : "none");
    if (window.carregarPlayerPreview) window.carregarPlayerPreview();
};

window.mudarAba = (aba) => {
    const isInspector = aba === 'inspector';
    const tabInsp = document.getElementById('tab_inspector'); if (tabInsp) { tabInsp.style.background = isInspector ? 'var(--panel-bg)' : 'transparent'; tabInsp.style.color = isInspector ? 'var(--primary)' : 'var(--text-dim)'; tabInsp.style.borderBottom = isInspector ? '2px solid var(--primary)' : '2px solid transparent'; }
    const tabMixer = document.getElementById('tab_mixer'); if (tabMixer) { tabMixer.style.background = !isInspector ? 'var(--panel-bg)' : 'transparent'; tabMixer.style.color = !isInspector ? 'var(--primary)' : 'var(--text-dim)'; tabMixer.style.borderBottom = !isInspector ? '2px solid var(--primary)' : '2px solid transparent'; }

    setDisplay('editor_ui', (isInspector && window.hbAtualId) ? 'block' : 'none');
    setDisplay('mixer_ui', (!isInspector) ? 'block' : 'none');
    setDisplay('empty_state', (isInspector && !window.hbAtualId) ? 'block' : 'none');

    if (aba === 'mixer') setTimeout(() => { if(window.initCableSystem) window.initCableSystem(); if(window.initKnobs) window.initKnobs(); }, 100);
};

window.salvarMixerHB = () => {
    ['Master', 'Music', 'SFX', 'Ambience', 'UI', 'Voice'].forEach(bus => { const input = document.getElementById('mix_vol_' + bus); if (input) { window.hbMixerState.buses[bus] = parseFloat(input.value); setText('mix_lbl_' + bus, input.value + ' dB'); } });
    window.sincronizarMixer(); clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000);
};

window.salvarFaderModulo = (faderElement) => {
    const mod = faderElement.getAttribute('data-module'), param = faderElement.getAttribute('data-param'), val = parseFloat(faderElement.value);
    if (!window.hbMixerState.modules) window.hbMixerState.modules = {}; if (!window.hbMixerState.modules[mod]) window.hbMixerState.modules[mod] = {};
    window.hbMixerState.modules[mod][param] = val; window.sincronizarMixer(); clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000);
};

window.carregarUI_Mixer = () => {
    ['Master', 'Music', 'SFX', 'Ambience', 'UI', 'Voice'].forEach(bus => { const val = window.hbMixerState.buses[bus] || 0.0; setVal('mix_vol_' + bus, val); setText('mix_lbl_' + bus, val + ' dB'); });
    window.atualizarListaSnapshots();
    document.querySelectorAll('input[data-bypass]').forEach(chk => { const mod = chk.getAttribute('data-bypass'); if (window.hbMixerState.modules && window.hbMixerState.modules[mod]) chk.checked = window.hbMixerState.modules[mod].bypass || false; });
};

window.cableSystem.eventsBound = window.cableSystem.eventsBound || false;
window.initCableSystem = () => {
    const rack = document.getElementById('eurorack_case'); const svg = document.getElementById('patch_cables_svg');
    if (!svg || !rack) return;
    svg.setAttribute('width', rack.scrollWidth); svg.setAttribute('height', Math.max(rack.scrollHeight, rack.clientHeight)); window.renderizarConexoesHB();

    document.querySelectorAll('.jack').forEach(jack => {
        const newJack = jack.cloneNode(true); jack.parentNode.replaceChild(newJack, jack);
        newJack.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
            window.cableSystem.isDragging = true; window.cableSystem.startJack = newJack;
            window.cableSystem.tempLine = window.createCableElement(window.cableSystem.colors[Math.floor(Math.random() * window.cableSystem.colors.length)]);
            window.cableSystem.tempLine.style.pointerEvents = "none"; svg.appendChild(window.cableSystem.tempLine);
        });
    });

    if (!window.cableSystem.eventsBound) {
        window.cableSystem.eventsBound = true;
        window.addEventListener('mousemove', (e) => {
            if (!window.cableSystem.isDragging || !window.cableSystem.tempLine || !window.cableSystem.startJack) return;
            const svgRect = document.getElementById('patch_cables_svg').getBoundingClientRect(), jackRect = window.cableSystem.startJack.getBoundingClientRect();
            window.updateCablePathSimple(window.cableSystem.tempLine, jackRect.left + (jackRect.width / 2) - svgRect.left, jackRect.top + (jackRect.height / 2) - svgRect.top, e.clientX - svgRect.left, e.clientY - svgRect.top);
        });
        window.addEventListener('mouseup', (e) => {
            if (!window.cableSystem.isDragging) return; const target = e.target.closest('.jack');
            if (target && window.cableSystem.startJack && target.id !== window.cableSystem.startJack.id) {
                window.hbMixerState.dsp_nodes.push({ from: window.cableSystem.startJack.id, to: target.id, color: window.cableSystem.tempLine.getAttribute('stroke') });
                window.salvarMixerHB(); window.renderizarConexoesHB();
            }
            if (window.cableSystem.tempLine) window.cableSystem.tempLine.remove();
            window.cableSystem.isDragging = false; window.cableSystem.tempLine = null; window.cableSystem.startJack = null;
        });
    }
};

window.createCableElement = (c) => { const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("stroke", c); p.setAttribute("stroke-width", "8"); p.setAttribute("fill", "none"); p.setAttribute("stroke-linecap", "round"); p.style.filter = "drop-shadow(0 15px 10px rgba(0,0,0,0.7))"; return p; };
window.updateCablePathSimple = (p, x1, y1, x2, y2) => { const sag = 60 + (Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2)) * 0.4); p.setAttribute("d", `M ${x1} ${y1} C ${x1} ${y1 + sag}, ${x2} ${y2 + sag}, ${x2} ${y2}`); };

window.renderizarConexoesHB = () => {
    const svg = document.getElementById('patch_cables_svg'); const rack = document.getElementById('eurorack_case'); if (!svg || !rack) return;
    svg.innerHTML = ''; svg.setAttribute('height', Math.max(rack.scrollHeight, rack.clientHeight));
    window.hbMixerState.dsp_nodes.forEach((conn, idx) => {
        const f = document.getElementById(conn.from), t = document.getElementById(conn.to);
        if (f && t) {
            const svgRect = svg.getBoundingClientRect(), r1 = f.getBoundingClientRect(), r2 = t.getBoundingClientRect();
            const path = window.createCableElement(conn.color || '#ff5252');
            window.updateCablePathSimple(path, r1.left + (r1.width / 2) - svgRect.left, r1.top + (r1.height / 2) - svgRect.top, r2.left + (r2.width / 2) - svgRect.left, r2.top + (r2.height / 2) - svgRect.top);
            path.style.pointerEvents = "auto"; path.style.cursor = "pointer";
            path.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); if(confirm("Desconectar cabo?")) { window.hbMixerState.dsp_nodes.splice(idx, 1); window.salvarMixerHB(); window.renderizarConexoesHB(); } };
            svg.appendChild(path);
        }
    });
};

window.knobSystem.eventsBound = window.knobSystem.eventsBound || false;
window.updateKnobRotation = (knob, value) => { knob.style.transform = `rotate(${-135 + (value * 270)}deg)`; };
window.initKnobs = () => {
    const knobs = document.querySelectorAll('.knob-inst'); if (knobs.length === 0) return;
    knobs.forEach(knob => {
        let val = parseFloat(knob.getAttribute('data-value')) || 0.0; const mod = knob.getAttribute('data-module'), param = knob.getAttribute('data-param');
        if (window.hbMixerState.modules && window.hbMixerState.modules[mod] && window.hbMixerState.modules[mod][param] !== undefined) { val = window.hbMixerState.modules[mod][param]; knob.setAttribute('data-value', val); }
        knob.value = val; window.updateKnobRotation(knob, val);
        if (!knob.hasAttribute('data-bound')) {
            knob.setAttribute('data-bound', 'true');
            knob.addEventListener('mousedown', (e) => { if (e.button !== 0) return; e.preventDefault(); window.knobSystem.activeKnob = knob; window.knobSystem.startY = e.clientY; window.knobSystem.startValue = parseFloat(knob.getAttribute('data-value')) || 0; document.body.style.cursor = 'ns-resize'; });
        }
    });

    if (!window.knobSystem.eventsBound) {
        window.knobSystem.eventsBound = true;
        window.addEventListener('mousemove', (e) => {
            if (!window.knobSystem.activeKnob) return;
            let newVal = Math.max(0.0, Math.min(1.0, window.knobSystem.startValue + ((window.knobSystem.startY - e.clientY) * window.knobSystem.sensitivity)));
            const knob = window.knobSystem.activeKnob; knob.setAttribute('data-value', newVal); knob.value = newVal;

            const mod = knob.getAttribute('data-module'), param = knob.getAttribute('data-param');
            if (mod && param) {
                if (!window.hbMixerState.modules) window.hbMixerState.modules = {}; if (!window.hbMixerState.modules[mod]) window.hbMixerState.modules[mod] = {};
                window.hbMixerState.modules[mod][param] = newVal;
            }
            window.updateKnobRotation(knob, newVal); window.sincronizarMixer(); clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000);
        });
        window.addEventListener('mouseup', () => { if (window.knobSystem.activeKnob) { window.knobSystem.activeKnob = null; document.body.style.cursor = 'default'; } });
    }
};

// 🚨 UPLOAD DE ARQUIVOS (CORRIGIDO PARA SUPORTAR HTML5 NATIVO E WEBSOCKET COM MELHOR FEEDBACK)
window.uploadArquivoHB = (input) => {
    const file = input.files[0];
    if (!file) return;

    const labelBtn = input.parentElement;
    const originalText = labelBtn.innerHTML;

    labelBtn.innerText = "⏳ LENDO...";
    labelBtn.style.opacity = "0.5";

    const reader = new FileReader();
    reader.onload = function(e) {
        labelBtn.innerText = "⏳ ENVIANDO...";
        const base64Data = e.target.result.split(',')[1];

        const payload = {
            type: "upload_file",
            fileName: file.name.replace(/ /g, '_'),
            fileData: base64Data
        };

        // 1. Tenta WebSocket primeiro
        if (window.wsHeartBeat && window.wsHeartBeat.readyState === WebSocket.OPEN) {
            window.wsHeartBeat.send(JSON.stringify(payload));
            concluirProcesso("ws");
        }
        // 2. Tenta Bridge Nativo (HTML5) se não houver WS
        else if (window.HeartBeatAPI && window.HeartBeatAPI.godotCallback) {
            window.HeartBeatAPI.sendToGodot("upload_file", payload);
            concluirProcesso("js");
        }
        // 3. Deu ruim
        else {
            alert("Erro: Nenhuma conexão ativa com a Engine para fazer o upload!");
            restaurarBotao();
        }

        function concluirProcesso(modo) {
            setTimeout(() => {
                labelBtn.innerText = "✅ SUCESSO!";
                labelBtn.style.color = "var(--primary)";

                // Força atualização da lista de arquivos logo após
                if (modo === "ws") window.wsHeartBeat.send(JSON.stringify({ type: "request_files" }));
                else window.HeartBeatAPI.sendToGodot("request_files", {});

                setTimeout(restaurarBotao, 2000);
            }, 500);
        }

        function restaurarBotao() {
            labelBtn.innerHTML = originalText;
            labelBtn.style.opacity = "1";
            labelBtn.style.color = ""; // Reseta cor pro padrão
        }
    };
    reader.readAsDataURL(file);
};

window.playerSystem = { tracks: [], waveformCache: {}, isPlaying: false };
const oldMudarUI = window.mudarUIHeartBeat; window.mudarUIHeartBeat = () => { if(oldMudarUI) oldMudarUI(); window.carregarPlayerPreview(); };

window.carregarPlayerPreview = () => {
    const container = document.getElementById('player_preview_container'), audioContainer = document.getElementById('audio_elements_container');
    const linksBrutos = Array.from(document.querySelectorAll('#clips_builder_container .clip-node[data-type="file"]')).map(node => node.querySelector('.val-file').value.trim());

    if (!container || linksBrutos.length === 0) { if(container) container.style.display = 'none'; window.pararPreview(); return; }
    container.style.display = 'block';

    if (window.spatialSystem && window.spatialSystem.sourceNodes.length > 0) window.spatialSystem.sourceNodes.forEach(node => { if(node) node.disconnect(); });
    window.spatialSystem.sourceNodes = []; window.playerSystem.tracks.forEach(t => { t.pause(); t.removeAttribute('src'); t.load(); }); window.playerSystem.tracks = []; audioContainer.innerHTML = '';

    let links = linksBrutos.map(url => url.replace("res://", "./"));
    const dynamicContainer = document.getElementById('dynamic_intensity_container');
    if (getVal('ev_type', 'sfx') === 'music' && links.length > 1) { dynamicContainer.style.display = 'block'; window.montarLedsDoMixer(links.length); document.getElementById('dynamic_intensity_slider').oninput = (e) => window.mudarIntensidadeCrossfade(e.target.value, links.length); } else dynamicContainer.style.display = 'none';

    links.forEach((url, index) => {
        const audio = new Audio(url); audio.crossOrigin = "anonymous"; audio.preload = "auto"; audio.loop = true;
        if (index === 0) { audio.ontimeupdate = window.atualizarProgressoPreview; audio.onloadedmetadata = window.atualizarProgressoPreview; }
        audioContainer.appendChild(audio); window.playerSystem.tracks.push(audio);
    });
    window.gerarWaveformReal(links[0]); window.mudarIntensidadeCrossfade(0, links.length);
};

window.montarLedsDoMixer = (numCamadas) => { document.getElementById('mixer_leds').innerHTML = Array.from({length: numCamadas}).map((_, i) => `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; flex: 1;"><div style="width: 100%; height: 6px; background: #111; border-radius: 3px; overflow: hidden; border: 1px solid #222;"><div id="mixer-led-${i}" style="width: 0%; height: 100%; background: var(--primary); transition: width 0.1s;"></div></div><span style="font-size: 0.5rem; color: #555;">CH${i+1}</span></div>`).join(''); };
window.mudarIntensidadeCrossfade = (valor, numCamadas) => {
    const val = parseInt(valor);
    window.playerSystem.tracks.forEach((audio, i) => {
        let volume = 0; if (i === 0) volume = 1; else { const step = 100 / (numCamadas - 1), startFade = (i - 1) * step, endFade = i * step; if (val <= startFade) volume = 0; else if (val >= endFade) volume = 1; else volume = (val - startFade) / (endFade - startFade); }
        audio.volume = volume; const led = document.getElementById(`mixer-led-${i}`); if (led) { led.style.width = `${volume * 100}%`; led.style.boxShadow = volume > 0 ? '0 0 8px var(--primary)' : 'none'; }
    });
};

window.gerarWaveformReal = async (url) => {
    const maskContainer = document.getElementById('wave-mask-container'), timeDisplay = document.getElementById('player_time_display'), oldText = timeDisplay.innerText;
    if (window.playerSystem.waveformCache[url]) { maskContainer.style.clipPath = window.playerSystem.waveformCache[url]; return; }
    timeDisplay.innerText = "Analisando onda...";
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const rawData = (await audioCtx.decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
        const samples = 150, blockSize = Math.floor(rawData.length / samples); let pontos = ['0% 100%'];
        for (let i = 0; i < samples; i++) { let sum = 0; for (let j = 0; j < blockSize; j++) sum += Math.abs(rawData[i * blockSize + j]); pontos.push(`${(i / samples) * 100}% ${100 - Math.min(100, Math.max(2, (sum / blockSize) * 1200))}%`); } pontos.push('100% 100%');
        const clipPathStr = `polygon(${pontos.join(', ')})`; maskContainer.style.clipPath = clipPathStr; window.playerSystem.waveformCache[url] = clipPathStr;
    } catch (err) { maskContainer.style.clipPath = "polygon(0% 100%, 0% 50%, 25% 20%, 50% 80%, 75% 30%, 100% 50%, 100% 100%)"; } finally { timeDisplay.innerText = oldText; }
};

window.atualizarProgressoPreview = () => {
    const mainTrack = window.playerSystem.tracks[0]; if (!mainTrack || !mainTrack.duration) return;
    if (window.playerSystem.tracks.length > 1 && !mainTrack.paused) for (let i = 1; i < window.playerSystem.tracks.length; i++) if (Math.abs(window.playerSystem.tracks[i].currentTime - mainTrack.currentTime) > 0.1) window.playerSystem.tracks[i].currentTime = mainTrack.currentTime;
    const perc = (mainTrack.currentTime / mainTrack.duration) * 100, fill = document.getElementById('progress-bar-fill'), needle = document.getElementById('progress-needle');
    if (fill) fill.style.width = `${perc}%`; if (needle) needle.style.left = `${perc}%`;
    setText('player_time_display', `${Math.floor(mainTrack.currentTime / 60)}:${Math.floor(mainTrack.currentTime % 60).toString().padStart(2, '0')} / ${Math.floor(mainTrack.duration / 60)}:${Math.floor(mainTrack.duration % 60).toString().padStart(2, '0')}`);
};

document.getElementById('wave-click-area')?.addEventListener('click', (e) => { const mainTrack = window.playerSystem.tracks[0]; if (!mainTrack || !mainTrack.duration) return; window.playerSystem.tracks.forEach(t => t.currentTime = (e.offsetX / e.currentTarget.offsetWidth) * mainTrack.duration); });

const oldAbrirEvento = window.abrirEventoHeartBeat; window.abrirEventoHeartBeat = (id) => { if(oldAbrirEvento) oldAbrirEvento(id); setTimeout(window.carregarPlayerPreview, 100); };
window.salvarBypassModulo = (chk) => { const mod = chk.getAttribute('data-bypass'); if (!window.hbMixerState.modules) window.hbMixerState.modules = {}; if (!window.hbMixerState.modules[mod]) window.hbMixerState.modules[mod] = {}; window.hbMixerState.modules[mod].bypass = chk.checked; window.sincronizarMixer(); clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000); };

window.spatialSystem = { isDragging: false, x: 0.0, z: -2.5, audioCtx: null, panner: null, sourceNodes: [] };
setTimeout(() => {
    const radar = document.getElementById('spatial_radar'), sourceDot = document.getElementById('spatial_source');
    if (radar && sourceDot) {
        const updatePosition = (e) => {
            const rect = radar.getBoundingClientRect(); let mouseX = e.clientX - rect.left, mouseY = e.clientY - rect.top;
            const cx = 70, cy = 70, r = 70, dx = mouseX - cx, dy = mouseY - cy, distance = Math.sqrt(dx*dx + dy*dy);
            if (distance > r) { mouseX = cx + (dx / distance) * r; mouseY = cy + (dy / distance) * r; }
            sourceDot.style.left = `${(mouseX / 140) * 100}%`; sourceDot.style.top = `${(mouseY / 140) * 100}%`;
            window.spatialSystem.x = ((mouseX - cx) / r) * 10.0; window.spatialSystem.z = ((mouseY - cy) / r) * 10.0;
            document.getElementById('val_spat_x').innerText = window.spatialSystem.x.toFixed(2) + ' m'; document.getElementById('val_spat_z').innerText = window.spatialSystem.z.toFixed(2) + ' m';
            if (window.spatialSystem.panner) { window.spatialSystem.panner.positionX.value = window.spatialSystem.x; window.spatialSystem.panner.positionZ.value = window.spatialSystem.z; }
            if (window.hbAtualId && window.wsHeartBeat?.readyState === WebSocket.OPEN) window.wsHeartBeat.send(JSON.stringify({ type: "update_spatial", event_id: window.hbEventsCache[window.hbAtualId].titulo, x: window.spatialSystem.x, z: window.spatialSystem.z }));
        };
        radar.addEventListener('mousedown', (e) => { window.spatialSystem.isDragging = true; updatePosition(e); });
        window.addEventListener('mousemove', (e) => { if(window.spatialSystem.isDragging) updatePosition(e); });
        window.addEventListener('mouseup', () => { window.spatialSystem.isDragging = false; });
    }
}, 500);

const startSpatialAudio = () => {
    const typeInput = document.getElementById('ev_spatial')?.value, roomContainer = document.getElementById('spatial_room_container');
    if (typeInput !== '3d' && typeInput !== '2d') { if(roomContainer) roomContainer.style.display = 'none'; return; }
    if(roomContainer) roomContainer.style.display = 'block';
    if (!window.spatialSystem.audioCtx) {
        window.spatialSystem.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); window.spatialSystem.panner = window.spatialSystem.audioCtx.createPanner();
        window.spatialSystem.panner.panningModel = 'HRTF'; window.spatialSystem.panner.distanceModel = 'inverse'; window.spatialSystem.panner.refDistance = 1; window.spatialSystem.panner.maxDistance = 10000; window.spatialSystem.panner.rolloffFactor = 1;
        window.spatialSystem.panner.connect(window.spatialSystem.audioCtx.destination);
    }
    if (window.spatialSystem.audioCtx.state === 'suspended') window.spatialSystem.audioCtx.resume();
    window.playerSystem.tracks.forEach((audioEl, index) => { if (!window.spatialSystem.sourceNodes[index]) { const source = window.spatialSystem.audioCtx.createMediaElementSource(audioEl); window.spatialSystem.sourceNodes[index] = source; source.connect(window.spatialSystem.panner); } });
    window.spatialSystem.panner.positionX.value = window.spatialSystem.x; window.spatialSystem.panner.positionY.value = 0; window.spatialSystem.panner.positionZ.value = window.spatialSystem.z;
};

window.isTogglingPlay = false;
window.togglePlayPreview = async () => {
    if (window.isTogglingPlay) return; window.isTogglingPlay = true;
    const btn = document.getElementById('btn_play_preview');
    if (window.playerSystem.isPlaying) { window.pararPreview(); window.isTogglingPlay = false; } else {
        if (typeof startSpatialAudio === 'function') startSpatialAudio();
        try {
            await Promise.all(window.playerSystem.tracks.map(t => t.play())); window.playerSystem.isPlaying = true;
            if (btn) { btn.innerText = "⏸ PAUSAR PREVIEW"; btn.style.background = "var(--primary)"; btn.style.color = "#000"; }
        } catch(e) { console.error("Erro no Play:", e); } finally { window.isTogglingPlay = false; }
    }
};

window.pararPreview = () => {
    if (!window.playerSystem) return; window.playerSystem.tracks.forEach(t => t.pause()); window.playerSystem.isPlaying = false;
    const btn = document.getElementById('btn_play_preview'); if (btn) { btn.innerText = "▶ TOCAR NO NAVEGADOR"; btn.style.background = "#2a2a32"; btn.style.color = "var(--primary)"; }
};

// ==========================================
// MATA TODO O ÁUDIO (LOCAL E ENGINE)
// ==========================================
window.pararTudoHeartBeat = () => {
    // 1. Corta o preview local do site
    window.pararPreview();

    // 2. Manda a ordem de calar a boca pro Godot
    if (window.wsHeartBeat && window.wsHeartBeat.readyState === WebSocket.OPEN) {
        window.wsHeartBeat.send(JSON.stringify({ type: "stop_all" }));
    }
    // Suporte caso o Godot esteja rodando no iFrame
    if (window.HeartBeatAPI && window.HeartBeatAPI.godotCallback) {
        window.HeartBeatAPI.sendToGodot("stop_all", {});
    }

    window.mostrarToastNotificacao("Sistema", "🛑 Todo o áudio foi interrompido.", "geral");
};

window.salvarSnapshotMixer = () => {
    const name = document.getElementById('snap_name_input').value.trim() || 'default'; if (!window.hbMixerState.snapshots) window.hbMixerState.snapshots = {};
    window.hbMixerState.snapshots[name] = { buses: JSON.parse(JSON.stringify(window.hbMixerState.buses || {})), modules: JSON.parse(JSON.stringify(window.hbMixerState.modules || {})), dsp_nodes: JSON.parse(JSON.stringify(window.hbMixerState.dsp_nodes || [])) };
    window.atualizarListaSnapshots(); const select = document.getElementById('snap_list_select'); if (select) select.value = name;
    window.sincronizarMixer(); window.salvarBancoLocal(); document.getElementById('snap_name_input').value = ""; window.mostrarToastNotificacao("Mixer", `📸 Snapshot '${name}' (incluindo cabos) salvo!`, "geral");
};

window.atualizarListaSnapshots = () => { const select = document.getElementById('snap_list_select'); if(!select || !window.hbMixerState.snapshots) return; const snaps = Object.keys(window.hbMixerState.snapshots); if (snaps.length > 0) { const valorAtual = select.value; select.innerHTML = snaps.map(k => `<option value="${k}">${k}</option>`).join(''); if (snaps.includes(valorAtual)) select.value = valorAtual; } };

window.testarSnapshotMixer = () => {
    const name = document.getElementById('snap_list_select').value, snapData = window.hbMixerState.snapshots[name]; if (!snapData) return;
    if (snapData.dsp_nodes) { window.hbMixerState.dsp_nodes = JSON.parse(JSON.stringify(snapData.dsp_nodes)); if (typeof window.renderizarConexoesHB === 'function') window.renderizarConexoesHB(); }
    if (window.wsHeartBeat?.readyState === WebSocket.OPEN) window.wsHeartBeat.send(JSON.stringify({ type: "test_snapshot", snapshot: name, fade_time: 2.0 }));
    if (snapData.buses) Object.keys(snapData.buses).forEach(bus => { const val = snapData.buses[bus]; const input = document.getElementById('mix_vol_' + bus), label = document.getElementById('mix_lbl_' + bus); if (input) input.value = val; if (label) label.innerText = val.toFixed(1) + ' dB'; window.hbMixerState.buses[bus] = val; });
    if (snapData.modules) Object.keys(snapData.modules).forEach(mod => { const modData = snapData.modules[mod]; Object.keys(modData).forEach(param => { if (param === 'bypass') { const chk = document.querySelector(`input[data-bypass="${mod}"]`); if (chk) chk.checked = modData[param]; } else { const knob = document.querySelector(`.knob-inst[data-module="${mod}"][data-param="${param}"]`), fader = document.querySelector(`.eq-fader[data-module="${mod}"][data-param="${param}"]`); const val = modData[param]; if (knob) { knob.setAttribute('data-value', val); window.updateKnobRotation(knob, val); } if (fader) fader.value = val; } }); window.hbMixerState.modules[mod] = JSON.parse(JSON.stringify(modData)); });
    window.salvarBancoLocal();
};

window.salvarLfoModulator = () => { if (!window.hbMixerState.lfo) window.hbMixerState.lfo = {}; window.hbMixerState.lfo = { target: document.getElementById('lfo_target').value, rate: parseFloat(document.getElementById('lfo_rate').value), depth: parseFloat(document.getElementById('lfo_depth').value) }; window.sincronizarMixer(); clearTimeout(window.hbTimeout); window.hbTimeout = setTimeout(() => window.salvarBancoLocal(), 1000); };

window.itemContextoAtual = null;
window.abrirMenuContexto = (e, id, type) => { e.preventDefault(); e.stopPropagation(); window.itemContextoAtual = { id, type }; const menu = document.getElementById('context-menu'); menu.style.display = 'block'; menu.style.left = e.pageX + 'px'; menu.style.top = e.pageY + 'px'; };
window.addEventListener('click', () => { const menu = document.getElementById('context-menu'); if (menu) menu.style.display = 'none'; });

window.renomearItemContexto = () => {
    if (!window.itemContextoAtual) return; const { id, type } = window.itemContextoAtual;
    if (type === 'folder') { const pasta = window.hbFoldersCache.find(f => f.id === id); if (pasta) { const novoNome = prompt("Renomear pasta:", pasta.nome); if (novoNome && novoNome.trim() !== "") { pasta.nome = novoNome.trim(); window.salvarBancoLocal(); window.renderizarHeartBeatTree(); window.sincronizarBank(); } } }
    else if (type === 'event') { const evento = window.hbEventsCache[id] || window.hbEventsList.find(e => e.id === id); if (evento) { const novoNome = prompt("Renomear Evento/ID Único:", evento.titulo); if (novoNome && novoNome.trim() !== "") { evento.titulo = novoNome.trim().replace(/[^a-zA-Z0-9_]/g, '_'); window.salvarBancoLocal(); window.renderizarHeartBeatTree(); window.sincronizarBank(); } } }
};

window.deletarItemContexto = () => {
    if (!window.itemContextoAtual) return; const { id, type } = window.itemContextoAtual;
    if (confirm(type === 'folder' ? "Mover pasta para a lixeira?" : "Mover evento para a lixeira?")) {
        if (type === 'folder') { const pasta = window.hbFoldersCache.find(f => f.id === id); if(pasta) pasta.parentId = 'trash'; }
        else if (type === 'event') { const evento = window.hbEventsCache[id] || window.hbEventsList.find(e => e.id === id); if(evento) evento.pastaId = 'trash'; if (window.hbAtualId === id) { window.hbAtualId = null; const ui = document.getElementById('editor_ui'); if(ui) ui.style.display = 'none'; window.pararPreview(); } }
        window.salvarBancoLocal(); window.renderizarHeartBeatTree(); window.sincronizarMixer(); window.sincronizarBank();
    }
};

window.toggleGameViewport = () => { const vp = document.getElementById('game_viewport_window'), iframe = document.getElementById('game_iframe'); if (vp.style.display === 'none' || vp.style.display === '') { vp.style.display = 'flex'; if (iframe.src !== "about:blank") iframe.focus(); } else vp.style.display = 'none'; };
window.carregarJogoViewport = () => { const iframe = document.getElementById('game_iframe'), placeholder = document.getElementById('game_placeholder'), urlInput = document.getElementById('game_url_input').value.trim(); if (urlInput) { iframe.src = urlInput + (urlInput.includes('?') ? '&' : '?') + "nocache=" + Date.now(); iframe.onload = () => { if (iframe.src !== "about:blank") { placeholder.style.display = 'none'; iframe.focus(); iframe.contentWindow.focus(); } }; } };

setTimeout(() => {
    const urlInput = document.getElementById('game_url_input'); if (urlInput) urlInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') window.carregarJogoViewport(); });
    const vpWindow = document.getElementById('game_viewport_window'); if (vpWindow) vpWindow.addEventListener('mousedown', () => { const iframe = document.getElementById('game_iframe'); if (iframe && iframe.src !== "about:blank") iframe.focus(); });
}, 500);

setTimeout(() => {
    const vp = document.getElementById('game_viewport_window'), header = document.getElementById('viewport_header');
    if (vp && header) {
        let isDraggingVp = false, offsetX = 0, offsetY = 0;
        header.addEventListener('mousedown', (e) => { isDraggingVp = true; offsetX = e.clientX - vp.getBoundingClientRect().left; offsetY = e.clientY - vp.getBoundingClientRect().top; vp.style.opacity = '0.8'; });
        window.addEventListener('mousemove', (e) => { if (!isDraggingVp) return; vp.style.left = (e.clientX - offsetX) + 'px'; vp.style.top = (e.clientY - offsetY) + 'px'; vp.style.bottom = 'auto'; vp.style.right = 'auto'; });
        window.addEventListener('mouseup', () => { isDraggingVp = false; vp.style.opacity = '1'; document.getElementById('game_iframe')?.focus(); });
    }
}, 1000);

window.enviarDadosTotais = () => { window.sincronizarBank(); window.sincronizarMixer(); window.mostrarToastNotificacao("Sucesso", "✅ Sincronização total concluída!", "geral"); };
window.resyncEngine = () => { if (typeof window.mostrarToastNotificacao === 'function') window.mostrarToastNotificacao("Sistema", "🔄 Ressincronizando com o Godot...", "geral"); window.conectarWebSocket(); setTimeout(() => { if (window.wsHeartBeat?.readyState === WebSocket.OPEN) { window.sincronizarBank(); window.sincronizarMixer(); if (typeof window.mostrarToastNotificacao === 'function') window.mostrarToastNotificacao("Sucesso", "✅ Sincronização total concluída!", "geral"); } }, 500); };
