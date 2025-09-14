require('dotenv').config()
const { Telegraf } = require('telegraf')
const { Markup } = require('telegraf')
const { createClient } = require('@supabase/supabase-js')
const express = require('express')
const app = express()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

app.get('/', (req, res) => {
  res.send('Bot en línea')
})

const port = 3000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

const tokenBot = process.env.TELEGRAM_TOKEN
const bot = new Telegraf(tokenBot)

// --- NUEVAS FUNCIONES SUPABASE ---

// Guardar o actualizar el grupo
async function saveGroupId(groupId) {
  await supabase.from('groups').upsert([{ id: 1, group_id: groupId }])
}

// Leer el grupo
async function loadGroupId() {
  const { data } = await supabase
    .from('groups')
    .select('group_id')
    .eq('id', 1)
    .single()
  return data ? data.group_id : null
}

// Añadir usuario privado
async function addPrivateUser(userId) {
  await supabase.from('users').upsert([{ user_id: userId }])
}

// Leer todos los usuarios privados
async function getPrivateUsers() {
  const { data } = await supabase.from('users').select('user_id')
  return data ? data.map((u) => u.user_id) : []
}

// --- FIN FUNCIONES SUPABASE ---

let GROUP_ID = null
let privateUsers = new Set()

// Cargar datos al iniciar
;(async () => {
  GROUP_ID = await loadGroupId()
  privateUsers = new Set(await getPrivateUsers())
})()

// Registrar usuarios privados
bot.start(async (ctx) => {
  if (ctx.chat.type === 'private') {
    // Verifica en Supabase si el usuario ya existe
    const { data } = await supabase
      .from('users')
      .select('user_id')
      .eq('user_id', ctx.from.id)
      .single()

    if (!data) {
      await addPrivateUser(ctx.from.id)
      privateUsers.add(ctx.from.id)
    }

    ctx.reply(
      `Soy YummyEcho, repito los mensajes para ayudarte.`,
      Markup.keyboard(['/pedido']).resize().oneTime(false)
    )
  } else {
    ctx.reply(
      `Soy YummyEcho, repito los mensajes para ayudarte.`,
      Markup.keyboard(['/pedido']).resize().oneTime(false)
    )
  }
})

bot.on('new_chat_members', async (ctx) => {
  const botId = ctx.botInfo.id
  const newMembers = ctx.message.new_chat_members
  const isBotAdded = newMembers.some((member) => member.id === botId)

  if (isBotAdded) {
    if (GROUP_ID !== ctx.chat.id) {
      GROUP_ID = ctx.chat.id
      await saveGroupId(GROUP_ID)
      console.log(`✅ Bot añadido al grupo. ID del grupo: ${GROUP_ID}`)
      ctx.reply(
        '¡Hola a todos! Gracias por añadirme. He guardado el ID de este grupo para mis tareas programadas.'
      )
    }
  }
})

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
    return ctx.reply('Uso: /cadena <mensaje>')
  }
  const message = args.join(' ')
  let count = 0
  // Recarga usuarios privados desde Supabase
  const users = await getPrivateUsers()
  for (const userId of users) {
    try {
      await ctx.telegram.sendMessage(userId, `MENSAJE: ${message}`)
      count++
    } catch (e) {
      // Si el usuario bloqueó el bot o hay error, lo ignoramos
    }
  }
  ctx.reply(`Mensaje enviado a ${count} usuarios en privado.`)
})

bot.hears(/^reporte\s+(.+)/i, async (ctx) => {
  if (ctx.chat.type !== 'private') return
  if (!GROUP_ID)
    return ctx.reply('No hay grupo registrado para enviar el reporte.')

  const texto = ctx.match[1]
  await ctx.telegram.sendMessage(
    GROUP_ID,
    `Reporte de @${ctx.from.username || ctx.from.first_name}:\n${texto}`
  )
  // Enviar confirmación al usuario
  const confirmMsg = await ctx.reply(
    'Tu reporte ha sido enviado con éxito. Por seguridad este mensaje se eliminará en 1 minuto.'
  )

  // Esperar un breve momento antes de borrar (opcional)
  setTimeout(async () => {
    try {
      await ctx.deleteMessage() // Borra el mensaje del usuario
      await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id) // Borra el mensaje del bot
    } catch (err) {
      console.error('Error al borrar mensajes:', err)
    }
  }, 60000) // Espera 1 minuto antes de borrar
})

