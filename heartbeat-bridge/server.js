const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

let currentProjectPath = null;

// ==========================================
// 1. FUNÇÃO AUXILIAR (O ESCANEADOR DE ÁUDIOS)
// ==========================================
function getAudioFiles(dir, rootDir) {
    let results = [];
    try {
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            
            if (stat && stat.isDirectory()) {
                // Ignora pastas ocultas e de controle do Godot/Git
                if (!file.startsWith('.') && !fullPath.includes('.godot') && !fullPath.includes('.git')) {
                    results = results.concat(getAudioFiles(fullPath, rootDir));
                }
            } else {
                // Filtra apenas formatos de áudio suportados
                if (file.endsWith('.wav') || file.endsWith('.ogg') || file.endsWith('.mp3')) {
                    let relativePath = fullPath.replace(rootDir, '').replace(/\\/g, '/');
                    if (!relativePath.startsWith('/')) relativePath = '/' + relativePath;
                    results.push('res:/' + relativePath);
                }
            }
        });
    } catch (e) { console.error("❌ Erro ao ler pasta:", e); }
    return results;
}

// ==========================================
// 2. O SERVIDOR HTTP (ANTI-CORS E STREAMING)
// ==========================================
const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    if (!currentProjectPath) {
        res.writeHead(404);
        res.end("Aguardando Handshake do Godot...");
        return;
    }

    const urlPath = decodeURIComponent(req.url);
    const filePath = path.join(currentProjectPath, urlPath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = { '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404);
        res.end("Arquivo nao encontrado.");
    }
});

// ==========================================
// 3. O SERVIDOR WEBSOCKET (PONTE E AUTO-SAVE)
// ==========================================
const wss = new WebSocket.Server({ 
    server,
    maxPayload: 50 * 1024 * 1024 
});

wss.on('connection', function connection(ws) {
    console.log("🔌 Nova conexão estabelecida no Bridge.");
    
    // Se o projeto já foi detectado, manda a lista de arquivos para o novo cliente
    if (currentProjectPath) {
        ws.send(JSON.stringify({ type: "file_list", data: getAudioFiles(currentProjectPath, currentProjectPath) }));
    }

    ws.on('message', function incoming(data) {
        try {
            const parsed = JSON.parse(data.toString());

            // --- A. HANDSHAKE DO GODOT ---
            if (parsed.type === "handshake") {
                currentProjectPath = parsed.project_path;
                console.log("📍 Projeto detectado em: " + currentProjectPath);
                
                const files = getAudioFiles(currentProjectPath, currentProjectPath);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: "file_list", data: files }));
                    }
                });
                return;
            }

            // --- B. UPLOAD DE NOVOS SONS ---
            if (parsed.type === "upload_file") {
                if (!currentProjectPath) return;
                const audioDir = path.join(currentProjectPath, 'audio');
                if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir);

                const savePath = path.join(audioDir, parsed.fileName);
                fs.writeFileSync(savePath, Buffer.from(parsed.fileData, 'base64'));
                
                console.log(`📥 Áudio salvo no HD: ${parsed.fileName}`);
                const updatedFiles = getAudioFiles(currentProjectPath, currentProjectPath);
                wss.clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: "file_list", data: updatedFiles }));
                });
                return;
            }

            // --- C. AUTO-SAVE MODULAR (BANK E MIXER) ---
            if (parsed.type === "sync_bank" || parsed.type === "sync_mixer") {
                if (!currentProjectPath) return;

                const fileName = (parsed.type === "sync_bank") ? 'heartbeat_bank.json' : 'heartbeat_mixer.json';
                const finalPath = path.join(currentProjectPath, fileName);
                
                fs.writeFileSync(finalPath, JSON.stringify(parsed.data, null, 2));
                console.log(`💾 [AUTO-SAVE] ${fileName} atualizado no disco.`);
                // Não damos return para que a mensagem siga para o repasse abaixo (Live Sync)
            }

            // --- D. REQUEST MANUAL DE ARQUIVOS ---
            if (parsed.type === "request_files" && currentProjectPath) {
                ws.send(JSON.stringify({ type: "file_list", data: getAudioFiles(currentProjectPath, currentProjectPath) }));
                return;
            }

            // --- E. REPASSE LIVE SYNC (BROADCAST) ---
            wss.clients.forEach(client => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(data.toString());
                }
            });

        } catch (e) {
            console.error("❌ Erro ao processar mensagem:", e);
        }
    });
});

// ==========================================
// 4. INICIALIZAÇÃO
// ==========================================
server.listen(8088, () => {
    console.log("🚀 HeartBeat Bridge 100% Online na porta 8088!");
});