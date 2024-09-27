# bot-GEMA-prototipo-hackathon-cccb

Bot de Telegram para comunicarse con el backend de Supabase, para que los pacientes puedan revisar sus solicitudes, además de la busqueda de medicamentos.

## Tecnologías y Librerías usadas

- Express
- Supabase
- Telegraf

## Variables de Entorno

Para ejecutar este proyecto, es necesario las variables de entorno que contienen los accesos de la base de datos de Supabase y la API de Telegram. Para esto se debe crear un archivo .env con las siguientes variables:

`TELEGRAM_TOKEN`

`VITE_SUPA_URL`

`VITE_SUPA_KEY`

Los valores de las variables deben consultarse con el equipo de desarrollo.

## Instalacion del Proyecto

```sh
npm install
```

### Compilar y recarga instantanea para desarrollo

```sh
npm run dev
```

## Uso del bot

Para buscar un medicamento, escribir en el chat del bot:

```bash
  /buscar Losartan
```

Esto buscará todas las coincidencias que sean de Losartan

Para revisar las solicitudes de un paciente, se debe simplemente ingresar la cédula al chat:

```bash
  12345678
```
