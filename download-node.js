/**
 * Script para baixar Node.js portable para incluir no instalador
 * Executa: node download-node.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Versão do Node.js a ser baixada (mesma do desenvolvimento)
const NODE_VERSION = process.version.substring(1); // Remove o 'v'
const PLATFORM = 'win';
const ARCH = 'x64';

const DOWNLOAD_URL = `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${PLATFORM}-${ARCH}.zip`;
const DEST_DIR = path.join(__dirname, 'node-portable');
const ZIP_FILE = path.join(__dirname, 'node.zip');

console.log('📦 Preparando Node.js portable para o instalador...');
console.log(`   Versão: ${NODE_VERSION}`);
console.log(`   URL: ${DOWNLOAD_URL}`);

// Limpar diretório anterior
if (fs.existsSync(DEST_DIR)) {
  console.log('🗑️  Removendo Node.js anterior...');
  fs.rmSync(DEST_DIR, { recursive: true, force: true });
}

// Criar diretório
fs.mkdirSync(DEST_DIR, { recursive: true });

// Baixar arquivo
console.log('⬇️  Baixando Node.js...');
const file = fs.createWriteStream(ZIP_FILE);

https.get(DOWNLOAD_URL, (response) => {
  if (response.statusCode !== 200) {
    console.error(`❌ Erro ao baixar: HTTP ${response.statusCode}`);
    process.exit(1);
  }

  const totalBytes = parseInt(response.headers['content-length'], 10);
  let downloadedBytes = 0;

  response.on('data', (chunk) => {
    downloadedBytes += chunk.length;
    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
    process.stdout.write(`\r   Progresso: ${percent}%`);
  });

  response.pipe(file);

  file.on('finish', () => {
    file.close(() => {
      console.log('\n✅ Download concluído!');

      // Aguardar um pouco para garantir que o arquivo foi fechado
      setTimeout(() => {
        // Descompactar
        console.log('📂 Extraindo arquivos...');
        try {
          // Usar PowerShell para extrair (disponível em todas as versões do Windows)
          execSync(
            `powershell -command "Expand-Archive -Path '${ZIP_FILE}' -DestinationPath '${DEST_DIR}' -Force"`,
            { stdio: 'inherit' }
          );

      // Mover arquivos para a raiz (remover subpasta node-vX.X.X-win-x64)
      const extractedFolder = path.join(DEST_DIR, `node-v${NODE_VERSION}-${PLATFORM}-${ARCH}`);
      if (fs.existsSync(extractedFolder)) {
        const files = fs.readdirSync(extractedFolder);
        files.forEach(file => {
          const oldPath = path.join(extractedFolder, file);
          const newPath = path.join(DEST_DIR, file);
          fs.renameSync(oldPath, newPath);
        });
        fs.rmdirSync(extractedFolder);
      }

      // Remover zip
      fs.unlinkSync(ZIP_FILE);

      console.log('✅ Node.js portable pronto!');
      console.log(`   Localização: ${DEST_DIR}`);
      console.log('');
          console.log('📝 Próximos passos:');
          console.log('   1. Execute: npm run build:win');
          console.log('   2. O Node.js será incluído automaticamente no instalador');
          console.log('   3. O aplicativo funcionará em qualquer máquina Windows!');
        } catch (error) {
          console.error('❌ Erro ao extrair:', error.message);
          process.exit(1);
        }
      }, 500); // Aguardar 500ms antes de extrair
    });
  });
}).on('error', (error) => {
  fs.unlinkSync(ZIP_FILE);
  console.error('❌ Erro ao baixar:', error.message);
  process.exit(1);
});
