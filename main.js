const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs');
const fsPromises = fs.promises;

// Configurar logs
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Detectar ambiente do Electron
const NODE_ENV = process.env.NODE_ENV || 'production';
const USE_EMULATORS = process.env.USE_FIRESTORE_EMULATOR === 'true';

// Log do ambiente
if (NODE_ENV === 'production') {
  log.info('🚀 Electron Ambiente: PRODUÇÃO');
} else if (USE_EMULATORS) {
  log.info('🔧 Electron Ambiente: DEV-EMULATORS');
} else {
  log.info('🌐 Electron Ambiente: DEV-ONLINE');
}

// Variáveis globais
let mainWindow = null;
let tray = null;
let serverProcess = null;
let conexaoCheckInterval = null;
const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;
const CONEXAO_CHECK_URLS = [
  'https://www.google.com/favicon.ico',
  'https://cdn.jsdelivr.net/gh/jquery/jquery/README.md'
];
const CONEXAO_CHECK_INTERVAL = 30000; // 30 segundos

// Caminho para configurações
const isPackaged = app.isPackaged;
const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');

// Caminho para o servidor
const serverPath = isPackaged
  ? path.join(process.resourcesPath, 'server')
  : path.join(__dirname, '..', 'server');

// Caminho para o Node.js
const nodePath = isPackaged
  ? path.join(process.resourcesPath, 'node', 'node.exe')
  : 'node';

// Configurações padrão
const defaultSettings = {
  autostart: {
    hiscre: true,
    ofcweb: true,
    guias: true
  },
  hiscreAuth: {
    loginAutomatico: false,
    otpSecret: ''
  }
};

/**
 * Carregar configurações
 */
async function loadSettings() {
  try {
    const data = await fsPromises.readFile(settingsPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // Se não existir, retornar padrão
    return { ...defaultSettings };
  }
}

/**
 * Salvar configurações
 */
async function saveSettings(settings) {
  try {
    await fsPromises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    log.info('Configurações salvas com sucesso');
    return true;
  } catch (error) {
    log.error('Erro ao salvar configurações:', error);
    return false;
  }
}

/**
 * Obter status de um serviço
 */
async function getServiceStatus(serviceName) {
  try {
    const url = `${SERVER_URL}/api/services/${serviceName}/status`;
    log.info(`Consultando status do serviço ${serviceName} em ${url}`);

    const response = await axios.get(url, {
      timeout: 5000
    });

    log.info(`Resposta para ${serviceName}:`, JSON.stringify(response.data));
    // Retorna exatamente o que a API retornou
    return response.data;
  } catch (error) {
    log.error(`Erro ao consultar status do ${serviceName}:`, error.message);
    return { running: false, message: 'Serviço offline ou não disponível' };
  }
}

/**
 * Iniciar serviço
 */
async function startService(serviceName) {
  try {
    sendLog('info', `Iniciando serviço ${serviceName}...`);
    const response = await axios.post(`${SERVER_URL}/api/services/${serviceName}/start`);
    sendLog('success', `Serviço ${serviceName} iniciado com sucesso!`);

    // Notificar interface sobre mudança de status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', { service: serviceName });
    }

    return response.data;
  } catch (error) {
    sendLog('error', `Erro ao iniciar serviço ${serviceName}: ${error.message}`);
    throw error;
  }
}

/**
 * Reiniciar serviço específico
 */
async function restartService(serviceName) {
  try {
    sendLog('info', `Reiniciando serviço: ${serviceName}...`);
    const response = await axios.post(`${SERVER_URL}/api/services/${serviceName}/restart`);
    sendLog('success', `Serviço ${serviceName} reiniciado com sucesso!`);

    // Notificar interface sobre mudança de status
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('service-status', { service: serviceName });
    }

    return response.data;
  } catch (error) {
    sendLog('error', `Erro ao reiniciar serviço ${serviceName}: ${error.message}`);
    throw error;
  }
}

