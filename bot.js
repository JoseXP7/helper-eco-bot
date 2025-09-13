require('dotenv').config()
const { Telegraf } = require('telegraf')
const express = require('express')
const fs = require('fs')
const DATA_FILE = 'bot_data.json'
const app = express()

app.get('/', (req, res) => {
  res.send('Bot en línea')
})

const port = 3000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

const tokenBot = process.env.TELEGRAM_TOKEN

const bot = new Telegraf(tokenBot)

// Registrar usuarios privados
bot.start(async (ctx) => {
  if (ctx.chat.type === 'private') {
    if (!privateUsers.has(ctx.from.id)) {
      privateUsers.add(ctx.from.id)
      saveData({ groupId: GROUP_ID, privateUsers: Array.from(privateUsers) })
    }
    ctx.reply(`Soy YummyEcho, repito los mensajes para ayudarte.`)
  } else {
    ctx.reply(`Soy YummyEcho, repito los mensajes para ayudarte.`)
  }
})

let { groupId: GROUP_ID, privateUsers } = loadData()
privateUsers = new Set(privateUsers)

bot.on('new_chat_members', (ctx) => {
  const botId = ctx.botInfo.id
  const newMembers = ctx.message.new_chat_members
  const isBotAdded = newMembers.some((member) => member.id === botId)

  if (isBotAdded) {
    if (GROUP_ID !== ctx.chat.id) {
      // Solo guarda si es diferente
      GROUP_ID = ctx.chat.id
      saveData({ groupId: GROUP_ID, privateUsers: Array.from(privateUsers) })
      console.log(`✅ Bot añadido al grupo. ID del grupo: ${GROUP_ID}`)
      ctx.reply(
        '¡Hola a todos! Gracias por añadirme. He guardado el ID de este grupo para mis tareas programadas.'
      )
    }
  }
})

function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE))
  }
  return { groupId: null, privateUsers: [] }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

const groupEchoIntervals = {} // { [groupId]: { intervalId, message, minutes } }

async function isAdminOrOwner(ctx) {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return false
  const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id)
  return (
    member.status === 'administrator' ||
    member.status === 'creator' ||
    member.status === 'owner'
  )
}

bot.command('eco', async (ctx) => {
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
  }

  const args = ctx.message.text.split(' ').slice(1)
  if (args.length < 2) {
    return ctx.reply('Uso: /eco <minutos> <mensaje>')
  }

  const minutes = parseInt(args[0])
  if (isNaN(minutes) || minutes < 1) {
    return ctx.reply(
      'El intervalo debe ser un número de minutos mayor o igual a 1.'
    )
  }

  const message = args.slice(1).join(' ')
  const groupId = ctx.chat.id

  // Si ya hay un eco activo, lo limpiamos
  if (groupEchoIntervals[groupId]) {
    clearInterval(groupEchoIntervals[groupId].intervalId)
  }

  ctx.reply(`Eco activado cada ${minutes} minutos: ${message}`)

  // Guardamos el intervalo (en milisegundos)
  const intervalId = setInterval(() => {
    ctx.telegram.sendMessage(groupId, `Eco: ${message}`)
  }, minutes * 60 * 1000)

  groupEchoIntervals[groupId] = { intervalId, message, minutes }
})

bot.command('eco_stop', async (ctx) => {
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
  }
  const groupId = ctx.chat.id
  if (groupEchoIntervals[groupId]) {
    clearInterval(groupEchoIntervals[groupId].intervalId)
    delete groupEchoIntervals[groupId]
    ctx.reply('Eco detenido.')
  } else {
    ctx.reply('No hay eco activo en este grupo.')
  }
})

bot.command('cadena', async (ctx) => {
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
  }
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return ctx.reply('Este comando solo puede usarse en grupos.')
  }
  const args = ctx.message.text.split(' ').slice(1)
  if (args.length < 1) {
    return ctx.reply('Uso: /broadcast <mensaje>')
  }
  const message = args.join(' ')
  let count = 0
  for (const userId of privateUsers) {
    try {
      await ctx.telegram.sendMessage(userId, `MENSAJE: ${message}`)
      count++
    } catch (e) {
      // Si el usuario bloqueó el bot o hay error, lo ignoramos
    }
  }
  ctx.reply(`Mensaje enviado a ${count} usuarios en privado.`)
})

bot.command('reporte', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply('Este comando solo puede usarse en privado.')
  }
  if (!GROUP_ID) {
    return ctx.reply('No hay grupo registrado para enviar el reporte.')
  }

  // Si el mensaje es solo texto
  const args = ctx.message.text.split(' ').slice(1)
  if (args.length > 0) {
    const text = args.join(' ')
    await ctx.telegram.sendMessage(
      GROUP_ID,
      `Reporte de @${ctx.from.username || ctx.from.first_name}:\n${text}`
    )
    return ctx.reply('Tu reporte de texto ha sido enviado con éxito.')
  }

  ctx.reply('Envía tu reporte junto al comando /reporte, en un mensaje.')
})

// Permitir reporte con imagen/video y caption "/reporte ..."
bot.on(['photo', 'video'], async (ctx) => {
  if (ctx.chat.type !== 'private') return
  if (!GROUP_ID) return

  const caption = ctx.message.caption || ''
  if (!caption.startsWith('/reporte')) return

  // Extraer el texto después de "/reporte"
  const text = caption.replace('/reporte', '').trim()
  const user = ctx.from.username || ctx.from.first_name
  const finalCaption = text
    ? `Reporte de @${user}:\n${text}`
    : `Reporte de @${user}:`

  if (ctx.message.photo) {
    const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id
    await ctx.telegram.sendPhoto(GROUP_ID, photo, { caption: finalCaption })
    return ctx.reply('Tu reporte con imagen ha sido enviado con éxito.')
  }

  if (ctx.message.video) {
    const video = ctx.message.video.file_id
    await ctx.telegram.sendVideo(GROUP_ID, video, { caption: finalCaption })
    return ctx.reply('Tu reporte con video ha sido enviado con éxito.')
  }
})

bot.help((ctx) => {
  ctx.reply('En desarollo...')
})

//mensaje de prueba, borrar despues
bot.command('grupo_id', async (ctx) => {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return ctx.reply('Este comando solo puede usarse en un grupo.')
  }
  GROUP_ID = ctx.chat.id
  ctx.reply(`ID de grupo guardado (testeo): ${GROUP_ID}`)
})

bot.launch()
module.exports = app
