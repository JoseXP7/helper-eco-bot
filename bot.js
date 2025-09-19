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
const GROUP_PASSWORD = process.env.GROUP_PASSWORD

const activatedGroups = new Set()

// --- NUEVAS FUNCIONES SUPABASE ---

// Guardar o actualizar el grupo
async function saveGroupId(groupId) {
  await supabase.from('groups').upsert([{ id: 1, group_id: groupId }])
}

// Guardar o actualizar el grupo, incluyendo el estado de activación
async function saveGroupStatus(groupId, isActivated) {
  const { data, error } = await supabase
    .from('groups')
    .upsert([{ group_id: groupId, is_activated: isActivated }], {
      onConflict: 'group_id',
    })

  if (error) {
    console.error('Error al guardar el estado del grupo:', error.message)
    throw error // Propaga el error para manejarlo en la llamada
  }
  return data
}

// Leer el estado de un grupo
async function loadGroupStatus(groupId) {
  const { data } = await supabase
    .from('groups')
    .select('is_activated')
    .eq('group_id', groupId)
    .single()
  return data ? data.is_activated : false
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

// Guardar o actualizar el estado de un usuario
async function saveUserStatus(userId, isActivated) {
  const { data, error } = await supabase
    .from('users')
    .update({ is_activated: isActivated })
    .eq('user_id', userId)

  if (error) {
    console.error('Error al actualizar el estado del usuario:', error.message)
    throw error
  }
  return data
}

// Leer el estado de un usuario
async function loadUserStatus(userId) {
  const { data } = await supabase
    .from('users')
    .select('is_activated')
    .eq('user_id', userId)
    .single()
  return data ? data.is_activated : false
}

// Añadir usuario privado o actualizar si ya existe
async function upsertPrivateUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .upsert([{ user_id: userId, is_activated: false }], {
      onConflict: 'user_id',
    })
  if (error) {
    console.error('Error al guardar el usuario privado:', error.message)
  }
  return data
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

  // Cargar todos los grupos activados al iniciar
  const { data: activated } = await supabase
    .from('groups')
    .select('group_id')
    .eq('is_activated', true)
  if (activated) {
    activated.forEach((row) => activatedGroups.add(row.group_id))
  }
})()

// Middleware para verificar la activación del usuario privado
bot.use(async (ctx, next) => {
  // Solo aplica para chats privados
  if (ctx.chat.type !== 'private') {
    return next()
  }

  // Comandos públicos en privado que no requieren activación
  const publicCommands = ['/start', '/solicitar_activacion', '/help', '/pedido']
  if (
    ctx.message &&
    ctx.message.text &&
    publicCommands.includes(ctx.message.text.split(' ')[0])
  ) {
    return next()
  }

  // Verificar el estado de activación del usuario
  const isActivated = await loadUserStatus(ctx.from.id)
  if (isActivated) {
    return next()
  } else {
    ctx.reply(
      '❌ No tienes permiso para usar este comando. Por favor, usa /solicitar_activacion para pedir acceso.'
    )
  }
})

// Middleware para verificar si el grupo está activado
bot.use(async (ctx, next) => {
  // Si es un chat privado, siempre pasa
  if (ctx.chat.type === 'private') {
    return next()
  }

  // ✅ Permitir el comando /password y /start sin importar el estado de activación
  if (ctx.message && ctx.message.text) {
    if (
      ctx.message.text.startsWith('/password') ||
      ctx.message.text.startsWith('/start')
    ) {
      return next()
    }
  }

  // ✅ Verificar el estado de activación del grupo directamente desde la base de datos
  const isActivated = await loadGroupStatus(ctx.chat.id)
  if (isActivated) {
    activatedGroups.add(ctx.chat.id) // Sincroniza el estado en memoria
    return next()
  }

  // Si no está activado, se informa al usuario y se detiene la ejecución
  ctx.reply(
    'El bot no está activado en este grupo. Un administrador debe ingresar la contraseña con el comando `/password <tu_contraseña>`'
  )
})

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
      await upsertPrivateUser(ctx.from.id)
      privateUsers.add(ctx.from.id)
    }

    ctx.reply(
      `Soy Yummy Helper, un bot para revisar pedidos de nuestra app fácil y rápido.`,
      Markup.keyboard(['/pedido']).resize().oneTime(false)
    )
  } else {
    const isActivated = await loadGroupStatus(ctx.chat.id)
    if (!isActivated) {
      return ctx.reply(
        'Para usarme en este grupo, por favor ingresa la contraseña con el comando `/password <tu_contraseña>`'
      )
    }
    ctx.reply(
      `Soy Yummy Helper, un bot para revisar pedidos de nuestra app fácil y rápido.`,
      Markup.keyboard(['/pedido']).resize().oneTime(false)
    )
  }
})

