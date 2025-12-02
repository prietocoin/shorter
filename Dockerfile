FROM node:18-alpine

# Crear directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install --production

# Copiar el resto del código
COPY . .

# Crear la carpeta donde vivirá la base de datos persistente
RUN mkdir -p /app/data

# Exponer el puerto
EXPOSE 3000

# Iniciar la app
CMD ["node", "server.js"]
