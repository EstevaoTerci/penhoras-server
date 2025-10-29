# Penhoras Server - Aplicativo Electron

Aplicativo desktop para gerenciar o servidor de automações do sistema Penhoras.

## 📋 Funcionalidades

- ✅ Console em tempo real com logs do servidor
- ✅ Reinício completo do servidor
- ✅ Reinício individual de serviços (HISCRE, OFCWeb, Guias)
- ✅ Executa na bandeja do sistema
- ✅ Atualização automática via GitHub Releases
- ✅ Interface estilo console/terminal
- ✅ Previne múltiplas instâncias
- ✅ Empacota Node.js + Chromium (Puppeteer)

## 🚀 Como Usar

### Desenvolvimento

O aplicativo Electron suporta **3 ambientes diferentes**, espelhando os ambientes do servidor:

#### 🚀 Produção (NODE_ENV=production)
```bash
# Instalar dependências
cd electron-app
npm install

# Compilar o servidor primeiro
cd ../server
npm run build

# Rodar Electron em modo produção
cd ../electron-app
npm run dev:prod
# ou para iniciar sem modo dev
npm run start:prod
```

#### 🌐 Dev-Online (ambiente padrão)
```bash
# Usa .env padrão do servidor (Firebase produção, dados reais)
npm run dev:online
# ou
npm start  # start padrão usa dev-online
```

#### 🔧 Dev-Emulators (USE_FIRESTORE_EMULATOR=true)
```bash
# Usa .env.local do servidor (Firebase Emulators)
npm run dev:emulators
# ou
npm run start:emulators
```

### Scripts Disponíveis

#### Modo Produção (start)
- **`npm start`** - Inicia em modo dev-online (padrão)
- **`npm run start:prod`** - Inicia em produção
- **`npm run start:online`** - Inicia em dev-online
- **`npm run start:emulators`** - Inicia com emuladores

#### Modo Desenvolvimento com Watch (dev) ⚡
- **`npm run dev`** - Desenvolvimento com hot-reload (padrão)
- **`npm run dev:prod`** - Desenvolvimento em produção com hot-reload
- **`npm run dev:online`** - Desenvolvimento online com hot-reload
- **`npm run dev:emulators`** - Desenvolvimento com emuladores e hot-reload

> 💡 **Modo Watch**: Arquivos monitorados (`main.js`, `preload.js`, `index.html`) reiniciam automaticamente o Electron quando salvos!

#### Build
- **`npm run build:win`** - Cria instalador Windows
- **`npm run build:mac`** - Cria instalador macOS
- **`npm run build:linux`** - Cria instalador Linux
- **`npm run dist`** - Build multi-plataforma

### Build para Produção

```bash
# Certifique-se de que o servidor está compilado
cd ../server
npm run build

# Criar o instalador Windows (Node.js é baixado automaticamente)
cd ../electron-app
npm run build:win
```

**Nota**: O script `prebuild` baixa automaticamente o Node.js portable antes do build.

O instalador será gerado em `electron-app/dist/Penhoras Server Setup 1.0.0.exe`

## ⚡ Modo Watch para Desenvolvimento

O Electron App suporta **hot-reload automático** usando `nodemon`. Quando você salva alterações em `main.js`, `preload.js` ou `index.html`, o app reinicia automaticamente!

### Como usar

```bash
cd electron-app

# Desenvolvimento com hot-reload (recomendado)
npm run dev

# Desenvolvimento com emuladores e hot-reload
npm run dev:emulators
```

### Arquivos monitorados
- `main.js` - Processo principal
- `preload.js` - Script de preload
- `index.html` - Interface

### Configuração
Veja `nodemon.json` para personalizar o comportamento do watch mode.

Para mais detalhes sobre o modo watch, veja [MODO-WATCH-DESENVOLVIMENTO.md](../docs/MODO-WATCH-DESENVOLVIMENTO.md).

## 📦 O que está incluído no instalador