/**
 * Criar janela principal
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    show: false,
    autoHideMenuBar: true // Remove a barra de menu
  });

  mainWindow.loadFile('index.html');

  // Mostrar quando estiver pronto
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Minimizar para bandeja ao invés de fechar
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Mostrar notificação na primeira vez (se tray estiver disponível)
      if (tray && !tray.notificationShown) {
        tray.displayBalloon({
          title: 'Penhoras Server',
          content: 'O aplicativo continua rodando na bandeja do sistema. Clique no ícone para abrir ou use "Sair" para encerrar completamente.'
        });
        tray.notificationShown = true;
      }
    }
  });

  // Abrir DevTools em desenvolvimento
  if (!isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * Criar ícone na bandeja
 */
function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');

    // Verificar se o ícone existe
    if (!fs.existsSync(iconPath)) {
      log.error(`❌ Ícone da bandeja não encontrado: ${iconPath}`);
      return;
    }

    tray = new Tray(iconPath);
    tray.notificationShown = false; // Flag para mostrar notificação apenas uma vez

    const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Console',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Minimizar para Bandeja',
      click: () => {
        mainWindow.hide();
      }
    },
    { type: 'separator' },
    {
      label: 'Status dos Serviços',
      submenu: [
        {
          label: 'HISCRE',
          enabled: false
        },
        {
          label: 'OFCWeb',
          enabled: false
        },
        {
          label: 'Guias',
          enabled: false
        }
      ]
    },
    { type: 'separator' },
    {
      label: 'Reiniciar Servidor',
      click: () => {
        restartServer();
      }
    },
    {
      label: 'Verificar Atualizações',
      click: () => {
        checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: 'Sair Completamente',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Penhoras Server - Clique para abrir');
  tray.setContextMenu(contextMenu);

  // Duplo clique para abrir
  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Clique simples também abre (comportamento mais intuitivo)
  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  log.info('✅ Ícone da bandeja criado com sucesso');
  } catch (error) {
    log.error('❌ Erro ao criar ícone da bandeja:', error);
    tray = null;
  }
}

/**
 * Iniciar servidor Node.js
 */