bot.on('new_chat_members', async (ctx) => {
  const botId = ctx.botInfo.id
  const newMembers = ctx.message.new_chat_members
  const isBotAdded = newMembers.some((member) => member.id === botId)

  if (isBotAdded) {
    // ✅ Se simplifica la lógica, se basa en la DB y el middleware
    const isActivated = await loadGroupStatus(ctx.chat.id)
    if (isActivated) {
      activatedGroups.add(ctx.chat.id)
      return ctx.reply('¡Hola de nuevo! Ya estoy activado en este grupo.')
    }

    ctx.reply(
      '¡Hola a todos! Para activar mis funciones en este grupo, el propietario o un administrador debe ingresar la contraseña. Por favor, usa el comando `/password <tu_contraseña>`'
    )
  }
})

// Nuevo comando para ingresar la contraseña
bot.command('password', async (ctx) => {
  const groupId = ctx.chat.id
  const args = ctx.message.text.split(' ').slice(1)
  const password = args[0]

  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }

  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo los administradores o propietarios pueden activar el bot.'
    )
  }

  const isActivated = await loadGroupStatus(groupId)
  if (isActivated) {
    return ctx.reply('Este grupo ya está activado.')
  }

  if (password === GROUP_PASSWORD) {
    try {
      await saveGroupStatus(groupId, true)
      activatedGroups.add(groupId)

      ctx.reply(
        '✅ ¡Contraseña correcta! El bot ha sido activado en este grupo. Ahora puedes usar mis comandos.'
      )

      GROUP_ID = groupId
      await saveGroupId(GROUP_ID)
      console.log(`✅ Bot activado en el grupo.`)
    } catch (e) {
      console.error('Error al activar el grupo:', e)
      ctx.reply(
        '❌ Ocurrió un error al activar el grupo. Por favor, revisa los logs del servidor.'
      )
    }
  } else {
    ctx.reply('❌ Contraseña incorrecta. Por favor, inténtalo de nuevo.')
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
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }
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
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }
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
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
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

  const isActivated = await loadUserStatus(ctx.from.id)
  if (!isActivated) {
    return ctx.reply(
      '❌ No tienes permiso para usar este comando. Por favor, usa /solicitar_activacion para pedir acceso.'
    )
  }

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
  // 50% de probabilidad de encontrar un pedido
  const foundPedido = Math.random() < 0.5

  if (foundPedido) {
    const pedido = pedidos[Math.floor(Math.random() * pedidos.length)]
    ctx.reply(
      `🍔 ¡Nuevo Pedido Disponible!\n\n` +
        `Producto: ${pedido.producto}\n` +
        `Ubicación: ${pedido.ubicacion}\n` +
        `Cliente: ${pedido.cliente}\n` +
        `Bonus: ${pedido.bonus}\n\n` +
        `¿Deseas aceptar este pedido?`,
      // ✅ Añade el teclado en línea con botones
      Markup.inlineKeyboard([
        Markup.button.callback('✅ Aceptar', 'accept_order'),
        Markup.button.callback('❌ Rechazar', 'reject_order'),
      ])
    )
  } else {
    ctx.reply(
      '😞 No se encontraron pedidos disponibles en tu zona. Sigue intentando.'
    )
  }
})

// Manejador de la acción 'Aceptar'
bot.action('accept_order', (ctx) => {
  // Edita el mensaje original para mostrar la confirmación
  ctx.editMessageText(
    '✅ ¡Pedido aceptado! El restaurante ha sido notificado y el pedido se ha añadido a tu ruta, revisa la app para más detalles.'
  )
})

// Manejador de la acción 'Rechazar'
bot.action('reject_order', (ctx) => {
  // Edita el mensaje original para mostrar la confirmación
  ctx.editMessageText('❌ Pedido rechazado. Intenta de nuevo más tarde.')
})

