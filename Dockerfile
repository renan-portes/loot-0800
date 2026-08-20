# Base image leve com Node.js LTS
FROM node:20-alpine

# Instalar ferramentas de build necessárias para compilação do sqlite3 no Alpine
RUN apk add --no-cache python3 make g++

# Definir o diretório de trabalho dentro do container
WORKDIR /app

# Copiar arquivos de definição de dependências
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm install --omit=dev

# Copiar o restante dos arquivos do projeto
COPY . .

# Expor a porta da aplicação
EXPOSE 3000

# Comando para iniciar o servidor e o bot
CMD ["node", "index.js"]