// Permitir reporte con imagen/video y caption que contenga "reporte"
bot.on(['photo', 'video'], async (ctx) => {
  if (ctx.chat.type !== 'private') return
  if (!GROUP_ID) return

  const caption = ctx.message.caption || ''
  // Detectar si el caption contiene la palabra "reporte" (al inicio o en cualquier parte)
  const reporteRegex = /^\/?reporte\b\s*(.*)/i
  const match = caption.match(reporteRegex)
  if (!match) return

  // Extraer el texto después de "reporte"
  const text = match[1].trim()
  const user = ctx.from.username || ctx.from.first_name
  const finalCaption = text
    ? `Reporte de @${user}:\n${text}`
    : `Reporte de @${user}:`

  let confirmMsg

  try {
    if (ctx.message.photo) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id
      await ctx.telegram.sendPhoto(GROUP_ID, photo, { caption: finalCaption })
      confirmMsg = await ctx.reply(
        'Tu reporte con imagen ha sido enviado con éxito. Por seguridad este mensaje se eliminará en 1 minuto.'
      )
    }

    if (ctx.message.video) {
      const video = ctx.message.video.file_id
      await ctx.telegram.sendVideo(GROUP_ID, video, { caption: finalCaption })
      confirmMsg = await ctx.reply(
        'Tu reporte con video ha sido enviado con éxito. Por seguridad este mensaje se eliminará en 1 minuto.'
      )
    }

    // Esperar un momento antes de borrar
    setTimeout(async () => {
      try {
        await ctx.deleteMessage() // Borra el mensaje multimedia del usuario
        if (confirmMsg) {
          await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id) // Borra el mensaje del bot
        }
      } catch (err) {
        console.error('Error al borrar mensajes:', err)
      }
    }, 60000) // Espera 1 minuto antes de borrar
  } catch (err) {
    console.error('Error al procesar el reporte:', err)
  }
})

// Lista de pedidos random
const pedidos = [
  {
    producto: "Mc Flurry de McDonald's",
    ubicacion: 'Entra a la app para ver la ubicación',
    cliente: 'Francisco Rodríguez',
    bonus: '2$',
  },
  {
    producto: "Pizza de Domino's tamaño mediana",
    ubicacion: 'Entra a la app para ver la ubicación',
    cliente: 'Ana Pérez',
    bonus: '1.5$',
  },
  {
    producto: 'Sushi de Sushi House',
    ubicacion: 'Entra a la app para ver la ubicación',
    cliente: 'Carlos Ruiz',
    bonus: '3$',
  },
  {
    producto: 'Tacos de Taco Bell',
    ubicacion: 'Entra a la app para ver la ubicación',
    cliente: 'María Gómez',
    bonus: '2.2$',
  },
]

// Comando /pedido
bot.command('pedido', (ctx) => {
  const pedido = pedidos[Math.floor(Math.random() * pedidos.length)]
  ctx.reply(
    `🍔 Pedido:\n` +
      `Producto: ${pedido.producto}\n` +
      `${pedido.ubicacion}\n` +
      `Cliente: ${pedido.cliente}\n` +
      `Bonus: ${pedido.bonus}`
  )
})

bot.help((ctx) => {
  ctx.reply('En desarrollo...')
})

//Revisar cuantos usuarios hay actualmente en el bot
bot.command('usuarios', async (ctx) => {
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
  }
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return ctx.reply('Este comando solo puede usarse en grupos.')
  }
  const users = await getPrivateUsers()
  ctx.reply(`Usuarios registrados en privado: ${users.length}`)
})

bot.launch()
module.exports = app