async function startServer() {
  return new Promise(async (resolve, reject) => {
    log.info('=== INICIANDO SERVIDOR NODE.JS ===');
    sendLog('info', '🚀 Iniciando servidor Node.js...');

    // Verificar se o script do servidor existe
    const serverScript = path.join(serverPath, 'dist', 'app.js');
    log.info(`📄 Script do servidor: ${serverScript}`);

    try {
      await fsPromises.access(serverScript);
      sendLog('info', '✅ Script do servidor encontrado');
    } catch (error) {
      const errorMsg = `❌ Script do servidor não encontrado: ${serverScript}`;
      log.error(errorMsg);
      sendLog('error', errorMsg);
      reject(new Error(errorMsg));
      return;
    }

    // Log do caminho do UserData para debug
    const userDataPath = app.getPath('userData');
    log.info(`📁 UserData Path: ${userDataPath}`);
    sendLog('info', `📁 Dados persistentes: ${userDataPath}`);

    // Carregar configurações
    sendLog('info', '⚙️ Carregando configurações...');
    const settings = await loadSettings();
    sendLog('info', '✅ Configurações carregadas');

    // Carregar credenciais do Firebase do arquivo JSON
    sendLog('info', '🔑 Carregando credenciais do Firebase...');
    let firebaseCredentials = {};
    try {
      const credentialsPath = path.join(serverPath, 'private', 'aps-bsfco-firebase-adminsdk-yzryl-c4dd832e98.json');
      log.info(`📄 Arquivo de credenciais: ${credentialsPath}`);

      if (fs.existsSync(credentialsPath)) {
        const credentialsContent = fs.readFileSync(credentialsPath, 'utf8');
        firebaseCredentials = JSON.parse(credentialsContent);
        sendLog('info', '✅ Credenciais Firebase carregadas');
        log.info('✅ Credenciais Firebase carregadas com sucesso');
      } else {
        const errorMsg = `⚠️ Arquivo de credenciais não encontrado: ${credentialsPath}`;
        log.warn(errorMsg);
        sendLog('warn', errorMsg);
      }
    } catch (error) {
      const errorMsg = `❌ Erro ao carregar credenciais Firebase: ${error.message}`;
      log.error(errorMsg);
      sendLog('error', errorMsg);
    }

    // Configurar variáveis de ambiente
    const env = {
      ...process.env,
      NODE_ENV: NODE_ENV,
      PORT: SERVER_PORT,
      // ✅ NOVO: Indica que está rodando via Electron
      ELECTRON_APP: 'true',
      // ✅ NOVO: Passa caminho do AppData para o servidor usar diretórios persistentes
      APPDATA: app.getPath('userData'),
      // Passar configurações de autostart para o servidor
      AUTOSTART_HISCRE: settings.autostart.hiscre ? 'true' : 'false',
      AUTOSTART_OFCWEB: settings.autostart.ofcweb ? 'true' : 'false',
      AUTOSTART_GUIAS: settings.autostart.guias ? 'true' : 'false',
      // Passar configurações de autenticação do HISCRE
      HISCRE_LOGIN_AUTO: settings.hiscreAuth?.loginAutomatico ? 'true' : 'false',
      HISCRE_OTP_SECRET: settings.hiscreAuth?.otpSecret || '',
      // Credenciais do Firebase (do arquivo JSON - já com \n corretos)
      FIREBASE_TYPE: firebaseCredentials.type || 'service_account',
      FIREBASE_PROJECT_ID: firebaseCredentials.project_id || 'aps-bsfco',
      FIREBASE_PRIVATE_KEY_ID: firebaseCredentials.private_key_id || '',
      FIREBASE_PRIVATE_KEY: firebaseCredentials.private_key || '',
      FIREBASE_CLIENT_EMAIL: firebaseCredentials.client_email || '',
      FIREBASE_CLIENT_ID: firebaseCredentials.client_id || '',
      FIREBASE_AUTH_URI: firebaseCredentials.auth_uri || 'https://accounts.google.com/o/oauth2/auth',
      FIREBASE_TOKEN_URI: firebaseCredentials.token_uri || 'https://oauth2.googleapis.com/token',
      FIREBASE_AUTH_PROVIDER_X509_CERT_URL: firebaseCredentials.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs',
      FIREBASE_CLIENT_X509_CERT_URL: firebaseCredentials.client_x509_cert_url || '',
      // Credenciais do Google (mesmas do Firebase)
      GOOGLE_TYPE: firebaseCredentials.type || 'service_account',
      GOOGLE_PROJECT_ID: firebaseCredentials.project_id || 'aps-bsfco',
      GOOGLE_PRIVATE_KEY_ID: firebaseCredentials.private_key_id || '',
      GOOGLE_PRIVATE_KEY: firebaseCredentials.private_key || '',
      GOOGLE_CLIENT_EMAIL: firebaseCredentials.client_email || '',
      GOOGLE_CLIENT_ID: firebaseCredentials.client_id || '',
      GOOGLE_AUTH_URI: firebaseCredentials.auth_uri || 'https://accounts.google.com/o/oauth2/auth',
      GOOGLE_TOKEN_URI: firebaseCredentials.token_uri || 'https://oauth2.googleapis.com/token',
      GOOGLE_AUTH_PROVIDER_X509_CERT_URL: firebaseCredentials.auth_provider_x509_cert_url || 'https://www.googleapis.com/oauth2/v1/certs',
      GOOGLE_CLIENT_X509_CERT_URL: firebaseCredentials.client_x509_cert_url || ''
    };

    // Se usar emuladores, passar a flag
    if (USE_EMULATORS) {
      env.USE_FIRESTORE_EMULATOR = 'true';
      sendLog('info', '🔧 Modo: EMULATORS');
    } else if (NODE_ENV === 'production') {
      sendLog('info', '🚀 Modo: PRODUÇÃO');
    } else {
      sendLog('info', '🌐 Modo: DEV-ONLINE');
    }

    // Log das configurações de autostart
    log.info(`Autostart - HISCRE: ${env.AUTOSTART_HISCRE}, OFCWeb: ${env.AUTOSTART_OFCWEB}, Guias: ${env.AUTOSTART_GUIAS}`);
    sendLog('info', `⚙️ Autostart configurado para: ${[
      settings.autostart.hiscre ? 'HISCRE' : null,
      settings.autostart.ofcweb ? 'OFCWeb' : null,
      settings.autostart.guias ? 'Guias' : null
    ].filter(Boolean).join(', ') || 'Nenhum'}`);

    sendLog('info', '🔄 Spawning processo do servidor...');
    log.info(`Node Path: ${nodePath}`);
    log.info(`Server Script: ${serverScript}`);
    log.info(`CWD: ${serverPath}`);

    try {
      serverProcess = spawn(nodePath, [serverScript], {
        cwd: serverPath,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });

        sendLog('info', `✅ Processo criado (PID: ${serverProcess.pid})`);

      // Capturar logs do servidor
      serverProcess.stdout.on('data', (data) => {
        const message = data.toString().trim();
        log.info(`[SERVER] ${message}`);
        sendLog('info', message);
      });

      serverProcess.stderr.on('data', (data) => {
        const message = data.toString().trim();
        log.error(`[SERVER ERROR] ${message}`);
        sendLog('error', message);
      });

      serverProcess.on('error', (error) => {
        log.error('❌ Erro ao spawnar processo:', error);
        sendLog('error', `❌ Erro ao spawnar processo: ${error.message}`);
        reject(error);
      });

      serverProcess.on('exit', (code, signal) => {
        log.info(`⚠️ Servidor encerrado. Código: ${code}, Signal: ${signal}`);
        sendLog('warn', `⚠️ Servidor encerrado. Código: ${code}`);
        serverProcess = null;
      });

      sendLog('info', '⏳ Aguardando servidor responder na porta 3000...');

      // Aguardar servidor estar pronto
      waitForServer(resolve, reject);

    } catch (error) {
      log.error('❌ Erro ao criar processo do servidor:', error);
      sendLog('error', `❌ Erro ao criar processo: ${error.message}`);
      reject(error);
    }
  });
}