- ✅ Aplicativo Electron
- ✅ **Node.js runtime portable** (~30 MB)
- ✅ Servidor Node.js compilado (`server/dist/`)
- ✅ Node modules completo (incluindo Puppeteer + Chromium)
- ✅ Configurações de produção (`.env.production`)

**Resultado**: O aplicativo funciona em **qualquer máquina Windows**, mesmo sem Node.js instalado!

Para mais detalhes sobre o empacotamento do Node.js, veja [NODEJS-PORTABLE.md](NODEJS-PORTABLE.md).

## 🔧 Configuração

### Ícones

Coloque os seguintes arquivos em `electron-app/assets/`:

- `icon.ico` - Ícone do aplicativo (256x256 ou maior)
- `icon.png` - Ícone alternativo (opcional)

### Auto-update

O app está configurado para verificar atualizações no GitHub automaticamente.

**Para instruções completas sobre como criar releases e distribuir atualizações, consulte:**

📖 **[Auto-Update e Criação de Releases](../docs/autoupdate-criacao-releases.md)**

**Resumo rápido:**

1. Atualize a versão em `package.json`
2. Faça build: `npm run build:win`
3. Crie uma release no GitHub
4. Faça upload do instalador `.exe` para a release
5. Os usuários receberão a atualização automaticamente na próxima inicialização

### Customização do Servidor

O app procura o servidor em:
- **Produção**: `{app}/resources/server/`
- **Desenvolvimento**: `../server/`

### Ambientes

O Electron detecta automaticamente qual ambiente usar baseado nas variáveis de ambiente:

- **`NODE_ENV=production`** → Carrega `.env.production` no servidor
- **`USE_FIRESTORE_EMULATOR=true`** → Carrega `.env.local` e conecta aos emuladores
- **Padrão** → Carrega `.env` (Firebase produção)

## 🎨 Interface

A interface foi desenhada para se parecer com um console/terminal moderno:

- **Header**: Status do servidor + ações principais
- **Services Panel**: Botões para reiniciar serviços individuais
- **Console**: Logs em tempo real com código de cores
- **Footer**: Estatísticas e status

### Tipos de Log

- 🔵 **INFO**: Informações gerais
- 🟢 **SUCCESS**: Operações bem-sucedidas
- 🟡 **WARN**: Avisos
- 🔴 **ERROR**: Erros

## 🔌 Integração com Frontend

O frontend Angular deve verificar se o servidor local está rodando:

```typescript
// Verificar se está rodando localmente
async checkLocalServer(): Promise<boolean> {
  try {
    const response = await this.http.get('http://localhost:3000/health').toPromise();
    return true;
  } catch {
    return false;
  }
}
```

## 📝 Notas Técnicas

### Por que não usamos pkg?

O `pkg` tem problemas com:
- Imports relativos complexos do TypeScript
- Módulos dinâmicos do Puppeteer
- Submódulos do firebase-admin

Nossa solução:
- Distribuímos os arquivos Node.js compilados
- Incluímos `node_modules` completo
- O Electron gerencia o processo Node.js

### Vantagens desta abordagem

✅ Total compatibilidade com todas as dependências
✅ Mais fácil de debugar
✅ Atualiza apenas o necessário (via auto-update)
✅ Chromium é copiado uma única vez
✅ Sem problemas com paths relativos

## 🐛 Troubleshooting

### Servidor não inicia

1. Verifique se `server/dist/` existe e contém `app.js`
2. Verifique logs em: `%USERPROFILE%\AppData\Roaming\penhoras-server-app\logs\`

### Chromium não encontrado

1. Certifique-se de que `npm install` foi executado no servidor
2. Verifique se `.local-chromium` foi copiado

### Build falha

1. Certifique-se de ter compilado o servidor: `cd ../server && npm run build`
2. Verifique se `node_modules` existe no servidor
3. Tente limpar cache: `rm -rf dist/ node_modules/ && npm install`

## 📞 Suporte

Para problemas ou dúvidas, abra uma issue no repositório.