bot.command('ganancias', (ctx) => {
  // Generar un número de entregas entre 1 y 12
  const entregas = Math.floor(Math.random() * 12) + 1

  // Generar ganancia total entre 15.00$ y 35.00$
  const gananciaTotal = (Math.random() * (35 - 15) + 15).toFixed(2)

  // Generar bonus semanal entre 1.00$ y 5.00$
  const bonusSemanal = (Math.random() * (5 - 1) + 1).toFixed(2)

  ctx.reply(
    `💰 Tus ganancias de hoy:\n\n` +
      `Entregas completadas: ${entregas}\n` +
      `Ganancia total: ${gananciaTotal}$\n` +
      `Bonus de la semana: ${bonusSemanal}$`
  )
})

// Comando /mi_rating
bot.command('mi_rating', (ctx) => {
  // Genera un rating entre 4.0 y 5.0
  const rating = (Math.random() * (5.0 - 4.0) + 4.0).toFixed(1)

  // Genera un número de reseñas (simulando actividad)
  const totalReviews = Math.floor(Math.random() * 500) + 150

  ctx.reply(
    `⭐ Tu Calificación de Repartidor:\n\n` +
      `Puntuación Actual: ${rating} / 5.0\n` +
      `Reseñas Positivas (últimos 30 días): ${Math.floor(
        totalReviews * 0.95
      )}\n` +
      `Reseñas Totales: ${totalReviews}\n\n` +
      `Sigue ofreciendo un excelente servicio para mantener tu puntaje alto.`
  )
})

bot.command('reglas', (ctx) => {
  ctx.reply(
    `📜 <b>Normativas Clave de Yummy</b>:\n\n` +
      `1. <b>Vestimenta</b>: Siempre usa tu chaleco oficial durante las entregas.\n` +
      `2. <b>Tiempo</b>: Tienes 5 minutos para iniciar la ruta después de aceptar un pedido.\n` +
      `3. <b>Cancelación</b>: La cancelación por el driver solo está permitida con evidencia fotográfica (restaurante cerrado, inundación, etc.).\n\n` +
      `<i>Consulta la sección 'Soporte' en la app para el manual completo de políticas y procedimientos.</i>`,
    { parse_mode: 'HTML' }
  )
})

bot.command('ruta', (ctx) => {
  const mensajes = [
    '📍 Tienes <b>1.2 km restantes</b> para la recogida en "El Buen Sabor".',
    '🗺️ Próxima parada de entrega: <b>Av. Principal, casa #14</b>. El cliente te espera.',
    '🚧 Tómate un descanso. Tu próxima asignación llegará pronto.',
  ]
  const mensajeRuta = mensajes[Math.floor(Math.random() * mensajes.length)]

  ctx.reply(mensajeRuta, { parse_mode: 'HTML' })
})

bot.command('tienda', (ctx) => {
  ctx.reply(
    `🏪 <b>Consulta Rápida de Puntos de Recogida (Barquisimeto)</b>:\n\n` +
      `• <b>La Hamburguesería 143 (Av. Lara)</b>: Abierto. Tiempo de espera: 8 min. (Alta demanda)\n` +
      `• <b>Ono Sushi Bar (Torre Milenium, Av. Los Leones)</b>: Abierto. Tiempo de espera: 5 min. (Recepción rápida)\n` +
      `• <b>Tiuna Grill Steak House (C.C. Sambil)</b>: Cerrado. Solo abre después de las 5:00 PM.\n` +
      `• <b>Pippo Trattoria (C.C. Ciudad Llanero)</b>: Abierto. Tiempo de espera: 15 min. (Inventario en curso)\n` +
      `• <b>Maranello (Av. Lara, C.C. Churu Meru)</b>: Abierto. Flujo normal.\n\n` +
      `<i>*El sistema te asignará automáticamente al restaurante más cercano con pedido.*</i>`,
    { parse_mode: 'HTML' }
  )
})

