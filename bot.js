require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_API_KEY
const supabase = createClient(supabaseUrl, supabaseKey)
const { Telegraf } = require('telegraf')
const express = require('express')
const app = express()

app.get('/', (req, res) => {
  res.send('Bot GEMA en Producción')
})

const port = 3000
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`)
})

const tokenBot = process.env.TELEGRAM_TOKEN

const bot = new Telegraf(tokenBot)

bot.start(async (ctx) => {
  ctx.reply(
    `Bienvenido a GEMA. Puedes consultar la disponibilidad de medicamentos aqui, usar /buscar nombredemedicamento para buscar un medicamento, o prueba también a enviar tu cédula de identidad para consultar el estado de tus solicitudes de medicamentos`
  )
})

bot.help((ctx) => {
  ctx.reply(
    'Hola! Soy GEMA, tu asistente del sistema de Gestión de Entrega de Medicamentos. Por favor, envía una consulta. Ejemplo: \n/buscar Losartan \nTambién puedes consultar el estado de tus solicitudes en el sistema tan solo enviando tu número de cédula de identidad a este chat. Pruébalo!'
  )
})

bot.command('buscar', async (ctx) => {
  const messageText = ctx.message.text
  const parts = messageText.split(' ')

  if (parts.length < 2) {
    return ctx.reply(
      'Por favor, proporciona un nombre de medicamento despues del comando. Ejemplo: \n/buscar Losartan'
    )
  }

  // Unir todas las partes después del comando como una sola frase
  const palabra = parts.slice(1).join(' ')

  const { data, error } = await supabase
    .from('medicamentos')
    .select('*')
    .ilike('nombre', `%${palabra}%`)

  if (error) {
    return ctx.reply(`Parece que hubo un error... \n ${error.message}`)
  }

  if (data.length === 0) {
    return ctx.reply('Medicamento no encontrado, o agotado.')
  }

  data.forEach((medicamento) => {
    ctx.reply(`Información del medicamento: 
      \n ID: ${medicamento.id} 
      \n Nombre: ${medicamento.nombre} 
      \n Laboratorio: ${medicamento.laboratorio}
      \n Tipo: ${medicamento.tipo}
      \n Cantidad: ${medicamento.stock}
      \n Fecha de Vencimiento: ${medicamento.fecha_caducidad}
      `)
  })
})

bot.on('text', async (ctx) => {
  let ci = ctx.message.text.trim()

  if (!/^\d+$/.test(ci)) {
    return ctx.reply('Por favor, envía un número de cédula válido.')
  }

  ctx.reply('Buscando historial de solicitudes...')

  const { data, error } = await supabase
    .from('solicitudes')
    .select('*')
    .eq('cedula', ci)
    .order('id', { ascending: false })

  if (error) {
    return ctx.reply(`Parece que hubo un error... \n ${error.message}`)
  }

  if (data.length === 0) {
    return ctx.reply(
      'No se encontró resultados o el paciente no ha realizado solicitudes.'
    )
  }

  data.forEach((solicitud) => {
    ctx.reply(
      `Información de la solicitud: \n ID de Solicitud: ${solicitud.id} 
      \n Cedula: ${solicitud.cedula} 
      \n Medicamento Solicitado: ${solicitud.medicamento} 
      \n Cantidad Solicitada: ${solicitud.cantidad} 
      \n Estado de la Solicitud: ${solicitud.estado} 
      \n Fecha de Retiro: ${solicitud.fecha_retiro}`
    )
  })
})

bot.launch()
module.exports = app