/**
 * Aguardar servidor responder
 */
function waitForServer(resolve, reject, attempt = 0) {
  const maxAttempts = 60; // Aumentado para 60 segundos
  const checkInterval = 1000; // 1 segundo

  if (attempt >= maxAttempts) {
    const errorMsg = `⏱️ Timeout: Servidor não respondeu após ${maxAttempts} segundos`;
    log.error(errorMsg);
    sendLog('error', errorMsg);
    sendLog('error', '💡 Tente reiniciar o servidor manualmente');
    reject(new Error('Timeout ao iniciar servidor'));
    return;
  }

  // Enviar feedback a cada 5 segundos
  if (attempt > 0 && attempt % 5 === 0) {
    const elapsed = attempt;
    sendLog('info', `⏳ Aguardando servidor... (${elapsed}s)`);
    log.info(`Tentativa ${attempt}/${maxAttempts} - Aguardando ${SERVER_URL}/health`);
  }

  // Log detalhado da primeira tentativa
  if (attempt === 0) {
    log.info(`Verificando health check em: ${SERVER_URL}/health`);
  }

  axios
    .get(`${SERVER_URL}/health`, { timeout: 2000 })
    .then((response) => {
      log.info('✅ Servidor respondeu ao health check!');
      log.info(`Resposta: ${JSON.stringify(response.data)}`);
      sendLog('success', '✅ Servidor iniciado e respondendo!');

      // Pequeno delay para garantir que tudo esteja pronto
      setTimeout(() => {
        sendLog('success', '🎉 Pronto para uso!');
        resolve();
      }, 500);
    })
    .catch((error) => {
      // Log detalhado apenas nas primeiras tentativas e depois a cada 10
      if (attempt < 3 || attempt % 10 === 0) {
        log.warn(`Tentativa ${attempt + 1}: ${error.code || error.message}`);
      }

      setTimeout(() => waitForServer(resolve, reject, attempt + 1), checkInterval);
    });
}

