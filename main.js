const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const fs = require('fs').promises;

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
    const data = await fs.readFile(settingsPath, 'utf-8');
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
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
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
  const iconPath = path.join(__dirname, 'assets', 'icon.ico');
  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Console',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: 'Reiniciar Servidor',
      click: () => {
        restartServer();
      }
    },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Penhoras Server');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
}

/**
 * Iniciar servidor Node.js
 */
async function startServer() {
  return new Promise(async (resolve, reject) => {
    log.info('Iniciando servidor Node.js...');
    sendLog('info', 'Iniciando servidor Node.js...');

    const serverScript = path.join(serverPath, 'dist', 'app.js');
    
    // ✅ NOVO: Log do caminho do UserData para debug
    const userDataPath = app.getPath('userData');
    log.info(`📁 UserData Path: ${userDataPath}`);
    sendLog('info', `📁 Dados persistentes em: ${userDataPath}`);

    // Carregar configurações
    const settings = await loadSettings();

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
      HISCRE_OTP_SECRET: settings.hiscreAuth?.otpSecret || ''
    };

    // Se usar emuladores, passar a flag
    if (USE_EMULATORS) {
      env.USE_FIRESTORE_EMULATOR = 'true';
      sendLog('info', '🔧 Servidor será iniciado em modo EMULATORS');
    } else if (NODE_ENV === 'production') {
      sendLog('info', '🚀 Servidor será iniciado em modo PRODUÇÃO');
    } else {
      sendLog('info', '🌐 Servidor será iniciado em modo DEV-ONLINE');
    }

    serverProcess = spawn(nodePath, [serverScript], {
      cwd: serverPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

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
      log.error('Erro ao iniciar servidor:', error);
      sendLog('error', `Erro ao iniciar servidor: ${error.message}`);
      reject(error);
    });

    serverProcess.on('exit', (code, signal) => {
      log.info(`Servidor encerrado. Código: ${code}, Signal: ${signal}`);
      sendLog('warn', `Servidor encerrado. Código: ${code}`);
      serverProcess = null;
    });

    // Aguardar servidor estar pronto
    waitForServer(resolve, reject);
  });
}

/**
 * Aguardar servidor responder
 */
function waitForServer(resolve, reject, attempt = 0) {
  const maxAttempts = 30;

  if (attempt >= maxAttempts) {
    reject(new Error('Timeout ao iniciar servidor'));
    return;
  }

  axios
    .get(`${SERVER_URL}/health`)
    .then(() => {
      log.info('Servidor iniciado com sucesso!');
      sendLog('success', 'Servidor iniciado com sucesso!');
      resolve();
    })
    .catch(() => {
      setTimeout(() => waitForServer(resolve, reject, attempt + 1), 1000);
    });
}

/**
 * Parar servidor
 */
function stopServer() {
  return new Promise((resolve) => {
    if (!serverProcess) {
      log.info('Servidor já está parado');
      resolve();
      return;
    }

    log.info('Parando servidor...');
    sendLog('info', 'Parando servidor...');

    let resolved = false;
    const safeResolve = () => {
      if (!resolved) {
        resolved = true;
        serverProcess = null;
        log.info('Servidor parado');
        sendLog('info', 'Servidor parado');
        resolve();
      }
    };

    // Listener para o evento exit (só será chamado uma vez por causa do safeResolve)
    serverProcess.once('exit', () => {
      safeResolve();
    });

    // Matar processo
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', serverProcess.pid, '/f', '/t']);
      } else {
        serverProcess.kill('SIGTERM');
      }
    } catch (error) {
      log.error('Erro ao tentar parar servidor:', error);
      safeResolve();
    }

    // Timeout de segurança - força resolução após 5 segundos
    setTimeout(() => {
      if (!resolved) {
        log.warn('Timeout ao aguardar encerramento do servidor, forçando...');
        if (serverProcess) {
          try {
            serverProcess.kill('SIGKILL');
          } catch (error) {
            log.error('Erro ao forçar encerramento:', error);
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
    log.warn('Reinicialização já em andamento, ignorando nova solicitação');
    return;
  }

  restartingServer = true;

  try {
    sendLog('info', 'Reiniciando servidor...');
    await stopServer();

    // Aguardar um pouco para garantir que o processo foi totalmente encerrado
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await startServer();
    sendLog('success', 'Servidor reiniciado com sucesso!');
  } catch (error) {
    log.error('Erro ao reiniciar servidor:', error);
    sendLog('error', 'Erro ao reiniciar servidor: ' + error.message);
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

/**
 * Eventos do App
 */
app.whenReady().then(async () => {
  createWindow();
  createTray();

  // Verificar atualizações
  if (isPackaged) {
    checkForUpdates();
  }

  // Iniciar servidor
  try {
    await startServer();
  } catch (error) {
    sendLog('error', `Falha ao iniciar servidor: ${error.message}`);
  }

  // Iniciar monitoramento de conexão
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