bot.help((ctx) => {
  ctx.reply(
    `🛠️ <b>Menú de Ayuda para Repartidores (Yummy Helper)</b>\n\n` +
      `Aquí tienes la lista de comandos disponibles para gestionar tus entregas y tu cuenta:\n\n` +
      // --- Gestión de Pedidos y Logística ---
      `<b>📦 Logística y Rutas</b>\n` +
      `• /pedido: Busca un nuevo pedido disponible en tu zona (con botones Aceptar/Rechazar).\n` +
      `• /ruta: Consulta la información de tu próxima parada o la situación de tu entrega actual.\n` +
      `• /tienda: Revisa el estatus de apertura y el tiempo de espera en restaurantes clave de la ciudad.\n\n` +
      // --- Finanzas y Perfil ---
      `<b>📊 Finanzas y Perfil</b>\n` +
      `• /ganancias: Muestra un resumen de tus ganancias de hoy (entregas y bonus).\n` +
      `• /mi_rating: Revisa tu calificación actual de servicio y el número de reseñas.\n\n` +
      // --- Herramientas de Soporte ---
      `<b>⚙️ Herramientas de Soporte</b>\n` +
      `• /reglas: Muestra un extracto de las normativas clave de la plataforma Yummy.`,
    { parse_mode: 'HTML' }
  )
})

//Revisar cuantos usuarios hay actualmente en el bot
bot.command('usuarios', async (ctx) => {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }
  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      'Solo administradores o propietarios pueden usar este comando.'
    )
  }
  const users = await getPrivateUsers()
  ctx.reply(`Usuarios registrados en privado: ${users.length}`)
})

// Nuevo comando para solicitar activación
bot.command('solicitar_activacion', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    return ctx.reply(
      'Este comando solo puede ser usado en un chat privado con el bot.'
    )
  }

  const userId = ctx.from.id
  let confirmMsg

  try {
    // Guarda el objeto del mensaje enviado para obtener su ID
    confirmMsg = await ctx.reply(
      `Tu ID de usuario es: <code>${userId}</code>\n\nPor favor, reenvía este ID al administrador para que pueda activarte.`,
      { parse_mode: 'HTML' }
    )

    // Programa la eliminación del mensaje después de 1 minuto (60000 ms)
    setTimeout(async () => {
      try {
        // Elimina el mensaje del bot usando el ID guardado
        await ctx.telegram.deleteMessage(ctx.chat.id, confirmMsg.message_id)
      } catch (err) {
        console.error('Error al borrar el mensaje de activación:', err)
      }
    }, 60000)
  } catch (e) {
    console.error('Error al procesar la solicitud de activación:', e)
    ctx.reply(
      '❌ Ocurrió un error al procesar tu solicitud. Inténtalo de nuevo más tarde.'
    )
  }
})

// Nuevo comando para activar usuarios. Solo para uso en grupos y por admins.
bot.command('activar', async (ctx) => {
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    return
  }

  if (!(await isAdminOrOwner(ctx))) {
    return ctx.reply(
      '❌ Solo los administradores o propietarios pueden activar usuarios.'
    )
  }

  const args = ctx.message.text.split(' ').slice(1)
  const userId = args[0]

  if (!userId || isNaN(userId)) {
    return ctx.reply(
      '❌ Uso incorrecto. Por favor, proporciona el ID de usuario. Ejemplo: `/activar 12345678`'
    )
  }

  try {
    const userStatus = await loadUserStatus(parseInt(userId))
    if (userStatus) {
      return ctx.reply('✅ Este usuario ya está activado.')
    }

    await saveUserStatus(parseInt(userId), true)
    ctx.reply(`✅ Usuario con ID \`${userId}\` activado correctamente.`)

    // Enviar notificación al usuario activado
    try {
      await ctx.telegram.sendMessage(
        userId,
        '🎉 ¡Felicidades! Has sido activado y ahora eres un repartidor verificado.'
      )
    } catch (e) {
      console.error(
        `Error al enviar mensaje de activación al usuario ${userId}:`,
        e.message
      )
      ctx.reply(
        `⚠️ Se activó al usuario ${userId}, pero no se le pudo enviar el mensaje de confirmación. Puede que haya bloqueado el bot o no existe ese chat.`
      )
    }
  } catch (e) {
    console.error('Error al activar usuario:', e)
    ctx.reply(
      '❌ Ocurrió un error al activar el usuario. Por favor, asegúrate de que el ID sea correcto y que el usuario haya iniciado un chat con el bot.'
    )
  }
})

bot.launch()
module.exports = app