/**
 * Parar servidor
 */
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      log.info('✅ Servidor já está parado');
      sendLog('info', '✅ Servidor já parado');
      resolve();
      return;
    }

    log.info(`🛑 Parando servidor (PID: ${serverProcess.pid})...`);
    sendLog('info', '🛑 Parando servidor...');

    let resolved = false;
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        serverProcess = null;
        log.info('✅ Servidor parado com sucesso');
        sendLog('success', '✅ Servidor parado');
        resolve();
      }
    };

    // Listener para o evento exit (só será chamado uma vez por causa do safeResolve)
    serverProcess.once('exit', (code) => {
      log.info(`Processo encerrado com código: ${code}`);
      safeResolve();
    });

    // Matar processo
    try {
      if (process.platform === 'win32') {
        log.info('Usando taskkill (Windows)...');
        spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (error) {
      log.error('❌ Erro ao tentar parar servidor:', error);
      sendLog('error', `❌ Erro ao parar: ${error.message}`);
      safeResolve();
    }

    // Timeout de segurança - força resolução após 5 segundos
    setTimeout(() => {
      if (!resolved) {
        log.warn('⚠️ Timeout ao aguardar encerramento, forçando...');
        sendLog('warn', '⚠️ Forçando encerramento do servidor...');
        if (serverProcess) {
          try {
            serverProcess.kill('SIGKILL');
          } catch (error) {
            log.error('❌ Erro ao forçar encerramento:', error);
          }
        }
        safeResolve();
      }
    }, 5000);
  });
}

/**
 * Reiniciar servidor
 */
let restartingServer = false;
async function restartServer() {
  // Prevenir múltiplas chamadas simultâneas
  if (restartingServer) {
    log.warn('⚠️ Reinicialização já em andamento, ignorando nova solicitação');
    sendLog('warn', '⚠️ Reinicialização já em andamento...');
    return;
  }

  restartingServer = true;

  try {
    log.info('=== INICIANDO REINICIALIZAÇÃO DO SERVIDOR ===');
    sendLog('info', '🔄 Reiniciando servidor...');

    await stopServer();

    // Aguardar um pouco para garantir que o processo foi totalmente encerrado
    sendLog('info', '⏳ Aguardando limpeza de recursos...');
    await new Promise((resolve) => setTimeout(resolve, 2000));

    sendLog('info', '🚀 Iniciando servidor novamente...');
    await startServer();

    log.info('=== REINICIALIZAÇÃO CONCLUÍDA COM SUCESSO ===');
    sendLog('success', '✅ Servidor reiniciado com sucesso!');
  } catch (error) {
    log.error('❌ Erro ao reiniciar servidor:', error);
    sendLog('error', `❌ Erro ao reiniciar: ${error.message}`);
    sendLog('error', '💡 Tente novamente ou feche e abra o aplicativo');
    throw error;
  } finally {
    restartingServer = false;
  }
}

/**
 * Enviar log para a janela
 */
function sendLog(type, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log', {
      type,
      message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Verificar conexão com a internet
 * Usa favicon do Google para evitar problemas de CORS
 */
async function verificarConexao() {
  try {
    // Tentar a primeira URL
    const response = await axios.get(CONEXAO_CHECK_URLS[0], {
      timeout: 10000,
      responseType: 'arraybuffer', // Para evitar problemas de encoding
      validateStatus: (status) => status === 200 || status === 304
    });

    const conectado = response.status === 200 || response.status === 304;

    // Enviar status para o renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('conexao-status', {
        conectado: true,
        mensagem: 'Conectado',
        timestamp: new Date().toISOString()
      });
    }

    log.info('✅ [Conexao] Verificação OK - Conectado à internet');
    return true;
  } catch (error) {
    // Tentar URL de fallback
    try {
      log.info('🔄 [Conexao] Tentando URL de fallback...');
      const response = await axios.get(CONEXAO_CHECK_URLS[1], {
        timeout: 10000,
        validateStatus: (status) => status === 200 || status === 304
      });

      if (response.status === 200 || response.status === 304) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('conexao-status', {
            conectado: true,
            mensagem: 'Conectado',
            timestamp: new Date().toISOString()
          });
        }
        log.info('✅ [Conexao] Verificação OK via fallback');
        return true;
      }
    } catch (fallbackError) {
      // Ambas falharam
    }

    const errorInfo = {
      conectado: false,
      mensagem: error.code === 'ECONNABORTED'
        ? 'Timeout ao conectar'
        : error.message || 'Erro de conexão',
      timeout: error.code === 'ECONNABORTED',
      timestamp: new Date().toISOString()
    };

    // Enviar status para o renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('conexao-status', errorInfo);
    }

    log.warn('⚠️ [Conexao] Falha na verificação:', errorInfo.mensagem);
    return false;
  }
}

/**
 * Iniciar monitoramento periódico de conexão
 */
function iniciarMonitoramentoConexao() {
  // Verificação imediata
  verificarConexao();

  // Verificação periódica
  conexaoCheckInterval = setInterval(() => {
    verificarConexao();
  }, CONEXAO_CHECK_INTERVAL);

  log.info(`🌐 [Conexao] Monitoramento iniciado (intervalo: ${CONEXAO_CHECK_INTERVAL/1000}s)`);
}

/**
 * Parar monitoramento de conexão
 */
function pararMonitoramentoConexao() {
  if (conexaoCheckInterval) {
    clearInterval(conexaoCheckInterval);
    conexaoCheckInterval = null;
    log.info('🌐 [Conexao] Monitoramento parado');
  }
}

/**
 * Verificar atualizações
 */
function checkForUpdates() {
  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on('checking-for-update', () => {
    sendLog('info', 'Verificando atualizações...');
  });

  autoUpdater.on('update-available', (info) => {
    sendLog('info', `Atualização disponível: v${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    sendLog('info', 'Nenhuma atualização disponível');
  });

  autoUpdater.on('error', (err) => {
    sendLog('error', `Erro na atualização: ${err.message}`);
  });

  autoUpdater.on('download-progress', (progressObj) => {
    const message = `Baixando: ${Math.round(progressObj.percent)}%`;
    sendLog('info', message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendLog('success', 'Atualização baixada! Será instalada ao reiniciar.');
  });
}

/**
 * IPC Handlers
 */
ipcMain.handle('restart-server', async () => {
  try {
    await restartServer();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('start-service', async (event, serviceName) => {
  try {
    await startService(serviceName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restart-service', async (event, serviceName) => {
  try {
    await restartService(serviceName);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-service-status', async (event, serviceName) => {
  try {
    const status = await getServiceStatus(serviceName);
    return status;
  } catch (error) {
    return { running: false, error: error.message };
  }
});

ipcMain.handle('get-settings', async () => {
  try {
    const settings = await loadSettings();
    return { success: true, settings };
  } catch (error) {
    return { success: false, error: error.message, settings: defaultSettings };
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    await saveSettings(settings);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-server-status', async () => {
  try {
    const response = await axios.get(`${SERVER_URL}/health`);
    return { running: true, data: response.data };
  } catch {
    return { running: false };
  }
});

ipcMain.handle('verificar-conexao', async () => {
  try {
    const conectado = await verificarConexao();
    return { success: true, conectado };
  } catch (error) {
    return { success: false, conectado: false, error: error.message };
  }
});

// Minimizar para bandeja
ipcMain.on('minimize-to-tray', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

/**
 * Eventos do App
 */
app.whenReady().then(async () => {
  log.info('========================================');
  log.info('    PENHORAS SERVER CONSOLE');
  log.info(`    Versão: ${app.getVersion()}`);
  log.info(`    Ambiente: ${NODE_ENV}`);
  log.info(`    Packaged: ${isPackaged}`);
  log.info('========================================');

  sendLog('info', `🚀 Iniciando Penhoras Server Console v${app.getVersion()}`);

  createWindow();
  createTray();

  // Verificar atualizações
  if (isPackaged) {
    sendLog('info', '🔍 Verificando atualizações...');
    checkForUpdates();
  } else {
    sendLog('info', '🔧 Modo desenvolvimento - auto-update desabilitado');
  }

  // Iniciar servidor
  sendLog('info', '⚙️ Preparando para iniciar servidor...');
  try {
    await startServer();
  } catch (error) {
    log.error('❌ Falha crítica ao iniciar servidor:', error);
    sendLog('error', `❌ Falha ao iniciar servidor: ${error.message}`);
    sendLog('error', '💡 Use o botão "Reiniciar Servidor" para tentar novamente');
  }

  // Iniciar monitoramento de conexão
  sendLog('info', '🌐 Iniciando monitoramento de conexão...');
  iniciarMonitoramentoConexao();
});

app.on('window-all-closed', () => {
  // Manter app rodando no Windows
  if (process.platform !== 'darwin') {
    return;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', async () => {
  // Parar monitoramento de conexão
  pararMonitoramentoConexao();

  await stopServer();
});

// Prevenir múltiplas instâncias
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
